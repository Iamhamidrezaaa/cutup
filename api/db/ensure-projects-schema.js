/**
 * Idempotent projects schema — applies schema-projects.sql when tables are missing.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPool, isBillingDbConfigured } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let schemaReady = false;
let ensurePromise = null;

export async function ensureProjectsSchema() {
  if (!isBillingDbConfigured()) return false;
  if (schemaReady) return true;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    const pool = getPool();
    const check = await pool.query(
      `SELECT 1 AS ok
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'projects'
       LIMIT 1`
    );
    if (check.rows.length) {
      schemaReady = true;
      return true;
    }
    const sql = readFileSync(join(__dirname, 'schema-projects.sql'), 'utf8');
    await pool.query(sql);
    schemaReady = true;
    console.log('[projects-schema] Applied schema-projects.sql (projects + project_exports)');
    return true;
  })();

  try {
    return await ensurePromise;
  } catch (err) {
    ensurePromise = null;
    throw err;
  }
}

export function isProjectsSchemaReady() {
  return schemaReady;
}
