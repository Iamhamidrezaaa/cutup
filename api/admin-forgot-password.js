import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured } from './db/pool.js';
import { ensureAdminsSchema, createAdminPasswordResetForEmail } from './admins-repository.js';
import { sendEmail } from './email.js';

const forgotMap = new Map();

function clientKey(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim() || 'unknown';
  return req.socket?.remoteAddress || 'unknown';
}

function rateOk(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 5;
  let arr = forgotMap.get(ip) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  forgotMap.set(ip, arr);
  return true;
}

const PUBLIC_REPLY =
  'If this email is registered as an admin, you will receive password reset instructions shortly.';

export default async function adminForgotPasswordHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  await ensureAdminsSchema();

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ ok: false, error: 'email_required' });
  }

  const ip = clientKey(req);
  if (!rateOk(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limit' });
  }

  try {
    const created = await createAdminPasswordResetForEmail(email);
    if (!created) {
      return res.json({ ok: true, message: PUBLIC_REPLY });
    }

    const base = (process.env.PUBLIC_SITE_URL || 'https://cutup.shop').replace(/\/$/, '');
    const resetUrl = `${base}/admin-reset.html?token=${encodeURIComponent(created.rawToken)}`;

    const html = `
      <p>You requested a password reset for the Cutup admin panel.</p>
      <p><a href="${resetUrl}">Set a new password</a></p>
      <p>This link expires in one hour. If you did not request this, you can ignore this email.</p>
      <p style="word-break:break-all;color:#64748b;font-size:12px;">${resetUrl}</p>
    `;

    const sent = await sendEmail({
      to: created.email,
      subject: 'Cutup admin — reset your password',
      html,
    });

    if (!sent.sent) {
      console.warn('[admin-forgot-password] email not sent (check SMTP). Reset URL:', resetUrl);
    }

    return res.json({ ok: true, message: PUBLIC_REPLY });
  } catch (e) {
    console.error('[admin-forgot-password]', e);
    return res.json({ ok: true, message: PUBLIC_REPLY });
  }
}
