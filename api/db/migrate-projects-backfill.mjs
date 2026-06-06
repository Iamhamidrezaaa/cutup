#!/usr/bin/env node
/**
 * Backfill projects from existing saved_outputs rows.
 * Run after schema-projects.sql: node api/db/migrate-projects-backfill.mjs
 */
import { getPool, isBillingDbConfigured, closePool } from './pool.js';

async function main() {
  if (!isBillingDbConfigured()) {
    console.error('Set DATABASE_URL first.');
    process.exit(1);
  }
  const pool = getPool();

  const groups = await pool.query(
    `SELECT user_id,
            COALESCE(source_url, '') AS source_url,
            COALESCE(title, '') AS title,
            MAX(platform) AS platform,
            MAX(language) AS language,
            MIN(created_at) AS created_at,
            MAX(updated_at) AS updated_at,
            string_agg(DISTINCT LEFT(content, 500), E'\\n' ORDER BY LEFT(content, 500)) AS search_blob
     FROM saved_outputs
     WHERE project_id IS NULL
     GROUP BY user_id, COALESCE(source_url, ''), COALESCE(title, '')
     ORDER BY MAX(updated_at) DESC`
  );

  let created = 0;
  let linked = 0;

  for (const g of groups.rows) {
    const hasOutputs = await pool.query(
      `SELECT id, type FROM saved_outputs
       WHERE user_id = $1
         AND COALESCE(source_url, '') = $2
         AND COALESCE(title, '') = $3`,
      [g.user_id, g.source_url, g.title]
    );
    const types = new Set(hasOutputs.rows.map((r) => r.type));
    const transcriptStatus = types.size ? 'ready' : 'none';

    const ins = await pool.query(
      `INSERT INTO projects
        (user_id, title, source_url, platform, language, transcript_status, search_text, created_at, updated_at)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        g.user_id,
        g.title,
        g.source_url,
        g.platform,
        g.language,
        transcriptStatus,
        String(g.search_blob || '').slice(0, 12000),
        g.created_at,
        g.updated_at
      ]
    );
    const projectId = ins.rows[0].id;
    created += 1;

    const upd = await pool.query(
      `UPDATE saved_outputs SET project_id = $1
       WHERE user_id = $2
         AND COALESCE(source_url, '') = $3
         AND COALESCE(title, '') = $4`,
      [projectId, g.user_id, g.source_url, g.title]
    );
    linked += upd.rowCount || 0;
  }

  console.log(`Backfill complete: ${created} projects created, ${linked} outputs linked.`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
