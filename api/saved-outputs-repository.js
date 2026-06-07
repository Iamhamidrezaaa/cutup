/**
 * Saved Outputs V2 — content library (outputs + MP4 exports + collections).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureUserByEmail } from './billing-repository.js';

const PREVIEW_MAX = 1200;

function truncateText(text, max = PREVIEW_MAX) {
  const s = text != null ? String(text) : '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function isTranslationMeta(meta = {}) {
  return (
    meta.translationOnly === true ||
    meta.translationOnly === 1 ||
    String(meta.translationOnly || '').toLowerCase() === 'true' ||
    meta.operation === 'translation' ||
    meta.outputType === 'translation'
  );
}

function resolveOutputKind(type, meta = {}) {
  const t = String(type || '').toLowerCase();
  if (t === 'transcript' || t === 'transcription') return 'transcript';
  if (t === 'summary' || t === 'summarization') return 'summary';
  if (t === 'srt') return isTranslationMeta(meta) ? 'translation' : 'subtitle';
  return t || 'transcript';
}

function displayTypeLabel(kind) {
  const map = {
    transcript: 'Transcript',
    translation: 'Translation',
    subtitle: 'Subtitle',
    summary: 'Summary',
    mp4: 'MP4',
    txt: 'TXT',
    docx: 'DOCX'
  };
  return map[kind] || 'Output';
}

function mapSavedRow(row, collectionName = null) {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const kind = resolveOutputKind(row.type, meta);
  const styleUsed =
    meta.styleName ||
    meta.presetName ||
    meta.captionStyle ||
    meta.style ||
    meta.subtitleStyle ||
    null;
  return {
    id: String(row.id),
    kind: 'output',
    type: kind,
    rawType: row.type,
    displayType: displayTypeLabel(kind),
    title: row.title || null,
    language: row.language || null,
    platform: row.platform || null,
    sourceUrl: row.source_url || null,
    content: row.content || '',
    preview: truncateText(row.content),
    isFavorite: Boolean(row.is_favorite),
    status: 'ready',
    styleUsed,
    downloadCount: Number(row.download_count) || 0,
    collectionId: row.collection_id ? String(row.collection_id) : null,
    collectionName,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    metadata: meta,
    projectId: row.project_id ? String(row.project_id) : null,
    exportHistory: Array.isArray(meta.exportHistory) ? meta.exportHistory : [],
    mp4: null
  };
}

function mapMp4Row(row, projectTitle = null) {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const expired = row.expires_at && new Date(row.expires_at) < new Date();
  let status = row.status || 'queued';
  if (status === 'completed' && expired) status = 'expired';
  return {
    id: `mp4:${row.id}`,
    kind: 'mp4',
    type: 'mp4',
    rawType: 'mp4',
    displayType: 'MP4',
    title: projectTitle || row.output_filename || row.preset_name || 'MP4 Export',
    language: meta.language || null,
    platform: meta.platform || null,
    sourceUrl: row.source_url || null,
    content: '',
    preview: null,
    isFavorite: Boolean(meta.isFavorite),
    status,
    styleUsed: row.preset_name || row.preset_id || meta.styleName || null,
    downloadCount: Number(row.download_count) || 0,
    collectionId: meta.collectionId ? String(meta.collectionId) : null,
    collectionName: meta.collectionName || null,
    createdAt: row.completed_at?.toISOString?.() || row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    metadata: meta,
    projectId: row.project_id ? String(row.project_id) : null,
    exportHistory: [
      {
        date: row.completed_at || row.created_at,
        preset: row.preset_name,
        quality: row.quality,
        resolution: row.resolution,
        status: row.status
      }
    ],
    mp4: {
      exportId: String(row.id),
      renderJobId: row.render_job_id,
      presetName: row.preset_name,
      quality: row.quality,
      resolution: row.resolution,
      fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
      videoDurationSec: row.video_duration_sec != null ? Number(row.video_duration_sec) : null,
      expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null,
      downloadReady: status === 'completed' && !expired
    }
  };
}

async function resolveUserId(email) {
  await ensureUserByEmail(email);
  const pool = getPool();
  const r = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  return r.rows[0]?.id || null;
}

export async function listCollectionsDb(email) {
  if (!isBillingDbConfigured() || !email) return [];
  const userId = await resolveUserId(email);
  if (!userId) return [];
  const pool = getPool();
  const r = await pool.query(
    `SELECT c.id, c.name, c.created_at,
            (SELECT COUNT(*)::int FROM saved_outputs s WHERE s.collection_id = c.id) AS output_count
     FROM saved_output_collections c
     WHERE c.user_id = $1
     ORDER BY lower(c.name) ASC`,
    [userId]
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    outputCount: Number(row.output_count) || 0,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  }));
}

export async function createCollectionDb(email, name) {
  if (!isBillingDbConfigured() || !email) return null;
  const trimmed = String(name || '').trim().slice(0, 120);
  if (!trimmed) return null;
  const userId = await resolveUserId(email);
  if (!userId) return null;
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO saved_output_collections (user_id, name)
     VALUES ($1, $2)
     RETURNING id, name, created_at`,
    [userId, trimmed]
  );
  const row = r.rows[0];
  return row
    ? { id: String(row.id), name: row.name, outputCount: 0, createdAt: row.created_at?.toISOString?.() || row.created_at }
    : null;
}

export async function assignOutputCollectionDb(email, outputId, collectionId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserId(email);
  if (!userId) return false;
  const pool = getPool();
  if (collectionId) {
    const col = await pool.query(
      'SELECT id FROM saved_output_collections WHERE id = $1::uuid AND user_id = $2',
      [collectionId, userId]
    );
    if (!col.rows.length) return false;
  }
  const r = await pool.query(
    `UPDATE saved_outputs SET collection_id = $3::uuid, updated_at = NOW()
     WHERE id = $2::bigint AND user_id = $1::uuid
     RETURNING id`,
    [userId, outputId, collectionId || null]
  );
  return r.rows.length > 0;
}

export async function getLibraryStatsDb(email) {
  if (!isBillingDbConfigured() || !email) {
    return { total: 0, mp4: 0, transcripts: 0, translations: 0, summaries: 0 };
  }
  const userId = await resolveUserId(email);
  if (!userId) {
    return { total: 0, mp4: 0, transcripts: 0, translations: 0, summaries: 0 };
  }
  const pool = getPool();
  const [outputsRes, mp4Res] = await Promise.all([
    pool.query(
      `SELECT type, metadata FROM saved_outputs WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM project_exports WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    )
  ]);
  let transcripts = 0;
  let translations = 0;
  let summaries = 0;
  for (const row of outputsRes.rows) {
    const kind = resolveOutputKind(row.type, row.metadata || {});
    if (kind === 'transcript') transcripts += 1;
    else if (kind === 'translation' || kind === 'subtitle') translations += 1;
    else if (kind === 'summary') summaries += 1;
  }
  const mp4 = Number(mp4Res.rows[0]?.c) || 0;
  return {
    total: outputsRes.rows.length + mp4,
    mp4,
    transcripts,
    translations,
    summaries
  };
}

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [
    item.title,
    item.sourceUrl,
    item.content,
    item.preview,
    item.displayType,
    item.language
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(needle);
}

function matchesFilter(item, filter) {
  const f = String(filter || 'all').toLowerCase();
  if (f === 'all') return true;
  if (f === 'favorites') return item.isFavorite;
  if (f === 'mp4') return item.type === 'mp4';
  if (f === 'transcript') return item.type === 'transcript';
  if (f === 'translation') return item.type === 'translation' || item.type === 'subtitle';
  if (f === 'summary') return item.type === 'summary';
  if (f === 'txt') return ['transcript', 'translation', 'subtitle', 'summary'].includes(item.type);
  if (f === 'docx') return ['transcript', 'translation', 'subtitle', 'summary'].includes(item.type);
  return true;
}

function sortItems(items, sort) {
  const s = String(sort || 'newest').toLowerCase();
  const list = [...items];
  if (s === 'oldest') {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (s === 'downloads') {
    list.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
  } else if (s === 'alpha') {
    list.sort((a, b) =>
      String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })
    );
  } else {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
  return list;
}

export async function listSavedOutputsLibraryDb(email, options = {}) {
  if (!isBillingDbConfigured() || !email) return { items: [], stats: {}, collections: [] };
  const userId = await resolveUserId(email);
  if (!userId) return { items: [], stats: {}, collections: [] };

  const limit = Math.min(Math.max(Number(options.limit) || 200, 1), 500);
  const pool = getPool();

  const [outputsRes, exportsRes, collectionsRes, stats] = await Promise.all([
    pool.query(
      `SELECT s.*, c.name AS collection_name
       FROM saved_outputs s
       LEFT JOIN saved_output_collections c ON c.id = s.collection_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [userId, limit]
    ),
    pool.query(
      `SELECT e.*, p.title AS project_title
       FROM project_exports e
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.user_id = $1 AND e.status = 'completed'
       ORDER BY e.completed_at DESC NULLS LAST, e.created_at DESC
       LIMIT $2`,
      [userId, limit]
    ),
    listCollectionsDb(email),
    getLibraryStatsDb(email)
  ]);

  const outputItems = outputsRes.rows.map((row) => mapSavedRow(row, row.collection_name || null));
  const mp4Items = exportsRes.rows.map((row) => mapMp4Row(row, row.project_title || null));
  let items = [...outputItems, ...mp4Items];

  const search = String(options.search || '').trim();
  const filter = options.filter || 'all';
  const collectionId = options.collectionId || null;

  if (collectionId) {
    items = items.filter((it) => it.collectionId === String(collectionId));
  }
  if (search) {
    items = items.filter((it) => matchesSearch(it, search));
  }
  items = items.filter((it) => matchesFilter(it, filter));
  items = sortItems(items, options.sort);

  return {
    items,
    stats,
    collections: collectionsRes,
    total: items.length
  };
}

export async function deleteSavedOutputDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserId(email);
  if (!userId) return false;
  const pool = getPool();
  const r = await pool.query(
    `DELETE FROM saved_outputs WHERE id = $2::bigint AND user_id = $1::uuid RETURNING id`,
    [userId, outputId]
  );
  return r.rows.length > 0;
}

export async function deleteMp4ExportDb(email, exportId) {
  if (!isBillingDbConfigured() || !email || !exportId) return false;
  const userId = await resolveUserId(email);
  if (!userId) return false;
  const pool = getPool();
  const r = await pool.query(
    `DELETE FROM project_exports WHERE id = $2::uuid AND user_id = $1::uuid RETURNING id`,
    [userId, exportId]
  );
  return r.rows.length > 0;
}

export async function duplicateSavedOutputDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return null;
  const userId = await resolveUserId(email);
  if (!userId) return null;
  const pool = getPool();
  const src = await pool.query(
    `SELECT * FROM saved_outputs WHERE id = $1::bigint AND user_id = $2`,
    [outputId, userId]
  );
  if (!src.rows.length) return null;
  const row = src.rows[0];
  const copyTitle = row.title ? `${row.title} (Copy)` : 'Untitled (Copy)';
  const ins = await pool.query(
    `INSERT INTO saved_outputs
      (user_id, project_id, type, title, platform, source_url, language, content, metadata, collection_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING id`,
    [
      userId,
      row.project_id,
      row.type,
      copyTitle.slice(0, 160),
      row.platform,
      row.source_url,
      row.language,
      row.content,
      JSON.stringify(row.metadata || {}),
      row.collection_id
    ]
  );
  return ins.rows[0] ? String(ins.rows[0].id) : null;
}

export async function incrementOutputDownloadDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserId(email);
  if (!userId) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE saved_outputs SET download_count = download_count + 1, updated_at = NOW()
     WHERE id = $2::bigint AND user_id = $1::uuid RETURNING download_count`,
    [userId, outputId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].download_count) : false;
}

export async function incrementMp4DownloadDb(email, exportId) {
  if (!isBillingDbConfigured() || !email || !exportId) return false;
  const userId = await resolveUserId(email);
  if (!userId) return false;
  const pool = getPool();
  const r = await pool.query(
    `UPDATE project_exports SET download_count = download_count + 1, updated_at = NOW()
     WHERE id = $2::uuid AND user_id = $1::uuid RETURNING download_count`,
    [userId, exportId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].download_count) : false;
}
