/**
 * Projects + export history persistence.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureProjectsSchema } from './db/ensure-projects-schema.js';
import { ensureUserByEmail } from './billing-repository.js';

const EXPORT_FILE_TTL_DAYS = Number(process.env.PROJECT_EXPORT_TTL_DAYS || 14);
const PROJECT_SEARCH_SNIPPET = 12000;

function normUrl(url) {
  const v = String(url || '').trim();
  return v || null;
}

function buildSearchText(parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p).slice(0, 4000))
    .join('\n')
    .slice(0, PROJECT_SEARCH_SNIPPET);
}

async function resolveUserId(email) {
  if (!email) return null;
  await ensureUserByEmail(email);
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return r.rows[0]?.id || null;
}

function mapProjectRow(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    sourceFilename: row.source_filename,
    platform: row.platform,
    language: row.language,
    thumbnailUrl: row.thumbnail_url,
    transcriptStatus: row.transcript_status,
    exportStatus: row.export_status,
    lifecycleStatus: row.lifecycle_status,
    settings: row.settings || {},
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    lastOpenedAt: row.last_opened_at?.toISOString?.() || row.last_opened_at || null,
    exportCount: Number(extras.exportCount || 0),
    latestExportAt: extras.latestExportAt || null,
    hasTranscript: Boolean(extras.hasTranscript),
    hasSummary: Boolean(extras.hasSummary),
    hasSrt: Boolean(extras.hasSrt)
  };
}

function mapExportRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    renderJobId: row.render_job_id,
    presetId: row.preset_id,
    presetName: row.preset_name,
    quality: row.quality,
    captionMode: row.caption_mode,
    status: row.status,
    sourceUrl: row.source_url,
    outputFilename: row.output_filename,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    videoDurationSec: row.video_duration_sec != null ? Number(row.video_duration_sec) : null,
    renderDurationSec: row.render_duration_sec != null ? Number(row.render_duration_sec) : null,
    resolution: row.resolution,
    errorMessage: row.error_message,
    metadata: row.metadata || {},
    completedAt: row.completed_at?.toISOString?.() || row.completed_at || null,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    downloadReady: row.status === 'completed'
  };
}

export function isProjectsDbConfigured() {
  return isBillingDbConfigured();
}

/**
 * Upsert project when saving transcript/summary/srt.
 */
