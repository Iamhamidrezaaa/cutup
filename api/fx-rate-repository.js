import { getPool, isBillingDbConfigured } from './db/pool.js';

const PAIR = 'EUR_IRR';

let tableReady = false;

async function ensureFxTable(pool) {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
      pair VARCHAR(32) PRIMARY KEY DEFAULT 'EUR_IRR',
      rate_irr NUMERIC(20, 4) NOT NULL,
      rate_raw TEXT,
      source VARCHAR(64) NOT NULL,
      navasan_item VARCHAR(64),
      change_24h NUMERIC(14, 4),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      meta JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  tableReady = true;
}

function mapRow(row) {
  if (!row) return null;
  return {
    pair: row.pair,
    rateIrr: Number(row.rate_irr),
    rateRaw: row.rate_raw || null,
    source: row.source,
    navasanItem: row.navasan_item || null,
    change24h: row.change_24h != null ? Number(row.change_24h) : null,
    fetchedAt: row.fetched_at?.toISOString?.() || row.fetched_at,
    meta: row.meta || {}
  };
}

export async function getCachedEurIrrRateDb() {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  await ensureFxTable(pool);
  const r = await pool.query(
    `SELECT pair, rate_irr, rate_raw, source, navasan_item, change_24h, fetched_at, meta
     FROM fx_rate_snapshots WHERE pair = $1 LIMIT 1`,
    [PAIR]
  );
  return mapRow(r.rows[0]);
}

export async function upsertEurIrrRateDb(snapshot) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  await ensureFxTable(pool);
  const r = await pool.query(
    `INSERT INTO fx_rate_snapshots (pair, rate_irr, rate_raw, source, navasan_item, change_24h, fetched_at, meta)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::jsonb)
     ON CONFLICT (pair) DO UPDATE SET
       rate_irr = EXCLUDED.rate_irr,
       rate_raw = EXCLUDED.rate_raw,
       source = EXCLUDED.source,
       navasan_item = EXCLUDED.navasan_item,
       change_24h = EXCLUDED.change_24h,
       fetched_at = EXCLUDED.fetched_at,
       meta = EXCLUDED.meta
     RETURNING pair, rate_irr, rate_raw, source, navasan_item, change_24h, fetched_at, meta`,
    [
      PAIR,
      snapshot.rateIrr,
      snapshot.rateRaw || null,
      snapshot.source,
      snapshot.navasanItem || null,
      snapshot.change24h != null ? snapshot.change24h : null,
      JSON.stringify(snapshot.meta || {})
    ]
  );
  return mapRow(r.rows[0]);
}
