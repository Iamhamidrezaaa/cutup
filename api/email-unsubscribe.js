/**
 * GET  /api/email/unsubscribe?token=...
 * POST /api/email/unsubscribe  { token }
 */
import { setCORSHeaders } from './cors.js';
import { unsubscribeEmailAddress } from './email-unsubscribe-repository.js';
import { verifyUnsubscribeToken } from './email-unsubscribe-token.js';

function maskEmail(email) {
  const em = String(email || '');
  const at = em.indexOf('@');
  if (at <= 1) return '***';
  return `${em.slice(0, 2)}***${em.slice(at)}`;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  try {
    const token = String(req.query?.token || parseBody(req)?.token || '').trim();
    if (!token) return res.status(400).json({ ok: false, error: 'token_required' });

    const email = verifyUnsubscribeToken(token);
    if (!email) return res.status(400).json({ ok: false, error: 'invalid_token' });

    if (req.method === 'GET') {
      return res.json({ ok: true, emailMasked: maskEmail(email) });
    }

    if (req.method === 'POST') {
      const result = await unsubscribeEmailAddress(email);
      if (!result.ok) return res.status(503).json({ ok: false, error: result.reason });
      return res.json({ ok: true, emailMasked: maskEmail(email) });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[email-unsubscribe]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
