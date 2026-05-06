#!/usr/bin/env node
/**
 * Apply a single blog seed file by name (idempotent upsert).
 *
 * Usage:
 *   node api/db/seed-blog-post.mjs best-ai-subtitle-generators-2026
 *
 * Requires DATABASE_URL.
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPool, isBillingDbConfigured, closePool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const slugArg = process.argv[2];
  if (!slugArg) {
    console.error('Usage: node api/db/seed-blog-post.mjs <slug>');
    process.exit(1);
  }
  if (!isBillingDbConfigured()) {
    console.error('Set DATABASE_URL before running the seed.');
    process.exit(1);
  }
  const file = join(__dirname, 'seeds', `blog-${slugArg}.sql`);
  if (!existsSync(file)) {
    console.error(`Seed not found: ${file}`);
    process.exit(1);
  }
  const sql = readFileSync(file, 'utf8');
  await getPool().query(sql);
  console.log(`Blog seed applied: ${slugArg}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
