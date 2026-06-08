import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ensured = false;

export async function ensureSupportTicketsSchema() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  if (ensured) return { ok: true, cached: true };
  const sql = readFileSync(join(__dirname, 'db', 'schema-support.sql'), 'utf8');
  const pool = getPool();
  await pool.query(sql);
  await pool.query(`
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS satisfaction_rating SMALLINT NULL;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_by VARCHAR(20) NULL;
  `);
  ensured = true;
  return { ok: true };
}
