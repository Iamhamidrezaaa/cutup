/**
 * HttpOnly cookie + PostgreSQL-backed admin panel sessions (separate from Google user auth).
 * DB storage keeps logins working across serverless instances (e.g. Vercel).
 */
import crypto from 'crypto';
import { getPool, isBillingDbConfigured } from './db/pool.js';

export const ADMIN_SESSION_COOKIE = 'admin_session';
const SESSION_MS = 24 * 60 * 60 * 1000; // 24h

export function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  const parts = raw.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return '';
}

export function setAdminSessionCookie(res, token, maxAgeSec = 86400) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearAdminSessionCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [`${ADMIN_SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function generateAdminSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Persist session row (call after ensureAdminsSchemaAndSeed / admin_sessions table exists). */
export async function saveAdminSession(token, record) {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  const t = String(token || '').trim();
  const adminId = Number(record.id);
  if (!t || !Number.isFinite(adminId)) return;
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await pool.query(
    `INSERT INTO admin_sessions (token, admin_id, email, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [t, adminId, String(record.email || '').toLowerCase(), String(record.role || 'admin'), expiresAt]
  );
}

export async function destroyAdminSessionToken(token) {
  if (!isBillingDbConfigured()) return;
  const t = String(token || '').trim();
  if (!t) return;
  const pool = getPool();
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [t]);
}

export async function resolveAdminAuth(req) {
  if (!isBillingDbConfigured()) return null;
  const token = getCookie(req, ADMIN_SESSION_COOKIE);
  const t = String(token || '').trim();
  if (!t) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT admin_id, email, role, expires_at
     FROM admin_sessions
     WHERE token = $1 AND expires_at > NOW()`,
    [t]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    adminId: Number(row.admin_id),
    email: row.email,
    role: row.role,
    token: t,
  };
}
