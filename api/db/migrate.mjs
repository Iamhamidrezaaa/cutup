#!/usr/bin/env node
/**
 * Apply api/db/schema.sql — requires DATABASE_URL in environment.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPool, isBillingDbConfigured, closePool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!isBillingDbConfigured()) {
    console.error('Set DATABASE_URL before running migrations.');
    process.exit(1);
  }
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('Migration applied: schema.sql');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
