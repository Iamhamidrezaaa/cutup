/**
 * Saved Outputs V2 — content library (outputs + MP4 exports + collections).
 * Resilient to legacy DBs missing v2 columns/tables.
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

/** Case-insensitive user lookup — matches session emails to stored users. */
export async function resolveUserIdByEmail(email) {
  if (!email) return null;
  await ensureUserByEmail(email);
  const pool = getPool();
  const r = await pool.query('SELECT id, email FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return r.rows[0]?.id || null;
}

async function tableExists(pool, tableName) {
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [tableName]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function columnExists(pool, tableName, columnName) {
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
      [tableName, columnName]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function fetchSavedOutputRows(pool, userId, limit) {
  const hasCollections = await tableExists(pool, 'saved_output_collections');
  const hasCollectionId = await columnExists(pool, 'saved_outputs', 'collection_id');

  if (hasCollections && hasCollectionId) {
    return pool.query(
      `SELECT s.*, c.name AS collection_name
       FROM saved_outputs s
       LEFT JOIN saved_output_collections c ON c.id = s.collection_id
       WHERE s.user_id = $1::uuid
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
  }

  return pool.query(
    `SELECT s.*, NULL::text AS collection_name
     FROM saved_outputs s
     WHERE s.user_id = $1::uuid
     ORDER BY s.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
}

async function fetchMp4Rows(pool, userId, limit) {
  const hasExports = await tableExists(pool, 'project_exports');
  if (!hasExports) return { rows: [] };

  try {
    return await pool.query(
      `SELECT e.*, p.title AS project_title
       FROM project_exports e
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.user_id = $1::uuid AND e.status = 'completed'
       ORDER BY e.completed_at DESC NULLS LAST, e.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
  } catch (err) {
    console.warn('[saved-outputs-library] project_exports query failed:', err?.message || err);
    return { rows: [] };
  }
}

export async function listCollectionsDb(email) {
  if (!isBillingDbConfigured() || !email) return [];
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return [];
  const pool = getPool();
  if (!(await tableExists(pool, 'saved_output_collections'))) return [];

  try {
    const r = await pool.query(
      `SELECT c.id, c.name, c.created_at,
              (SELECT COUNT(*)::int FROM saved_outputs s WHERE s.collection_id = c.id) AS output_count
       FROM saved_output_collections c
       WHERE c.user_id = $1::uuid
       ORDER BY lower(c.name) ASC`,
      [userId]
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      outputCount: Number(row.output_count) || 0,
      createdAt: row.created_at?.toISOString?.() || row.created_at
    }));
  } catch (err) {
    console.warn('[saved-outputs-library] collections query failed:', err?.message || err);
    return [];
  }
}

export async function createCollectionDb(email, name) {
  if (!isBillingDbConfigured() || !email) return null;
  const trimmed = String(name || '').trim().slice(0, 120);
  if (!trimmed) return null;
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return null;
  const pool = getPool();
  if (!(await tableExists(pool, 'saved_output_collections'))) return null;
  const r = await pool.query(
    `INSERT INTO saved_output_collections (user_id, name)
     VALUES ($1::uuid, $2)
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
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return false;
  const pool = getPool();
  if (!(await columnExists(pool, 'saved_outputs', 'collection_id'))) return false;
  if (collectionId) {
    const col = await pool.query(
      'SELECT id FROM saved_output_collections WHERE id = $1::uuid AND user_id = $2::uuid',
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
    return { total: 0, dbTotal: 0, mp4: 0, transcripts: 0, translations: 0, summaries: 0 };
  }
  const userId = await resolveUserIdByEmail(email);
  if (!userId) {
    return { total: 0, dbTotal: 0, mp4: 0, transcripts: 0, translations: 0, summaries: 0 };
  }
  const pool = getPool();
  const [outputsRes, mp4Res] = await Promise.all([
    pool.query(`SELECT type, metadata FROM saved_outputs WHERE user_id = $1::uuid`, [userId]),
    tableExists(pool, 'project_exports').then((ok) =>
      ok
        ? pool.query(
            `SELECT COUNT(*)::int AS c FROM project_exports WHERE user_id = $1::uuid AND status = 'completed'`,
            [userId]
          )
        : { rows: [{ c: 0 }] }
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
  const savedCount = outputsRes.rows.length;
  return {
    total: savedCount + mp4,
    dbTotal: savedCount + mp4,
    dbSavedOutputs: savedCount,
    mp4,
    transcripts,
    translations,
    summaries
  };
}

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [item.title, item.sourceUrl, item.content, item.preview, item.displayType, item.language]
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
  const emptyAudit = {
    userId: null,
    dbSavedOutputsCount: 0,
    dbMp4Count: 0,
    rawOutputsLoaded: 0,
    rawMp4Loaded: 0,
    mergedBeforeFilters: 0,
    afterCollectionFilter: 0,
    afterSearchFilter: 0,
    afterTypeFilter: 0,
    finalReturned: 0,
    excluded: [],
    schemaV2: false,
    error: null
  };

  if (!isBillingDbConfigured() || !email) {
    return { items: [], stats: {}, collections: [], recent: [], total: 0, audit: emptyAudit };
  }

  const userId = await resolveUserIdByEmail(email);
  emptyAudit.userId = userId ? String(userId) : null;
  if (!userId) {
    console.warn('[saved-outputs-library] no user for email', email);
    return { items: [], stats: {}, collections: [], recent: [], total: 0, audit: { ...emptyAudit, error: 'user_not_found' } };
  }

  const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 1000);
  const pool = getPool();
  const audit = { ...emptyAudit, userId: String(userId) };

  try {
    const [countSaved, countMp4] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM saved_outputs WHERE user_id = $1::uuid', [userId]),
      tableExists(pool, 'project_exports').then((ok) =>
        ok
          ? pool.query(
              `SELECT COUNT(*)::int AS c FROM project_exports WHERE user_id = $1::uuid AND status = 'completed'`,
              [userId]
            )
          : { rows: [{ c: 0 }] }
      )
    ]);
    audit.dbSavedOutputsCount = Number(countSaved.rows[0]?.c) || 0;
    audit.dbMp4Count = Number(countMp4.rows[0]?.c) || 0;
    audit.schemaV2 =
      (await tableExists(pool, 'saved_output_collections')) &&
      (await columnExists(pool, 'saved_outputs', 'collection_id'));

    const [outputsRes, exportsRes, collectionsRes, stats] = await Promise.all([
      fetchSavedOutputRows(pool, userId, limit),
      fetchMp4Rows(pool, userId, limit),
      listCollectionsDb(email),
      getLibraryStatsDb(email)
    ]);

    audit.rawOutputsLoaded = outputsRes.rows.length;
    audit.rawMp4Loaded = exportsRes.rows.length;

    const outputItems = outputsRes.rows.map((row) => mapSavedRow(row, row.collection_name || null));
    const mp4Items = exportsRes.rows.map((row) => mapMp4Row(row, row.project_title || null));
    let items = [...outputItems, ...mp4Items];
    audit.mergedBeforeFilters = items.length;

    const recent = sortItems([...outputItems, ...mp4Items], 'newest').slice(0, 8);

    const search = String(options.search || '').trim();
    const filter = options.filter || 'all';
    const collectionId = options.collectionId || null;

    if (collectionId) {
      const before = items.length;
      items = items.filter((it) => it.collectionId === String(collectionId));
      audit.afterCollectionFilter = items.length;
      if (items.length < before) {
        audit.excluded.push({ step: 'collection', count: before - items.length });
      }
    } else {
      audit.afterCollectionFilter = items.length;
    }

    if (search) {
      const before = items.length;
      items = items.filter((it) => matchesSearch(it, search));
      audit.afterSearchFilter = items.length;
      if (items.length < before) {
        audit.excluded.push({ step: 'search', count: before - items.length, query: search });
      }
    } else {
      audit.afterSearchFilter = items.length;
    }

    const beforeType = items.length;
    items = items.filter((it) => matchesFilter(it, filter));
    audit.afterTypeFilter = items.length;
    if (items.length < beforeType) {
      audit.excluded.push({ step: 'filter', count: beforeType - items.length, filter });
    }

    items = sortItems(items, options.sort);
    audit.finalReturned = items.length;

    console.log('[saved-outputs-library]', JSON.stringify(audit));

    return {
      items,
      recent,
      stats: { ...stats, dbTotal: stats.dbTotal ?? stats.total },
      collections: collectionsRes,
      total: items.length,
      audit
    };
  } catch (err) {
    audit.error = err?.message || String(err);
    console.error('[saved-outputs-library] failed', audit.error, err?.stack || '');
    return {
      items: [],
      recent: [],
      stats: await getLibraryStatsDb(email).catch(() => ({})),
      collections: [],
      total: 0,
      audit
    };
  }
}

export async function deleteSavedOutputDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserIdByEmail(email);
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
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return false;
  const pool = getPool();
  const r = await pool.query(
    `DELETE FROM project_exports WHERE id = $2::uuid AND user_id = $1::uuid RETURNING id`,
    [userId, exportId]
  );
  return r.rows.length > 0;
}

export async function duplicateSavedOutputDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return null;
  const pool = getPool();
  const hasCollectionId = await columnExists(pool, 'saved_outputs', 'collection_id');
  const src = await pool.query(
    `SELECT * FROM saved_outputs WHERE id = $1::bigint AND user_id = $2::uuid`,
    [outputId, userId]
  );
  if (!src.rows.length) return null;
  const row = src.rows[0];
  const copyTitle = row.title ? `${row.title} (Copy)` : 'Untitled (Copy)';

  if (hasCollectionId) {
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

  const ins = await pool.query(
    `INSERT INTO saved_outputs
      (user_id, project_id, type, title, platform, source_url, language, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
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
      JSON.stringify(row.metadata || {})
    ]
  );
  return ins.rows[0] ? String(ins.rows[0].id) : null;
}

export async function incrementOutputDownloadDb(email, outputId) {
  if (!isBillingDbConfigured() || !email || !outputId) return false;
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return false;
  const pool = getPool();
  const hasDl = await columnExists(pool, 'saved_outputs', 'download_count');
  if (!hasDl) return true;
  const r = await pool.query(
    `UPDATE saved_outputs SET download_count = COALESCE(download_count, 0) + 1, updated_at = NOW()
     WHERE id = $2::bigint AND user_id = $1::uuid RETURNING download_count`,
    [userId, outputId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].download_count) : false;
}

export async function incrementMp4DownloadDb(email, exportId) {
  if (!isBillingDbConfigured() || !email || !exportId) return false;
  const userId = await resolveUserIdByEmail(email);
  if (!userId) return false;
  const pool = getPool();
  const hasDl = await columnExists(pool, 'project_exports', 'download_count');
  if (!hasDl) return true;
  const r = await pool.query(
    `UPDATE project_exports SET download_count = COALESCE(download_count, 0) + 1, updated_at = NOW()
     WHERE id = $2::uuid AND user_id = $1::uuid RETURNING download_count`,
    [userId, exportId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].download_count) : false;
}
