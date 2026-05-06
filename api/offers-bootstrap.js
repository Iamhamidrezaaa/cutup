import { getPool, isBillingDbConfigured } from './db/pool.js';

let ensurePromise = null;
let offersSchemaReady = false;
let lastError = null;

function isMissingRelationError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err?.code === '42P01' || msg.includes('relation') || msg.includes('does not exist');
}

export async function ensureOffersSchema() {
  if (!isBillingDbConfigured()) {
    offersSchemaReady = false;
    lastError = new Error('billing_unavailable');
    return { ok: false, reason: 'billing_unavailable' };
  }
  if (offersSchemaReady) return { ok: true };
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS offers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(64) NOT NULL,
          title VARCHAR(160) NOT NULL,
          description TEXT,
          discount_type VARCHAR(32) NOT NULL,
          discount_value NUMERIC(12,4) NOT NULL DEFAULT 0,
          applicable_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
          max_uses INTEGER,
          current_uses INTEGER NOT NULL DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT true,
          starts_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          campaign_type VARCHAR(32) NOT NULL DEFAULT 'global',
          source_plan VARCHAR(32),
          target_plan VARCHAR(32)
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS offers_code_unique_ci ON offers (LOWER(code));`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_offers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
          status VARCHAR(16) NOT NULL DEFAULT 'active',
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          used_at TIMESTAMPTZ
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_offers_user_offer_unique ON user_offers (user_id, offer_id);`);
      await client.query(`CREATE INDEX IF NOT EXISTS user_offers_user_idx ON user_offers (user_id);`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS offer_redemptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
          payment_id UUID,
          original_amount_eur NUMERIC(14,4) NOT NULL,
          discount_amount_eur NUMERIC(14,4) NOT NULL,
          final_amount_eur NUMERIC(14,4) NOT NULL,
          redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS offer_redemptions_user_offer_unique ON offer_redemptions (user_id, offer_id);`);

      await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount_eur NUMERIC(14,4);`);
      await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount_eur NUMERIC(14,4);`);
      await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_amount_eur NUMERIC(14,4);`);
      await client.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS applied_offer_id UUID REFERENCES offers(id) ON DELETE SET NULL;`);
      await client.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(32) NOT NULL DEFAULT 'global';`);
      await client.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS source_plan VARCHAR(32);`);
      await client.query(`ALTER TABLE offers ADD COLUMN IF NOT EXISTS target_plan VARCHAR(32);`);

      await client.query('COMMIT');
      offersSchemaReady = true;
      lastError = null;
      return { ok: true };
    } catch (err) {
      await client.query('ROLLBACK');
      offersSchemaReady = false;
      lastError = err;
      return { ok: false, reason: isMissingRelationError(err) ? 'schema_unavailable' : 'schema_bootstrap_failed', error: err?.message || String(err) };
    } finally {
      client.release();
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}

export function getOffersSchemaStatus() {
  return {
    ready: offersSchemaReady,
    lastError: lastError ? (lastError.message || String(lastError)) : null
  };
}

const OFFERS_TABLES = ['offers', 'user_offers', 'offer_redemptions'];
const OFFERS_REQUIRED_COLUMNS = ['source_plan', 'target_plan', 'campaign_type', 'active', 'expires_at'];

export async function getOffersSchemaIntrospection(clientOrPool = null) {
  if (!isBillingDbConfigured()) {
    return { ok: false, reason: 'billing_unavailable' };
  }
  const runner = clientOrPool || getPool();
  const tablesPresent = {};
  for (const t of OFFERS_TABLES) {
    const r = await runner.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS ok`,
      [t]
    );
    tablesPresent[t] = Boolean(r.rows[0]?.ok);
  }
  const colR = await runner.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'offers'
       AND column_name = ANY($1::text[])`,
    [OFFERS_REQUIRED_COLUMNS]
  );
  const have = new Set((colR.rows || []).map((row) => row.column_name));
  const columnsPresent = Object.fromEntries(OFFERS_REQUIRED_COLUMNS.map((c) => [c, have.has(c)]));
  const uoCols = await runner.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_offers'`
  );
  const userOffersColumnNames = (uoCols.rows || []).map((row) => row.column_name);
  return {
    ok: true,
    tablesPresent,
    columnsPresent,
    userOffersHasAssignedAt: userOffersColumnNames.includes('assigned_at'),
    userOffersHasCreatedAt: userOffersColumnNames.includes('created_at'),
    allRequiredOfferColumns: OFFERS_REQUIRED_COLUMNS.every((c) => have.has(c))
  };
}

/**
 * Production introspection: confirms tables + critical columns exist (logs only).
 */
export async function logOffersSchemaCheck(clientOrPool = null) {
  try {
    const snap = await getOffersSchemaIntrospection(clientOrPool);
    console.log('[offers-schema-check]', snap);
  } catch (e) {
    console.log('[offers-schema-check]', { ok: false, error: e?.message || String(e) });
  }
}

