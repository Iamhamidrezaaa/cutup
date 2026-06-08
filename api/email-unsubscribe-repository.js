import { getPool, isBillingDbConfigured } from './db/pool.js';

export async function ensureEmailPreferencesSchema() {
  if (!isBillingDbConfigured()) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_notification_preferences (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      marketing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      product_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      billing_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      security_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      locale VARCHAR(8) DEFAULT 'en',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS email_unsubscribes (
      email TEXT PRIMARY KEY,
      unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source VARCHAR(32) DEFAULT 'link'
    );
  `);
}

export async function unsubscribeEmailAddress(email) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureEmailPreferencesSchema();
  const em = String(email || '').trim().toLowerCase();
  if (!em) return { ok: false, reason: 'invalid_email' };

  const pool = getPool();
  await pool.query(
    `INSERT INTO email_unsubscribes (email, unsubscribed_at, source)
     VALUES ($1, NOW(), 'link')
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NOW(), source = 'link'`,
    [em],
  );

  const userRes = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [em]);
  const userId = userRes.rows[0]?.id;
  if (userId) {
    await pool.query(
      `INSERT INTO email_notification_preferences
        (user_id, marketing_enabled, product_updates_enabled, updated_at)
       VALUES ($1, FALSE, FALSE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         marketing_enabled = FALSE,
         product_updates_enabled = FALSE,
         updated_at = NOW()`,
      [userId],
    );
  }

  return { ok: true, email: em };
}

export async function isEmailUnsubscribed(email) {
  if (!isBillingDbConfigured()) return false;
  await ensureEmailPreferencesSchema();
  const em = String(email || '').trim().toLowerCase();
  if (!em) return false;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM email_unsubscribes WHERE lower(email) = lower($1) LIMIT 1`,
    [em],
  );
  return Boolean(rows[0]);
}
