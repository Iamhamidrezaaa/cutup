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
  const cmsSql = readFileSync(join(__dirname, 'schema-cms.sql'), 'utf8');
  await getPool().query(cmsSql);
  console.log('Migration applied: schema-cms.sql');
  const cmsSoft = readFileSync(join(__dirname, 'schema-cms-soft-delete.sql'), 'utf8');
  await getPool().query(cmsSoft);
  console.log('Migration applied: schema-cms-soft-delete.sql');
  const cmsTax = readFileSync(join(__dirname, 'schema-cms-taxonomy.sql'), 'utf8');
  await getPool().query(cmsTax);
  console.log('Migration applied: schema-cms-taxonomy.sql');
  const cmsTrash = readFileSync(join(__dirname, 'schema-cms-status-trash.sql'), 'utf8');
  await getPool().query(cmsTrash);
  console.log('Migration applied: schema-cms-status-trash.sql');
  const blogHtml = readFileSync(join(__dirname, 'schema-blog-html-path.sql'), 'utf8');
  await getPool().query(blogHtml);
  console.log('Migration applied: schema-blog-html-path.sql');
  const projectsSql = readFileSync(join(__dirname, 'schema-projects.sql'), 'utf8');
  await getPool().query(projectsSql);
  console.log('Migration applied: schema-projects.sql');
  const creditsCycleSql = readFileSync(join(__dirname, 'migrate-credits-cycle.sql'), 'utf8');
  await getPool().query(creditsCycleSql);
  console.log('Migration applied: migrate-credits-cycle.sql');
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
