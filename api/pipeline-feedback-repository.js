import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensurePipelineFeedbackSchema } from './pipeline-feedback-bootstrap.js';

const ACTION_LABELS = {
  transcription: 'Transcription',
  translation: 'Translation',
  export: 'Video export'
};

const KIND_LABELS = {
  fulltext: 'Transcript',
  summary: 'Summary',
  srt: 'Subtitles (SRT)'
};

export function formatPipelineFeedbackStage(action, metadata = {}) {
  const base = ACTION_LABELS[String(action || '').toLowerCase()] || action || 'Unknown';
  const kind = metadata?.kind ? KIND_LABELS[String(metadata.kind).toLowerCase()] || metadata.kind : null;
  if (action === 'translation' && kind) return `${base} · ${kind}`;
  return base;
}

function parseMetadataJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function mapFeedbackRow(row) {
  const metadata = parseMetadataJson(row.metadata_json);
  return {
    id: row.id,
    userEmail: row.user_email || null,
    sessionId: row.session_id || null,
    action: row.action,
    rating: row.rating,
    comment: row.comment || null,
    metadata,
    stageLabel: formatPipelineFeedbackStage(row.action, metadata),
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at || null,
    resolvedByAdminId: row.resolved_by_admin_id || null,
    createdAt: row.created_at
  };
}

export async function insertPipelineFeedback(row) {
  if (!isBillingDbConfigured()) {
    console.log('[pipeline-feedback]', JSON.stringify(row));
    return { ok: true, stored: false, id: null };
  }

  await ensurePipelineFeedbackSchema();
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO pipeline_feedback (
      user_email, session_id, action, rating, comment, metadata_json, client_ip
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    RETURNING id, user_email, session_id, action, rating, comment, metadata_json, resolved, created_at`,
    [
      row.userEmail || null,
      row.sessionId || null,
      row.action,
      row.rating,
      row.comment || null,
      JSON.stringify(row.metadata || {}),
      row.clientIp || null
    ]
  );
  const inserted = result.rows[0];
  return {
    ok: true,
    stored: true,
    id: inserted?.id || null,
    feedback: inserted ? mapFeedbackRow(inserted) : null
  };
}

export async function getPipelineFeedbackAnalytics() {
  if (!isBillingDbConfigured()) {
    return { up: 0, down: 0, total: 0, unresolvedDown: 0 };
  }
  await ensurePipelineFeedbackSchema();
  const pool = getPool();
  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE rating = 'up')::int AS up_count,
      COUNT(*) FILTER (WHERE rating = 'down')::int AS down_count,
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (WHERE rating = 'down' AND resolved = FALSE)::int AS unresolved_down
    FROM pipeline_feedback
  `);
  const row = r.rows[0] || {};
  return {
    up: Number(row.up_count) || 0,
    down: Number(row.down_count) || 0,
    total: Number(row.total_count) || 0,
    unresolvedDown: Number(row.unresolved_down) || 0
  };
}

export async function listPipelineFeedbackForAdmin({ rating = 'down', resolved = null, limit = 100 } = {}) {
  if (!isBillingDbConfigured()) {
    return { items: [], total: 0 };
  }
  await ensurePipelineFeedbackSchema();
  const pool = getPool();
  const params = [];
  const where = [];

  if (rating) {
    params.push(String(rating));
    where.push(`rating = $${params.length}`);
  }
  if (resolved === true || resolved === 'true') {
    where.push('resolved = TRUE');
  } else if (resolved === false || resolved === 'false') {
    where.push('resolved = FALSE');
  }

  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  params.push(lim);

  const sql = `
    SELECT id, user_email, session_id, action, rating, comment, metadata_json,
           resolved, resolved_at, resolved_by_admin_id, created_at
    FROM pipeline_feedback
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  const items = r.rows.map(mapFeedbackRow);
  return { items, total: items.length };
}

export async function resolvePipelineFeedback(id, adminId) {
  if (!isBillingDbConfigured()) {
    return { ok: false, reason: 'db_not_configured' };
  }
  await ensurePipelineFeedbackSchema();
  const pool = getPool();
  const r = await pool.query(
    `UPDATE pipeline_feedback
     SET resolved = TRUE,
         resolved_at = NOW(),
         resolved_by_admin_id = $2
     WHERE id = $1::uuid
     RETURNING id, user_email, action, rating, comment, metadata_json, resolved, resolved_at, resolved_by_admin_id, created_at`,
    [String(id), Number(adminId) || null]
  );
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  return { ok: true, feedback: mapFeedbackRow(r.rows[0]) };
}
