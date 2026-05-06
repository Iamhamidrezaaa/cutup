import { getPool, isBillingDbConfigured } from './db/pool.js';

let ensurePromise = null;
let schemaReady = false;

export async function ensureCreatorWallSchema() {
  if (!isBillingDbConfigured()) {
    schemaReady = false;
    return { ok: false, reason: 'billing_unavailable' };
  }
  if (schemaReady) return { ok: true };
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPool();
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_wall_posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        thumbnail_url TEXT,
        preview_video_url TEXT,
        style_preset VARCHAR(64) NOT NULL,
        platform VARCHAR(32),
        language VARCHAR(16),
        country_code VARCHAR(8),
        feedback TEXT,
        creator_name VARCHAR(120),
        social_handle VARCHAR(120),
        stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        user_email VARCHAR(320),
        export_job_id VARCHAR(64),
        approved BOOLEAN NOT NULL DEFAULT false,
        featured BOOLEAN NOT NULL DEFAULT false,
        hidden BOOLEAN NOT NULL DEFAULT false,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_wall_posts_public
        ON creator_wall_posts (approved, hidden, featured DESC, sort_order DESC, created_at DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_wall_posts_pending
        ON creator_wall_posts (approved, created_at DESC)
        WHERE approved = false AND hidden = false;
    `);
    schemaReady = true;
    return { ok: true };
  })().finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}
