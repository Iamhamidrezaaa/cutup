/**
 * Incident notes / pins for audit forensics (admin-only).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';

let ensured = false;

export async function ensureAuditEventNotesSchema() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  if (ensured) return { ok: true, cached: true };

  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_event_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID REFERENCES audit_events(id) ON DELETE CASCADE,
      session_key TEXT,
      admin_email TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT false,
      pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_event_notes_event ON audit_event_notes (event_id);
    CREATE INDEX IF NOT EXISTS idx_audit_event_notes_session ON audit_event_notes (session_key)
      WHERE session_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_audit_event_notes_pinned ON audit_event_notes (pinned) WHERE pinned = true;
  `);

  ensured = true;
  return { ok: true };
}
