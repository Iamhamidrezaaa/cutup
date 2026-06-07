/**
 * Ensure email_send_log table exists (runtime bootstrap).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let ensured = false;

export async function ensureEmailSendLogSchema() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  if (ensured) return { ok: true, cached: true };

  const sql = readFileSync(join(__dirname, 'db', 'schema-email.sql'), 'utf8');
  const pool = getPool();
  await pool.query(sql);
  ensured = true;
  return { ok: true };
}
