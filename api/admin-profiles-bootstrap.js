import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPool, isBillingDbConfigured } from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let ensured = false;

export async function ensureAdminProfilesSchema() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  if (ensured) return { ok: true, cached: true };
  const sql = readFileSync(join(__dirname, 'db', 'schema-admin-profiles.sql'), 'utf8');
  await getPool().query(sql);
  ensured = true;
  return { ok: true };
}
