import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import {
  isBillingDbConfigured,
  getUserIdByEmail as getBillingUserIdByEmail
} from './billing-repository.js';
import {
  ensureAccountSecuritySchema,
  revokeOtherCustomerSessions,
  createDeleteAccountToken,
  validateDeleteAccountToken,
  markDeleteTokenUsed,
  deleteCustomerAccountCompletely,
  getUserDeleteEmailContext,
  removeCustomerSession,
  verifyLoginBlockTicket,
  resolveLoginBlockForEmail
} from './account-security-repository.js';
import { sendDeleteAccountConfirmationEmail } from './delete-account-email.js';
import { revokeOtherSessionsInMemory } from './auth.js';

function resolveSession(req) {
  const sessionId = req.headers['x-session-id'] || req.query?.session || req.body?.session;
  if (!sessionId) return { error: 'no_session', status: 401 };
  const session = sessions.get(sessionId);
  if (!session?.user?.email) return { error: 'invalid_session', status: 401 };
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return { error: 'session_expired', status: 401 };
  }
  return { session, sessionId, email: session.user.email };
}

export default async function accountSecurityHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const path = String(req.path || req.url || '').split('?')[0];
  const action =
    req._accountAction ||
    path.replace(/^\/api\/account\/?/, '').replace(/^\//, '') ||
    req.query?.action;

  try {
    if (action === 'delete-confirm' && (req.method === 'GET' || req.method === 'POST')) {
      return handleDeleteConfirm(req, res);
    }

    if (action === 'login-blocked' && req.method === 'GET') {
      return handleLoginBlocked(req, res);
    }

    if (!isBillingDbConfigured()) {
      return res.status(503).json({ ok: false, error: 'not_configured' });
    }

    if (action === 'logout-other-sessions' && req.method === 'POST') {
      const ident = resolveSession(req);
      if (ident.error) {
        return res.status(ident.status).json({ ok: false, error: ident.error });
      }
      const userId = await getBillingUserIdByEmail(ident.email);
      if (!userId) {
        return res.status(404).json({ ok: false, error: 'user_not_found' });
      }
      console.log('[logout-other-sessions]', { userId, keep: ident.sessionId });
      const memRevoked = revokeOtherSessionsInMemory(ident.email, ident.sessionId);
      const dbRevoked = await revokeOtherCustomerSessions(userId, ident.sessionId);
      return res.json({
        ok: true,
        revoked: memRevoked + dbRevoked,
        message: 'Other sessions were signed out successfully.'
      });
    }

    if (action === 'request-deletion' && req.method === 'POST') {
      const ident = resolveSession(req);
      if (ident.error) {
        return res.status(ident.status).json({ ok: false, error: ident.error });
      }
      const userId = await getBillingUserIdByEmail(ident.email);
      if (!userId) {
        return res.status(404).json({ ok: false, error: 'user_not_found' });
      }
      console.log('[delete-account-request]', { userId, email: ident.email });
      const ctx = await getUserDeleteEmailContext(userId);
      if (!ctx) {
        return res.status(404).json({ ok: false, error: 'user_not_found' });
      }
      const tokenOut = await createDeleteAccountToken(userId);
      if (!tokenOut.ok) {
        return res.status(500).json({ ok: false, error: tokenOut.error || 'token_failed' });
      }
      const mail = await sendDeleteAccountConfirmationEmail(ctx, tokenOut.rawToken);
      if (!mail.sent && !mail.skipped) {
        return res.status(503).json({ ok: false, error: 'email_failed' });
      }
      return res.json({
        ok: true,
        emailSent: Boolean(mail.sent),
        message: 'Confirmation email sent.'
      });
    }

    return res.status(404).json({ ok: false, error: 'not_found' });
  } catch (e) {
    console.error('[account-security]', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}

function maskEmailForDisplay(email) {
  const em = String(email || '').trim();
  const at = em.indexOf('@');
  if (at < 2) return em;
  return `${em.slice(0, 2)}…${em.slice(at)}`;
}

async function handleLoginBlocked(req, res) {
  const ticket = String(req.query?.ticket || req.query?.block_ticket || '').trim();
  if (!ticket) {
    return res.status(400).json({ ok: false, error: 'missing_ticket' });
  }
  const verified = verifyLoginBlockTicket(ticket);
  if (!verified.ok) {
    console.log('[login-blocked-verify] invalid_ticket');
    return res.status(400).json({ ok: false, error: 'invalid_ticket' });
  }
  const block = await resolveLoginBlockForEmail(verified.email);
  if (!block.blocked) {
    console.log('[login-blocked-verify] not_blocked', { email: verified.email });
    return res.json({ ok: true, blocked: false });
  }
  console.log('[login-blocked-verify]', {
    email: verified.email,
    reason: block.reason,
    unlock: block.unlockDateLabel || null
  });

  let title = 'Account recently deleted';
  let bodyHtml = '';
  if (block.reason === 'cooldown') {
    bodyHtml = `<p>This Cutup account was permanently deleted.</p>
<p>For security and abuse-prevention reasons, this email cannot be used again until:</p>
<p class="cutup-login-block-until"><strong>${escapeHtml(block.unlockDateLabel)}</strong></p>
<p>If you believe this is a mistake or need help, please contact <a href="mailto:manager@cutup.shop">manager@cutup.shop</a>.</p>`;
  } else if (block.reason === 'deactivated') {
    title = 'Account deactivated';
    bodyHtml = `<p>This Cutup account was closed.</p>
<p>Re-opening requires support approval. If you need help, contact <a href="mailto:manager@cutup.shop">manager@cutup.shop</a>.</p>`;
  } else {
    title = 'Sign-in not available';
    bodyHtml = `<p>This account cannot sign in right now. Contact <a href="mailto:manager@cutup.shop">manager@cutup.shop</a>.</p>`;
  }

  return res.json({
    ok: true,
    blocked: true,
    reason: block.reason,
    title,
    bodyHtml,
    unlockDateLabel: block.unlockDateLabel || null,
    emailMasked: maskEmailForDisplay(block.email)
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleDeleteConfirm(req, res) {
  const token = String(req.query?.token || req.body?.token || '').trim();
  if (!token) {
    return res.status(400).json({ ok: false, status: 'invalid' });
  }

  if (req.method === 'GET') {
    const v = await validateDeleteAccountToken(token);
    return res.json({ ok: true, status: v.status });
  }

  const v = await validateDeleteAccountToken(token);
  if (v.status !== 'valid') {
    return res.status(400).json({ ok: false, status: v.status });
  }

  const del = await deleteCustomerAccountCompletely(v.userId);
  if (!del.ok) {
    return res.status(400).json({ ok: false, status: 'failed', error: del.error });
  }

  await markDeleteTokenUsed(v.tokenId);

  try {
    const { emitAccountDeleted } = await import('./email-events-bus.js');
    void emitAccountDeleted({
      email: del.email,
      firstName: 'there',
      cooldownDays: 30,
    });
  } catch (mailErr) {
    console.warn('[account-security] deletion email skipped:', mailErr?.message || mailErr);
  }

  const emailLower = String(del.email || '').trim().toLowerCase();
  for (const [sid, sess] of sessions.entries()) {
    if (String(sess.user?.email || '').trim().toLowerCase() === emailLower) {
      sessions.delete(sid);
      try {
        await removeCustomerSession(sid);
      } catch (_e) {
        /* noop */
      }
    }
  }

  return res.json({ ok: true, status: 'deleted' });
}
