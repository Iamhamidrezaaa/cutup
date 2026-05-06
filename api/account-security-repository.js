import crypto from 'crypto';
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { getActiveAdminByEmail } from './user-roles.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

let _schemaEnsured = false;

export async function ensureAccountSecuritySchema() {
  if (!isBillingDbConfigured()) return;
  if (_schemaEnsured) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_sessions (
      session_id VARCHAR(128) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_user
    ON customer_sessions (user_id, expires_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delete_account_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_delete_account_tokens_hash
    ON delete_account_tokens (token_hash)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_delete_account_tokens_user_active
    ON delete_account_tokens (user_id, expires_at)
    WHERE used_at IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deleted_account_cooldowns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_normalized VARCHAR(320) NOT NULL,
      deleted_user_id UUID,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      blocked_until TIMESTAMPTZ NOT NULL,
      reason VARCHAR(64) NOT NULL DEFAULT 'account_deleted',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_deleted_account_cooldowns_email_active
    ON deleted_account_cooldowns (email_normalized, blocked_until DESC)
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(32) NOT NULL DEFAULT 'active'
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(128)
  `);
  await pool.query(`
    UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR TRIM(account_status) = ''
  `);
  _schemaEnsured = true;
}

function blockTicketSecret() {
  return String(process.env.SESSION_SECRET || process.env.JWT_SECRET || '').trim();
}

export function formatUnlockDateGregorian(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(d);
}

export function createLoginBlockTicket(email) {
  const secret = blockTicketSecret();
  const em = normalizeAccountEmail(email);
  if (!secret || !em) return null;
  const payload = {
    e: em,
    exp: Date.now() + 15 * 60 * 1000,
    n: crypto.randomBytes(8).toString('hex')
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * @returns {{ ok: true, email: string } | { ok: false }}
 */
export function verifyLoginBlockTicket(ticket) {
  const secret = blockTicketSecret();
  const raw = String(ticket || '').trim();
  if (!secret || !raw.includes('.')) return { ok: false };
  const [body, sig] = raw.split('.');
  if (!body || !sig) return { ok: false };
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false };
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.e || !payload?.exp || Date.now() > Number(payload.exp)) return { ok: false };
    return { ok: true, email: normalizeAccountEmail(payload.e) };
  } catch (_e) {
    return { ok: false };
  }
}

export async function getUserAccountByEmail(email) {
  const emailNormalized = normalizeAccountEmail(email);
  if (!emailNormalized || !isBillingDbConfigured()) return null;
  await ensureAccountSecuritySchema();
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, email, COALESCE(account_status, 'active') AS account_status, deleted_at, deletion_reason
     FROM users WHERE lower(email) = lower($1)
     LIMIT 1`,
    [emailNormalized]
  );
  return r.rows[0] || null;
}

/**
 * Server-side login block resolution (cooldown + deactivated account).
 */
export async function resolveLoginBlockForEmail(email) {
  const emailNormalized = normalizeAccountEmail(email);
  if (!emailNormalized) return { blocked: false };

  const cooldown = await getActiveAccountDeletionCooldown(emailNormalized);
  if (cooldown) {
    return {
      blocked: true,
      reason: 'cooldown',
      email: emailNormalized,
      unlockAt: cooldown.blocked_until,
      unlockDateLabel: formatUnlockDateGregorian(cooldown.blocked_until)
    };
  }

  const user = await getUserAccountByEmail(emailNormalized);
  const status = String(user?.account_status || 'active').toLowerCase();
  if (status === 'deactivated') {
    return {
      blocked: true,
      reason: 'deactivated',
      email: emailNormalized,
      unlockAt: null,
      unlockDateLabel: null,
      deletedAt: user.deleted_at || null
    };
  }
  if (status === 'banned') {
    return {
      blocked: true,
      reason: 'banned',
      email: emailNormalized,
      unlockAt: null,
      unlockDateLabel: null
    };
  }

  return { blocked: false };
}

export function buildLoginBlockedRedirectUrl(frontendBase, email) {
  const base = String(frontendBase || 'https://cutup.shop').replace(/\/$/, '');
  const ticket = createLoginBlockTicket(email);
  if (!ticket) {
    return `${base}/login.html?error=account_blocked`;
  }
  return `${base}/login.html?block_ticket=${encodeURIComponent(ticket)}`;
}

export function normalizeAccountEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const COOLDOWN_DAYS = 30;

/**
 * @returns {Promise<{ blocked_until: Date, reason: string } | null>}
 */
export async function getActiveAccountDeletionCooldown(email) {
  const emailNormalized = normalizeAccountEmail(email);
  if (!emailNormalized || !isBillingDbConfigured()) return null;
  await ensureAccountSecuritySchema();
  const pool = getPool();
  const r = await pool.query(
    `SELECT blocked_until, reason
     FROM deleted_account_cooldowns
     WHERE email_normalized = $1 AND blocked_until > NOW()
     ORDER BY blocked_until DESC
     LIMIT 1`,
    [emailNormalized]
  );
  const row = r.rows[0];
  if (!row) return null;
  console.log('[account-cooldown-active]', { email: emailNormalized, blockedUntil: row.blocked_until });
  return { blocked_until: row.blocked_until, reason: row.reason };
}

function hashDeleteToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '').trim()).digest('hex');
}

