import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPool, isBillingDbConfigured } from './db/pool.js';

const SEED_SUPER_EMAIL = 'instalogist.ir@gmail.com';
/** Initial bootstrap password — rotate after first login in production. */
const SEED_SUPER_PASSWORD = 'Hamidreza123@456';

export async function ensureAdminsSchemaAndSeed() {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(320) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'admin',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT admins_role_check CHECK (role IN ('super_admin', 'admin', 'editor')),
      CONSTRAINT admins_status_check CHECK (status IN ('active', 'disabled'))
    );
    CREATE INDEX IF NOT EXISTS idx_admins_email ON admins (email);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      email VARCHAR(320) NOT NULL,
      role VARCHAR(32) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);

    CREATE TABLE IF NOT EXISTS admin_password_resets (
      id BIGSERIAL PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_pw_reset_hash ON admin_password_resets (token_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_pw_reset_admin ON admin_password_resets (admin_id);
  `);

  const existing = await pool.query('SELECT id FROM admins WHERE email = $1', [
    SEED_SUPER_EMAIL.toLowerCase(),
  ]);
  if (existing.rows.length > 0) return;

  const password_hash = bcrypt.hashSync(SEED_SUPER_PASSWORD, 12);
  await pool.query(
    `INSERT INTO admins (email, password_hash, role, status) VALUES ($1, $2, 'super_admin', 'active')`,
    [SEED_SUPER_EMAIL.toLowerCase(), password_hash]
  );
  console.log('[admins] created bootstrap super_admin:', SEED_SUPER_EMAIL);
}

export async function getAdminByEmailForLogin(email) {
  const pool = getPool();
  const r = await pool.query(
    'SELECT id, email, password_hash, role, status FROM admins WHERE email = $1',
    [String(email || '').trim().toLowerCase()]
  );
  return r.rows[0] || null;
}

export async function listAdminsDb() {
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, email, role, status, created_at FROM admins ORDER BY id ASC`
  );
  return r.rows;
}

export async function insertAdminDb(email, password, role) {
  const pool = getPool();
  const em = String(email || '').trim().toLowerCase();
  const password_hash = bcrypt.hashSync(String(password), 12);
  const r = await pool.query(
    `INSERT INTO admins (email, password_hash, role, status) VALUES ($1, $2, $3, 'active')
     RETURNING id, email, role, status, created_at`,
    [em, password_hash, role]
  );
  return r.rows[0];
}

export async function updateAdminDb(id, { role, status }) {
  const pool = getPool();
  const rid = Number(id);
  if (!Number.isFinite(rid)) throw new Error('invalid id');
  if (role != null && status != null) {
    await pool.query('UPDATE admins SET role = $2, status = $3 WHERE id = $1', [rid, role, status]);
  } else if (role != null) {
    await pool.query('UPDATE admins SET role = $2 WHERE id = $1', [rid, role]);
  } else if (status != null) {
    await pool.query('UPDATE admins SET status = $2 WHERE id = $1', [rid, status]);
  }
}

/** Any admin row (any role / status). Returns { rawToken, email } or null if unknown email. */
export async function createAdminPasswordResetForEmail(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return null;
  const pool = getPool();
  const r = await pool.query('SELECT id, email FROM admins WHERE email = $1', [em]);
  const row = r.rows[0];
  if (!row) return null;
  await pool.query('DELETE FROM admin_password_resets WHERE admin_id = $1', [row.id]);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO admin_password_resets (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [row.id, tokenHash, expiresAt]
  );
  return { rawToken, email: row.email };
}

export async function resetAdminPasswordWithToken(rawToken, newPassword) {
  const t = String(rawToken || '').trim();
  if (!t || !newPassword) return false;
  const tokenHash = crypto.createHash('sha256').update(t).digest('hex');
  const pool = getPool();
  const r = await pool.query(
    `SELECT admin_id FROM admin_password_resets WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash]
  );
  const pr = r.rows[0];
  if (!pr) return false;
  await pool.query('DELETE FROM admin_password_resets WHERE admin_id = $1', [pr.admin_id]);
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = $1', [pr.admin_id]);
  const hash = bcrypt.hashSync(String(newPassword), 12);
  await pool.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, pr.admin_id]);
  return true;
}
