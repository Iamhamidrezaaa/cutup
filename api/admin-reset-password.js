import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured } from './db/pool.js';
import { ensureAdminsSchema, resetAdminPasswordWithToken } from './admins-repository.js';

const resetMap = new Map();

function clientKey(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim() || 'unknown';
  return req.socket?.remoteAddress || 'unknown';
}

function rateOk(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 10;
  let arr = resetMap.get(ip) || [];
  arr = arr.filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  resetMap.set(ip, arr);
  return true;
}

export default async function adminResetPasswordHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  await ensureAdminsSchema();

  const ip = clientKey(req);
  if (!rateOk(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limit' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  const confirm = String(body.confirmPassword ?? body.confirm ?? '');

  if (!token) {
    return res.status(400).json({ ok: false, error: 'token_required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'password_too_short' });
  }
  if (password !== confirm) {
    return res.status(400).json({ ok: false, error: 'password_mismatch' });
  }

  try {
    const ok = await resetAdminPasswordWithToken(token, password);
    if (!ok) {
      return res.status(400).json({ ok: false, error: 'invalid_or_expired_token' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin-reset-password]', e);
    return res.status(500).json({ ok: false });
  }
}