export async function upsertProjectFromSaveOutput(email, payload = {}) {
  const userId = await resolveUserId(email);
  if (!userId) return null;

  const {
    type,
    title = null,
    platform = null,
    sourceUrl = null,
    language = null,
    content = '',
    metadata = {},
    projectId: explicitProjectId = null
  } = payload;

  const pool = getPool();
  const url = normUrl(sourceUrl || metadata.sourceUrl);
  const filename = metadata.sourceFilename || metadata.filename || null;
  const thumbnailUrl = metadata.thumbnailUrl || metadata.thumbnail_url || null;
  const snippet = String(content || '').slice(0, 2000);

  let projectId = explicitProjectId || metadata.projectId || null;
  let priorSearchText = '';

  if (!projectId) {
    const existing = await pool.query(
      `SELECT id, search_text FROM projects
       WHERE user_id = $1
         AND lifecycle_status = 'active'
         AND (
           ($2::text IS NOT NULL AND source_url = $2)
           OR ($2 IS NULL AND $3::text IS NOT NULL AND source_filename = $3)
           OR ($4::text IS NOT NULL AND title = $4 AND created_at > NOW() - INTERVAL '7 days')
         )
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, url, filename, title]
    );
    if (existing.rows.length) {
      projectId = existing.rows[0].id;
      priorSearchText = existing.rows[0].search_text || '';
    }
  } else {
    const prior = await pool.query(`SELECT search_text FROM projects WHERE id = $1`, [projectId]);
    priorSearchText = prior.rows[0]?.search_text || '';
  }

  const transcriptStatus = type && content ? 'ready' : 'in_progress';
  const searchText = buildSearchText([title, url, filename, priorSearchText, snippet]);

  if (!projectId) {
    const ins = await pool.query(
      `INSERT INTO projects
        (user_id, title, source_url, source_filename, platform, language, thumbnail_url,
         transcript_status, search_text, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id`,
      [
        userId,
        title,
        url,
        filename,
        platform,
        language,
        thumbnailUrl,
        transcriptStatus,
        searchText,
        JSON.stringify(metadata.settings || {})
      ]
    );
    projectId = ins.rows[0].id;
  } else {
    await pool.query(
      `UPDATE projects SET
         title = COALESCE($3, title),
         source_url = COALESCE($4, source_url),
         source_filename = COALESCE($5, source_filename),
         platform = COALESCE($6, platform),
         language = COALESCE($7, language),
         thumbnail_url = COALESCE($8, thumbnail_url),
         transcript_status = CASE
           WHEN $9 = 'ready' THEN 'ready'
           ELSE transcript_status
         END,
         search_text = $10,
         updated_at = NOW()
       WHERE id = $2 AND user_id = $1`,
      [
        userId,
        projectId,
        title,
        url,
        filename,
        platform,
        language,
        thumbnailUrl,
        transcriptStatus,
        searchText
      ]
    );
  }

  return projectId;
}

export async function linkSavedOutputToProject(outputId, projectId) {
  if (!outputId || !projectId) return;
  const pool = getPool();
  await pool.query(`UPDATE saved_outputs SET project_id = $2, updated_at = NOW() WHERE id = $1::bigint`, [
    outputId,
    projectId
  ]);
}

export async function listProjectsDb(email, opts = {}) {
  await ensureProjectsSchema();
  const userId = await resolveUserId(email);
  if (!userId) return { items: [], total: 0, page: 1, limit: 20 };

  const page = Math.max(1, Number(opts.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 20));
  const offset = (page - 1) * limit;
  const filter = String(opts.filter || 'all').toLowerCase();
  const search = String(opts.search || '').trim();

  const pool = getPool();
  const where = ['p.user_id = $1'];
  const params = [userId];
  let pi = 2;

  if (filter === 'archived') {
    where.push(`p.lifecycle_status = 'archived'`);
  } else {
    where.push(`p.lifecycle_status = 'active'`);
    if (filter === 'in_progress') {
      where.push(`(p.export_status IN ('none', 'in_progress', 'failed') AND p.transcript_status = 'ready')`);
    } else if (filter === 'exported') {
      where.push(`p.export_status = 'exported'`);
    }
  }

  if (search) {
    where.push(
      `(p.title ILIKE $${pi} OR p.source_url ILIKE $${pi} OR p.source_filename ILIKE $${pi} OR p.search_text ILIKE $${pi})`
    );
    params.push(`%${search}%`);
    pi += 1;
  }

  const whereSql = where.join(' AND ');
  const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM projects p WHERE ${whereSql}`, params);
  const total = countRes.rows[0]?.c || 0;

  const listRes = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM project_exports e WHERE e.project_id = p.id AND e.status = 'completed') AS export_count,
            (SELECT MAX(e.completed_at) FROM project_exports e WHERE e.project_id = p.id AND e.status = 'completed') AS latest_export_at,
            EXISTS(SELECT 1 FROM saved_outputs o WHERE o.project_id = p.id AND o.type = 'transcript') AS has_transcript,
            EXISTS(SELECT 1 FROM saved_outputs o WHERE o.project_id = p.id AND o.type = 'summary') AS has_summary,
            EXISTS(SELECT 1 FROM saved_outputs o WHERE o.project_id = p.id AND o.type = 'srt') AS has_srt
     FROM projects p
     WHERE ${whereSql}
     ORDER BY p.updated_at DESC
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, limit, offset]
  );

  return {
    items: listRes.rows.map((row) =>
      mapProjectRow(row, {
        exportCount: row.export_count,
        latestExportAt: row.latest_export_at?.toISOString?.() || row.latest_export_at,
        hasTranscript: row.has_transcript,
        hasSummary: row.has_summary,
        hasSrt: row.has_srt
      })
    ),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

export async function getProjectDetailDb(email, projectId) {
  const userId = await resolveUserId(email);
  if (!userId || !projectId) return null;
  const pool = getPool();

  const proj = await pool.query(`SELECT * FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
  if (!proj.rows.length) return null;

  const outputs = await pool.query(
    `SELECT id, type, title, platform, source_url, language, is_favorite, metadata,
            created_at, updated_at,
            LEFT(content, 500000) AS content
     FROM saved_outputs
     WHERE project_id = $1
     ORDER BY type`,
    [projectId]
  );

  const exports = await pool.query(
    `SELECT * FROM project_exports
     WHERE project_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 50`,
    [projectId, userId]
  );

  await pool.query(`UPDATE projects SET last_opened_at = NOW() WHERE id = $1`, [projectId]);

  const row = proj.rows[0];
  return {
    project: mapProjectRow(row, {
      exportCount: exports.rows.filter((e) => e.status === 'completed').length,
      latestExportAt:
        exports.rows.find((e) => e.status === 'completed')?.completed_at?.toISOString?.() || null,
      hasTranscript: outputs.rows.some((o) => o.type === 'transcript'),
      hasSummary: outputs.rows.some((o) => o.type === 'summary'),
      hasSrt: outputs.rows.some((o) => o.type === 'srt')
    }),
    outputs: outputs.rows.map((o) => ({
      id: String(o.id),
      type: o.type,
      title: o.title,
      platform: o.platform,
      sourceUrl: o.source_url,
      language: o.language,
      isFavorite: Boolean(o.is_favorite),
      metadata: o.metadata || {},
      content: o.content,
      createdAt: o.created_at?.toISOString?.() || o.created_at,
      updatedAt: o.updated_at?.toISOString?.() || o.updated_at
    })),
    exports: exports.rows.map(mapExportRow)
  };
}

export async function renameProjectDb(email, projectId, title) {
  const userId = await resolveUserId(email);
  if (!userId || !projectId) return false;
  const pool = getPool();
  const trimmed = String(title ?? '').trim().slice(0, 160);
  const r = await pool.query(
    `UPDATE projects SET title = $3, updated_at = NOW() WHERE id = $2 AND user_id = $1 RETURNING id`,
    [userId, projectId, trimmed || null]
  );
  return r.rows.length > 0;
}

export async function archiveProjectDb(email, projectId, archived = true) {
  const userId = await resolveUserId(email);
  if (!userId || !projectId) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE projects
     SET lifecycle_status = $3, updated_at = NOW()
     WHERE id = $2 AND user_id = $1
     RETURNING id`,
    [userId, projectId, archived ? 'archived' : 'active']
  );
  return r.rows.length > 0;
}

export async function deleteProjectDb(email, projectId) {
  const userId = await resolveUserId(email);
  if (!userId || !projectId) return false;
  const pool = getPool();
  const r = await pool.query(`DELETE FROM projects WHERE id = $2 AND user_id = $1 RETURNING id`, [
    userId,
    projectId
  ]);
  return r.rows.length > 0;
}

export async function duplicateProjectDb(email, projectId) {
  const userId = await resolveUserId(email);
  if (!userId || !projectId) return null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query(`SELECT * FROM projects WHERE id = $1 AND user_id = $2`, [projectId, userId]);
    if (!src.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const p = src.rows[0];
    const copyTitle = `${p.title || 'Untitled project'} (copy)`.slice(0, 160);
    const ins = await client.query(
      `INSERT INTO projects
        (user_id, title, source_url, source_filename, platform, language, thumbnail_url,
         transcript_status, export_status, lifecycle_status, settings, search_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'none','active',$9::jsonb,$10)
       RETURNING id`,
      [
        userId,
        copyTitle,
        p.source_url,
        p.source_filename,
        p.platform,
        p.language,
        p.thumbnail_url,
        p.transcript_status,
        JSON.stringify(p.settings || {}),
        p.search_text
      ]
    );
    const newId = ins.rows[0].id;
    const outs = await client.query(`SELECT * FROM saved_outputs WHERE project_id = $1`, [projectId]);
    for (const o of outs.rows) {
      await client.query(
        `INSERT INTO saved_outputs
          (user_id, project_id, type, title, platform, source_url, language, content, metadata, is_favorite)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          userId,
          newId,
          o.type,
          o.title,
          o.platform,
          o.source_url,
          o.language,
          o.content,
          JSON.stringify(o.metadata || {}),
          o.is_favorite
        ]
      );
    }
    await client.query('COMMIT');
    return newId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function recordExportStartDb(email, payload = {}) {
  const userId = await resolveUserId(email);
  if (!userId || !payload.jobId) return null;
  const pool = getPool();

  let projectId = payload.projectId || null;
  const sourceUrl = normUrl(payload.sourceUrl);

  if (!projectId && sourceUrl) {
    const found = await pool.query(
      `SELECT id FROM projects
       WHERE user_id = $1 AND source_url = $2 AND lifecycle_status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
      [userId, sourceUrl]
    );
    projectId = found.rows[0]?.id || null;
  }

  if (!projectId && sourceUrl) {
    const ins = await pool.query(
      `INSERT INTO projects (user_id, title, source_url, platform, transcript_status, export_status)
       VALUES ($1, $2, $3, $4, 'ready', 'in_progress')
       RETURNING id`,
      [userId, payload.title || null, sourceUrl, payload.platform || null]
    );
    projectId = ins.rows[0].id;
  } else if (projectId) {
    await pool.query(
      `UPDATE projects SET export_status = 'in_progress', updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPORT_FILE_TTL_DAYS);

  const r = await pool.query(
    `INSERT INTO project_exports
      (project_id, user_id, render_job_id, preset_id, preset_name, quality, caption_mode,
       status, source_url, metadata, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9::jsonb,$10)
     ON CONFLICT (render_job_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [
      projectId,
      userId,
      payload.jobId,
      payload.presetId || null,
      payload.presetName || null,
      payload.quality || 'fast',
      payload.captionMode || null,
      sourceUrl,
      JSON.stringify(payload.metadata || {}),
      expiresAt.toISOString()
    ]
  );

  return { exportId: r.rows[0]?.id, projectId };
}

export async function updateExportFromJobDb(job) {
  if (!job?.id || !job?.userEmail) return;
  const pool = getPool();
  const statusMap = {
    queued: 'queued',
    rendering: 'rendering',
    muxing: 'rendering',
    rendering_video: 'rendering',
    ready_to_download: 'completed',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled'
  };
  const status = statusMap[job.stageKey] || statusMap[job.stage] || 'rendering';

  await pool.query(
    `UPDATE project_exports SET
       status = $2,
       preset_name = COALESCE($3, preset_name),
       file_size_bytes = COALESCE($4, file_size_bytes),
       video_duration_sec = COALESCE($5, video_duration_sec),
       render_duration_sec = COALESCE($6, render_duration_sec),
       resolution = COALESCE($7, resolution),
       output_filename = COALESCE($8, output_filename),
       error_message = COALESCE($9, error_message),
       completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
       updated_at = NOW()
     WHERE render_job_id = $1`,
    [
      job.id,
      status,
      job.presetDisplayName || job.presetId,
      job.fileSizeBytes,
      job.videoDurationSec,
      job.renderDurationSec,
      job.resolution,
      job.outputFilename,
      job.error || null
    ]
  );

  if (status === 'completed' && job.userEmail) {
    const userId = await resolveUserId(job.userEmail);
    if (userId) {
      await pool.query(
        `UPDATE projects p SET export_status = 'exported', updated_at = NOW()
         FROM project_exports e
         WHERE e.render_job_id = $1 AND e.project_id = p.id AND p.user_id = $2`,
        [job.id, userId]
      );
    }
  } else if (status === 'failed' && job.userEmail) {
    const userId = await resolveUserId(job.userEmail);
    if (userId) {
      await pool.query(
        `UPDATE projects p SET export_status = 'failed', updated_at = NOW()
         FROM project_exports e
         WHERE e.render_job_id = $1 AND e.project_id = p.id AND p.user_id = $2`,
        [job.id, userId]
      );
    }
  }
}

export async function getLatestExportForProjectDb(email, projectId) {
  const userId = await resolveUserId(email);
  if (!userId) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM project_exports
     WHERE user_id = $1 AND project_id = $2 AND status = 'completed'
     ORDER BY completed_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId, projectId]
  );
  return r.rows[0] ? mapExportRow(r.rows[0]) : null;
}

export async function getExportByJobIdDb(email, renderJobId) {
  const userId = await resolveUserId(email);
  if (!userId) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM project_exports WHERE user_id = $1 AND render_job_id = $2 LIMIT 1`,
    [userId, renderJobId]
  );
  return r.rows[0] ? mapExportRow(r.rows[0]) : null;
}

export async function buildProjectRestorePayloadDb(email, projectId) {
  const detail = await getProjectDetailDb(email, projectId);
  if (!detail) return null;

  const { project, outputs } = detail;
  const byType = Object.fromEntries(outputs.map((o) => [o.type, o]));
  const transcript = byType.transcript?.content || '';
  const summaryRaw = byType.summary?.content || '';
  let summary = summaryRaw;
  try {
    const parsed = JSON.parse(summaryRaw);
    if (parsed && typeof parsed === 'object' && parsed.summary) summary = parsed;
  } catch {
    /* plain text summary */
  }

  const srt = byType.srt?.content || '';

  return {
    projectId: project.id,
    title: project.title,
    platform: project.platform,
    sourceUrl: project.sourceUrl,
    sourceFilename: project.sourceFilename,
    thumbnailUrl: project.thumbnailUrl,
    language: project.language,
    settings: project.settings || {},
    summary,
    fullText: transcript,
    segments: [],
    srt,
    outputs: outputs.map((o) => ({ type: o.type, language: o.language, content: o.content }))
  };
}
