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
