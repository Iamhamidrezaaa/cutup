/**
 * Idempotent payment_attempts table (YekPay retry / verification tracking).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { clearTableExistsCache } from './admin-db-safe.js';

let ensured = false;

export async function ensurePaymentAttemptsSchema() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  if (ensured) return { ok: true, cached: true };

  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT payment_attempts_status_check CHECK (status IN ('pending', 'success', 'failed'))
    );
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON payment_attempts (user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON payment_attempts (payment_id, attempt_number DESC);
    CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON payment_attempts (status);
  `);

  await pool.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(64);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order_id_unique
      ON payments (provider_order_id)
      WHERE provider_order_id IS NOT NULL;
  `);

  clearTableExistsCache();
  ensured = true;
  return { ok: true };
}
