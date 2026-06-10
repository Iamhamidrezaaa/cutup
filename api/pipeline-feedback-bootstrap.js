import { getPool, isBillingDbConfigured } from './db/pool.js';

let schemaReady = false;

export async function ensurePipelineFeedbackSchema() {
  if (schemaReady) return { ok: true };
  if (!isBillingDbConfigured()) {
    return { ok: false, reason: 'db_not_configured' };
  }
  const pool = getPool();
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_email VARCHAR(255),
      session_id VARCHAR(128),
      action VARCHAR(32) NOT NULL,
      rating VARCHAR(8) NOT NULL,
      comment TEXT,
      metadata_json JSONB,
      client_ip VARCHAR(64),
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      resolved_at TIMESTAMPTZ,
      resolved_by_admin_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE pipeline_feedback ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE pipeline_feedback ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE pipeline_feedback ADD COLUMN IF NOT EXISTS resolved_by_admin_id BIGINT;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_feedback_created
    ON pipeline_feedback (created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_feedback_action_rating
    ON pipeline_feedback (action, rating, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pipeline_feedback_down_unresolved
    ON pipeline_feedback (created_at DESC)
    WHERE rating = 'down' AND resolved = FALSE;
  `);
  schemaReady = true;
  return { ok: true };
}
