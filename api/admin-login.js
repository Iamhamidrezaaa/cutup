import bcrypt from 'bcryptjs';
import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured } from './db/pool.js';
import { getAdminByEmailForLogin } from './admins-repository.js';
import {
  setAdminSessionCookie,
  generateAdminSessionToken,
  saveAdminSession,
} from './admin-panel-auth.js';
import { ensureAdminsSchemaAndSeed } from './admins-repository.js';

const failMap = new Map(); // ip -> { count, lockUntil }

function clientKey(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim() || 'unknown';
  return req.socket?.remoteAddress || 'unknown';
}

function isBlocked(ip) {
  const row = failMap.get(ip);
  if (!row) return false;
  if (row.lockUntil && Date.now() < row.lockUntil) return true;
  if (row.lockUntil && Date.now() >= row.lockUntil) {
    failMap.delete(ip);
    return false;
  }
  return false;
}

function recordFail(ip) {
  const row = failMap.get(ip) || { count: 0, lockUntil: 0 };
  row.count += 1;
  if (row.count >= 5) {
    row.lockUntil = Date.now() + 15 * 60 * 1000;
    row.count = 0;
    console.warn('[admin-login] rate limit lock', ip);
  }
  failMap.set(ip, row);
}

function clearFails(ip) {
  failMap.delete(ip);
}

export default async function adminLoginHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  await ensureAdminsSchemaAndSeed();

  const ip = clientKey(req);
  if (isBlocked(ip)) {
    return res.status(429).json({ ok: false, error: 'too_many_attempts' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    const row = await getAdminByEmailForLogin(email);
    if (!row || row.status !== 'active') {
      recordFail(ip);
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) {
      recordFail(ip);
      return res.status(401).json({ ok: false, error: 'invalid_credentials' });
    }

    clearFails(ip);
    const token = generateAdminSessionToken();
    await saveAdminSession(token, {
      id: row.id,
      email: row.email,
      role: row.role,
    });
    setAdminSessionCookie(res, token, 86400);
    console.log('[admin-login] success', email);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin-login]', e);
    return res.status(500).json({ ok: false });
  }
}