export async function registerCustomerSession(userId, sessionId, expiresAt) {
  if (!isBillingDbConfigured() || !userId || !sessionId) return;
  await ensureAccountSecuritySchema();
  const pool = getPool();
  await pool.query(
    `INSERT INTO customer_sessions (session_id, user_id, expires_at)
     VALUES ($1, $2::uuid, $3::timestamptz)
     ON CONFLICT (session_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       expires_at = EXCLUDED.expires_at`,
    [String(sessionId), userId, new Date(expiresAt)]
  );
}

export async function removeCustomerSession(sessionId) {
  if (!isBillingDbConfigured() || !sessionId) return;
  await ensureAccountSecuritySchema();
  const pool = getPool();
  await pool.query('DELETE FROM customer_sessions WHERE session_id = $1', [String(sessionId)]);
}

/**
 * Revoke DB-tracked sessions except current. Returns count revoked.
 */
export async function revokeOtherCustomerSessions(userId, keepSessionId) {
  if (!isBillingDbConfigured() || !userId) return 0;
  await ensureAccountSecuritySchema();
  const pool = getPool();
  const r = await pool.query(
    `DELETE FROM customer_sessions
     WHERE user_id = $1::uuid AND session_id <> $2
     RETURNING session_id`,
    [userId, String(keepSessionId || '')]
  );
  return r.rowCount || 0;
}

