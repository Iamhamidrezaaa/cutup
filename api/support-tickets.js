/**
 * User Support Tickets API
 *
 * GET  /api/support/tickets?action=overview|list&ticket=TKT-...
 * POST /api/support/tickets  { action: create|reply, ... }
 */
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getUserIdByEmail, isBillingDbConfigured } from './billing-repository.js';
import {
  createSupportTicket,
  getUserTicketOverview,
  getUserSupportActivity,
  listUserTickets,
  getTicketForUser,
  addUserReply,
  closeTicketByUser,
} from './support-tickets-repository.js';
import { verifyTurnstileToken } from './support-turnstile.js';
import { notifyTicketCreated } from './support-notify.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : {};
}

async function resolveUser(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return null;
  }
  if (!isBillingDbConfigured()) {
    res.status(503).json({ ok: false, error: 'db_not_configured' });
    return null;
  }
  const sessionId = req.headers['x-session-id'] || req.query?.session || parseBody(req)?.session;
  if (!sessionId) {
    res.status(401).json({ ok: false, error: 'no_session' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return null;
  }
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    res.status(401).json({ ok: false, error: 'session_expired' });
    return null;
  }
  const userId = await getUserIdByEmail(session.user.email);
  if (!userId) {
    res.status(404).json({ ok: false, error: 'user_not_found' });
    return null;
  }
  return {
    email: session.user.email,
    userId: String(userId),
    firstName: session.user.given_name || session.user.name?.split(' ')?.[0] || 'there',
  };
}

export default async function handler(req, res) {
  const user = await resolveUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action || 'list').trim();
      if (action === 'overview') {
        const result = await getUserTicketOverview(user.userId);
        return res.json({ ok: true, stats: result.stats });
      }
      if (action === 'activity') {
        const result = await getUserSupportActivity(user.userId, { limit: req.query?.limit });
        return res.json({ ok: true, activity: result.activity || [] });
      }
      const ticketNumber = String(req.query?.ticket || '').trim();
      if (ticketNumber) {
        const detail = await getTicketForUser(user.userId, ticketNumber);
        if (!detail.ok) return res.status(404).json({ ok: false, error: detail.reason });
        return res.json({
          ok: true,
          ticket: detail.ticket,
          messages: detail.messages,
          events: detail.events || [],
        });
      }
      const list = await listUserTickets(user.userId, {
        page: req.query?.page,
        limit: req.query?.limit,
      });
      return res.json({ ok: true, ...list });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body?.action || '').trim();

      if (action === 'create') {
        if (body?.website) return res.json({ ok: true });
        const captcha = await verifyTurnstileToken(body?.cfToken);
        if (!captcha.ok) {
          const code = captcha.error === 'captcha_not_configured' ? 503 : 403;
          return res.status(code).json({ ok: false, error: captcha.error });
        }
        const result = await createSupportTicket({
          userId: user.userId,
          department: body.department,
          priority: body.priority || 'NORMAL',
          subject: body.subject,
          message: body.message,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        try {
          await notifyTicketCreated({
            ticket: result.ticket,
            userEmail: user.email,
            firstName: user.firstName,
          });
        } catch (notifyErr) {
          console.error('[support-tickets] notifyTicketCreated failed', notifyErr);
        }
        return res.json({ ok: true, ticket: result.ticket });
      }

      if (action === 'reply') {
        const ticketNumber = String(body?.ticketNumber || body?.ticket || '').trim();
        const result = await addUserReply(user.userId, ticketNumber, body?.message, body?.attachments);
        if (!result.ok) {
          const code = result.reason === 'not_found' ? 404 : 400;
          return res.status(code).json({ ok: false, error: result.reason });
        }
        return res.json({ ok: true, message: result.message, ticket: result.ticket });
      }

      if (action === 'close') {
        const ticketNumber = String(body?.ticketNumber || body?.ticket || '').trim();
        const result = await closeTicketByUser(user.userId, ticketNumber, body?.satisfactionRating ?? body?.rating);
        if (!result.ok) {
          const code = result.reason === 'not_found' ? 404 : 400;
          return res.status(code).json({ ok: false, error: result.reason });
        }
        return res.json({ ok: true, ticket: result.ticket });
      }

      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[support-tickets]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