export async function getUserIdByEmail(email) {
  if (!email || !isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return r.rows[0]?.id || null;
}

export async function getUserDeleteEmailContext(userId) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT u.email, u.created_at, up.first_name
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1::uuid`,
    [userId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const created = row.created_at ? new Date(row.created_at) : new Date();
  const days = Math.max(1, Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000)));
  return {
    email: row.email,
    first_name: String(row.first_name || '').trim() || 'there',
    days_with_cutup: days
  };
}

/**
 * @returns {{ ok: true, rawToken: string, expiresAt: Date } | { ok: false, error: string }}
 */
export async function createDeleteAccountToken(userId) {
  if (!userId || !isBillingDbConfigured()) {
    return { ok: false, error: 'not_configured' };
  }
  await ensureAccountSecuritySchema();
  const pool = getPool();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashDeleteToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await pool.query(
    `UPDATE delete_account_tokens
     SET used_at = NOW()
     WHERE user_id = $1::uuid AND used_at IS NULL`,
    [userId]
  );

  await pool.query(
    `INSERT INTO delete_account_tokens (user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2, $3::timestamptz)`,
    [userId, tokenHash, expiresAt]
  );

  console.log('[delete-token-created]', { userId, expiresAt: expiresAt.toISOString() });
  return { ok: true, rawToken, expiresAt };
}

/**
 * @returns {{ status: 'valid', userId: string, tokenId: string } | { status: 'expired'|'used'|'invalid' }}
 */
export async function validateDeleteAccountToken(rawToken) {
  if (!rawToken || !isBillingDbConfigured()) {
    return { status: 'invalid' };
  }
  await ensureAccountSecuritySchema();
  const pool = getPool();
  const tokenHash = hashDeleteToken(rawToken);
  const r = await pool.query(
    `SELECT id, user_id, expires_at, used_at
     FROM delete_account_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  const row = r.rows[0];
  if (!row) return { status: 'invalid' };
  if (row.used_at) return { status: 'used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { status: 'expired' };
  console.log('[delete-token-validated]', { tokenId: row.id, userId: row.user_id });
  return { status: 'valid', userId: row.user_id, tokenId: row.id };
}

export async function markDeleteTokenUsed(tokenId) {
  if (!tokenId || !isBillingDbConfigured()) return;
  const pool = getPool();
  await pool.query(
    `UPDATE delete_account_tokens SET used_at = NOW() WHERE id = $1::uuid AND used_at IS NULL`,
    [tokenId]
  );
}

/**
 * Deactivate customer account (soft delete): revoke access, keep row for admin/analytics.
 */
export async function deleteCustomerAccountCompletely(userId, { deletionReason = 'user_requested' } = {}) {
  if (!userId || !isBillingDbConfigured()) {
    return { ok: false, error: 'not_configured' };
  }
  const pool = getPool();
  const uRes = await pool.query(
    `SELECT id, email, COALESCE(account_status, 'active') AS account_status
     FROM users WHERE id = $1::uuid`,
    [userId]
  );
  const user = uRes.rows[0];
  if (!user) return { ok: false, error: 'not_found' };
  if (await getActiveAdminByEmail(user.email)) {
    return { ok: false, error: 'cannot_delete_admin' };
  }
  if (String(user.account_status).toLowerCase() === 'deactivated') {
    return { ok: false, error: 'already_deactivated' };
  }

  await ensureAccountSecuritySchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE payments SET status = 'canceled', updated_at = NOW()
       WHERE user_id = $1::uuid AND status = 'pending'`,
      [userId]
    );
    await client.query(
      `UPDATE subscriptions
       SET status = 'canceled', plan = 'free', updated_at = NOW()
       WHERE user_id = $1::uuid`,
      [userId]
    );
    await client.query('DELETE FROM customer_sessions WHERE user_id = $1::uuid', [userId]);
    await client.query(
      `UPDATE delete_account_tokens SET used_at = COALESCE(used_at, NOW()) WHERE user_id = $1::uuid`,
      [userId]
    );
    try {
      await client.query('DELETE FROM saved_outputs WHERE user_id = $1::uuid', [userId]);
    } catch (_savedErr) {
      /* saved_outputs optional */
    }
    const emailNormalized = normalizeAccountEmail(user.email);
    await client.query(
      `INSERT INTO deleted_account_cooldowns (email_normalized, deleted_user_id, deleted_at, blocked_until, reason)
       VALUES ($1, $2::uuid, NOW(), NOW() + INTERVAL '${COOLDOWN_DAYS} days', 'account_deleted')`,
      [emailNormalized, userId]
    );
    console.log('[account-cooldown-recorded]', { email: emailNormalized, days: COOLDOWN_DAYS });
    await client.query(
      `UPDATE users
       SET account_status = 'deactivated',
           deleted_at = NOW(),
           deletion_reason = $2
       WHERE id = $1::uuid`,
      [userId, String(deletionReason || 'user_requested').slice(0, 128)]
    );
    await client.query('COMMIT');
    console.log('[account-deleted]', { userId, email: user.email, mode: 'deactivated' });
    return { ok: true, email: user.email, deactivated: true };
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[account-deleted] failed', e);
    return { ok: false, error: 'delete_failed' };
  } finally {
    client.release();
  }
}
