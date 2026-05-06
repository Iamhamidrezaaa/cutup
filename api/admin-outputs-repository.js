/**
 * Admin Saved Outputs workspace — filters, KPIs, analytics, pagination, bulk ops.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { resolvePlanKey } from './plans-config.js';

const CACHE_TTL_MS = 45_000;
const OPENAI_EUR_PER_MINUTE = 0.0055;
const CHARS_PER_EST_MINUTE = 900;
const HIGH_LENGTH_CHARS = 20000;
const AI_HEAVY_CHARS = 10000;
const outputsCache = new Map();

const OUTPUTS_FROM = `
  FROM saved_outputs s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN subscriptions sub ON sub.user_id = u.id
  LEFT JOIN user_profiles up ON up.user_id = u.id
`;

const TYPE_NORM_SQL = `CASE
  WHEN LOWER(s.type) IN ('transcript', 'transcription', 'text') THEN 'transcript'
  WHEN LOWER(s.type) IN ('summary', 'summarization') THEN 'summary'
  WHEN LOWER(s.type) = 'srt' THEN 'srt'
  ELSE LOWER(COALESCE(s.type, 'unknown'))
END`;

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function resolveOutputsDateRange({ preset = 'all', startDate = '', endDate = '' } = {}) {
  const to = new Date();
  const p = String(preset || 'all').toLowerCase();
  if (p === 'all') return { from: null, to, preset: 'all' };
  let from = null;
  if (p === 'today') from = startOfUtcDay(to);
  else if (p === '7d') from = new Date(to.getTime() - 7 * 86400000);
  else if (p === '30d') from = new Date(to.getTime() - 30 * 86400000);
  else if (p === 'custom' && startDate) {
    from = new Date(startDate);
    return { from, to: endDate ? new Date(endDate) : to, preset: 'custom' };
  } else from = new Date(to.getTime() - 7 * 86400000);
  return { from, to, preset: p };
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function isArchivedSql(alias = 's') {
  return `LOWER(COALESCE(${alias}.metadata->>'archived', '')) IN ('true', '1', 'yes')`;
}

function buildOutputsWhere(opts, params) {
  const where = [];
  const { from, to } = opts.range || {};
  if (from) {
    params.push(from.toISOString());
    where.push(`s.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`s.created_at <= $${params.length}::timestamptz`);
  }
  if (!opts.showArchived) {
    where.push(`NOT (${isArchivedSql('s')})`);
  }
  if (opts.type && opts.type !== 'all') {
    params.push(String(opts.type).toLowerCase());
    where.push(`${TYPE_NORM_SQL} = $${params.length}`);
  }
  if (opts.platform && opts.platform !== 'all') {
    params.push(String(opts.platform).toLowerCase());
    where.push(`LOWER(COALESCE(s.platform, 'unknown')) = $${params.length}`);
  }
  if (opts.language && opts.language !== 'all') {
    params.push(String(opts.language).toLowerCase());
    where.push(`LOWER(COALESCE(s.language, 'unknown')) = $${params.length}`);
  }
  if (opts.plan && opts.plan !== 'all') {
    params.push(String(opts.plan).toLowerCase());
    where.push(`LOWER(COALESCE(sub.plan, 'free')) = $${params.length}`);
  }
  if (opts.favoritesOnly) {
    where.push('s.is_favorite = TRUE');
  }
  if (opts.highLength) {
    where.push(`LENGTH(COALESCE(s.content, '')) >= ${HIGH_LENGTH_CHARS}`);
  }
  if (opts.aiHeavy) {
    where.push(
      `(LENGTH(COALESCE(s.content, '')) >= ${AI_HEAVY_CHARS} OR (${TYPE_NORM_SQL} IN ('transcript', 'summary') AND LENGTH(COALESCE(s.content, '')) >= 5000))`
    );
  }
  if (opts.search) {
    params.push(`%${String(opts.search).toLowerCase()}%`);
    const i = params.length;
    where.push(
      `(LOWER(COALESCE(s.title, '')) LIKE $${i} OR LOWER(u.email) LIKE $${i} OR LOWER(COALESCE(s.source_url, '')) LIKE $${i})`
    );
  }
  return where.join(' AND ');
}

function outputsWhere(opts, params) {
  const w = buildOutputsWhere(opts, params);
  return w ? `WHERE ${w}` : '';
}

function estCostFromChars(chars) {
  const mins = Math.max(0, Number(chars) || 0) / CHARS_PER_EST_MINUTE;
  return Math.round(mins * OPENAI_EUR_PER_MINUTE * 100) / 100;
}

function mapListRow(row) {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const chars = Number(row.content_length || 0);
  const typeNorm = row.type_norm || row.type;
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    email: row.email,
    plan: resolvePlanKey(row.plan || 'free'),
    type: typeNorm,
    rawType: row.type,
    title: row.title || 'Untitled',
    platform: row.platform || 'unknown',
    sourceUrl: row.source_url || '',
    language: row.language || '—',
    isFavorite: Boolean(row.is_favorite),
    isArchived: Boolean(row.is_archived),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    contentLength: chars,
    wordEstimate: Math.round(chars / 5),
    previewSnippet: row.preview_snippet || '',
    costEstimateEur: estCostFromChars(chars),
    metadata: meta
  };
}

function mapDetailRow(row) {
  const base = mapListRow(row);
  return {
    ...base,
    content: row.content || '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  };
}

async function queryOutputsList(pool, opts) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(opts.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const params = [];
  const whereSql = outputsWhere(opts, params);
  const sortCol =
    opts.sort === 'title'
      ? 's.title'
      : opts.sort === 'type'
        ? TYPE_NORM_SQL
        : opts.sort === 'email'
          ? 'u.email'
          : opts.sort === 'length'
            ? 'LENGTH(COALESCE(s.content, \'\'))'
            : 's.created_at';
  const sortDir = String(opts.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c ${OUTPUTS_FROM} ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.c || 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(pageSize, offset);

  const r = await pool.query(
    `SELECT s.id, s.user_id, s.type, s.title, s.platform, s.source_url, s.language,
            s.is_favorite, s.metadata, s.created_at, s.updated_at, u.email,
            COALESCE(sub.plan, 'free') AS plan,
            (${isArchivedSql('s')}) AS is_archived,
            ${TYPE_NORM_SQL} AS type_norm,
            LENGTH(COALESCE(s.content, ''))::int AS content_length,
            LEFT(COALESCE(s.content, ''), 320) AS preview_snippet
     ${OUTPUTS_FROM}
     ${whereSql}
     ORDER BY s.is_favorite DESC, ${sortCol} ${sortDir}, s.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return {
    outputs: r.rows.map(mapListRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

async function queryKpis(pool, range, prevRange, opts) {
  const run = async (from, to) => {
    const params = [];
    const whereSql = outputsWhere({ ...opts, range: { from, to } }, params);
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.created_at >= NOW() - INTERVAL '7 days')::int AS week_count,
         COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'transcript')::int AS transcripts,
         COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'summary')::int AS summaries,
         COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'srt')::int AS srts,
         COUNT(*) FILTER (WHERE s.is_favorite = TRUE)::int AS favorites,
         COALESCE(AVG(LENGTH(COALESCE(s.content, ''))), 0)::float AS avg_length,
         COALESCE(SUM(LENGTH(COALESCE(s.content, ''))), 0)::bigint AS total_chars
       ${OUTPUTS_FROM}
       ${whereSql}`,
      params
    );
    return r.rows[0] || {};
  };

  const cur = await run(range.from, range.to);
  const prev = await run(prevRange.from, prevRange.to);
  const total = Number(cur.total || 0);
  const prevTotal = Number(prev.total || 0);

  const platParams = [];
  const platWhere = outputsWhere({ ...opts, range }, platParams);
  const platRes = await pool.query(
    `SELECT LOWER(COALESCE(s.platform, 'unknown')) AS name, COUNT(*)::int AS count
     ${OUTPUTS_FROM}
     ${platWhere}
     GROUP BY 1 ORDER BY count DESC LIMIT 1`,
    platParams
  );

  const langParams = [];
  const langWhere = outputsWhere({ ...opts, range }, langParams);
  const langRes = await pool.query(
    `SELECT LOWER(COALESCE(s.language, 'unknown')) AS name, COUNT(*)::int AS count
     ${OUTPUTS_FROM}
     ${langWhere}
     GROUP BY 1 ORDER BY count DESC LIMIT 1`,
    langParams
  );

  const transcripts = Number(cur.transcripts || 0);
  const summaries = Number(cur.summaries || 0);
  const srts = Number(cur.srts || 0);
  const typed = transcripts + summaries + srts || total || 1;

  return {
    totalSaved: total,
    outputsThisWeek: Number(cur.week_count || 0),
    transcriptPct: Math.round((transcripts / typed) * 1000) / 10,
    summaryPct: Math.round((summaries / typed) * 1000) / 10,
    srtPct: Math.round((srts / typed) * 1000) / 10,
    mostActivePlatform: platRes.rows[0]?.name || '—',
    mostActiveLanguage: langRes.rows[0]?.name || '—',
    favoriteRate: total > 0 ? Math.round((Number(cur.favorites || 0) / total) * 1000) / 10 : 0,
    avgOutputLength: Math.round(Number(cur.avg_length || 0)),
    estimatedAiCostEur: estCostFromChars(Number(cur.total_chars || 0)),
    trends: {
      totalSaved: pctChange(total, prevTotal),
      outputsThisWeek: pctChange(Number(cur.week_count || 0), Number(prev.week_count || 0))
    }
  };
}

async function queryTimeline(pool, range, opts) {
  const params = [];
  const whereSql = outputsWhere({ ...opts, range }, params);
  const r = await pool.query(
    `SELECT date_trunc('day', s.created_at AT TIME ZONE 'UTC')::date AS day,
            COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'transcript')::int AS transcript,
            COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'summary')::int AS summary,
            COUNT(*) FILTER (WHERE ${TYPE_NORM_SQL} = 'srt')::int AS srt,
            COUNT(*)::int AS total
     ${OUTPUTS_FROM}
     ${whereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({
    day: row.day?.toISOString?.()?.slice(0, 10) || String(row.day),
    transcript: Number(row.transcript || 0),
    summary: Number(row.summary || 0),
    srt: Number(row.srt || 0),
    total: Number(row.total || 0)
  }));
}

async function queryBreakdowns(pool, range, opts) {
  const params = [];
  const whereSql = outputsWhere({ ...opts, range }, params);

  const [platform, language, type, topUsers, topSources, favorites] = await Promise.all([
    pool.query(
      `SELECT LOWER(COALESCE(s.platform, 'unknown')) AS name, COUNT(*)::int AS count
       ${OUTPUTS_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      params
    ),
    pool.query(
      `SELECT LOWER(COALESCE(s.language, 'unknown')) AS name, COUNT(*)::int AS count
       ${OUTPUTS_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      params
    ),
    pool.query(
      `SELECT ${TYPE_NORM_SQL} AS name, COUNT(*)::int AS count
       ${OUTPUTS_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC`,
      params
    ),
    pool.query(
      `SELECT u.email, COUNT(*)::int AS count
       ${OUTPUTS_FROM} ${whereSql}
       GROUP BY u.email ORDER BY count DESC LIMIT 8`,
      params
    ),
    pool.query(
      `SELECT
         COALESCE(NULLIF(regexp_replace(LOWER(s.source_url), '^https?://([^/]+).*', '\\1'), ''), 'direct') AS name,
         COUNT(*)::int AS count
       ${OUTPUTS_FROM} ${whereSql}
       GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      params
    ),
    pool.query(
      `SELECT date_trunc('day', s.created_at AT TIME ZONE 'UTC')::date AS day,
              COUNT(*) FILTER (WHERE s.is_favorite = TRUE)::int AS favorites
       ${OUTPUTS_FROM} ${whereSql}
       GROUP BY 1 ORDER BY 1 ASC`,
      [...params]
    )
  ]);

  return {
    byPlatform: platform.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    byLanguage: language.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    byType: Object.fromEntries(type.rows.map((r) => [r.name, Number(r.count || 0)])),
    topUsers: topUsers.rows.map((r) => ({ email: r.email, count: Number(r.count || 0) })),
    topSources: topSources.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    favoriteTrend: favorites.rows.map((r) => ({
      day: r.day?.toISOString?.()?.slice(0, 10) || String(r.day),
      favorites: Number(r.favorites || 0)
    }))
  };
}

function buildInsights({ kpis, breakdowns, timeline, prevTimeline }) {
  const insights = [];
  const plat = breakdowns?.byPlatform || [];
  const langs = breakdowns?.byLanguage || [];
  const types = breakdowns?.byType || {};

  const ig = plat.find((p) => p.name === 'instagram');
  const yt = plat.find((p) => p.name === 'youtube');
  if (ig && yt && ig.count > yt.count) {
    insights.push({ tone: 'ok', text: `Instagram outputs (${ig.count}) lead YouTube (${yt.count}) in this period.` });
  } else if (yt && ig && yt.count > ig.count * 1.5) {
    insights.push({ tone: 'neutral', text: `YouTube remains the dominant save source (${yt.count} outputs).` });
  }

  const fa = langs.find((l) => l.name === 'fa' || l.name === 'persian' || l.name === 'farsi');
  if (fa && fa.count >= 5) {
    insights.push({ tone: 'ok', text: `Persian/Farsi content accounts for ${fa.count} saved outputs in view.` });
  }

  const topUser = (breakdowns?.topUsers || [])[0];
  const secondUser = (breakdowns?.topUsers || [])[1];
  if (topUser && secondUser && topUser.count > secondUser.count * 3) {
    insights.push({
      tone: 'warn',
      text: `${topUser.email} saved ${topUser.count} outputs — unusually high activity vs peers.`
    });
  }

  const longAvg = Number(kpis?.avgOutputLength || 0);
  if (longAvg > 15000) {
    insights.push({ tone: 'warn', text: 'Average output length is very high — review long-running transcript jobs.' });
  }

  if (timeline?.length >= 7 && prevTimeline?.length >= 7) {
    const curSum = timeline.slice(-7).reduce((s, d) => s + d.total, 0);
    const prevSum = prevTimeline.slice(-7).reduce((s, d) => s + d.total, 0);
    const ch = pctChange(curSum, prevSum);
    if (ch != null && ch > 20) {
      insights.push({ tone: 'ok', text: `Saved outputs increased ${ch}% over the last 7 days vs the prior week.` });
    } else if (ch != null && ch < -15) {
      insights.push({ tone: 'neutral', text: `Saved outputs declined ${Math.abs(ch)}% week over week.` });
    }
  }

  const summaryCount = Number(types.summary || 0);
  const transcriptCount = Number(types.transcript || 0);
  if (summaryCount > 0 && transcriptCount > 0 && summaryCount / transcriptCount > 0.4) {
    insights.push({ tone: 'ok', text: 'Summary saves are a growing share of AI content stored.' });
  }

  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      text: 'Output patterns are stable for the selected filters. Adjust date range or type to explore trends.'
    });
  }
  return insights.slice(0, 6);
}

function trendRangeFor(range) {
  const to = range.to || new Date();
  const from = range.from || new Date(to.getTime() - 30 * 86400000);
  const span = Math.max(86400000, to.getTime() - from.getTime());
  return {
    from,
    to,
    prevFrom: new Date(from.getTime() - span),
    prevTo: new Date(from.getTime() - 1)
  };
}

export async function getAdminSavedOutputDetailDb(id) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.*, u.email, COALESCE(sub.plan, 'free') AS plan,
            (${isArchivedSql('s')}) AS is_archived,
            ${TYPE_NORM_SQL} AS type_norm,
            LENGTH(COALESCE(s.content, ''))::int AS content_length
     ${OUTPUTS_FROM}
     WHERE s.id = $1::bigint
     LIMIT 1`,
    [id]
  );
  if (!r.rows.length) return null;
  return mapDetailRow(r.rows[0]);
}

export async function bulkAdminSavedOutputsDb({ operation, ids = [] } = {}) {
  if (!isBillingDbConfigured()) return { ok: false, error: 'Database not configured' };
  const pool = getPool();
  const idList = (ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
  if (!idList.length) return { ok: false, error: 'No valid ids' };

  const op = String(operation || '').toLowerCase();
  if (op === 'delete') {
    const r = await pool.query(`DELETE FROM saved_outputs WHERE id = ANY($1::bigint[])`, [idList]);
    return { ok: true, affected: r.rowCount || 0 };
  }
  if (op === 'favorite') {
    const r = await pool.query(
      `UPDATE saved_outputs SET is_favorite = TRUE, updated_at = NOW() WHERE id = ANY($1::bigint[])`,
      [idList]
    );
    return { ok: true, affected: r.rowCount || 0 };
  }
  if (op === 'unfavorite') {
    const r = await pool.query(
      `UPDATE saved_outputs SET is_favorite = FALSE, updated_at = NOW() WHERE id = ANY($1::bigint[])`,
      [idList]
    );
    return { ok: true, affected: r.rowCount || 0 };
  }
  if (op === 'archive') {
    const r = await pool.query(
      `UPDATE saved_outputs
       SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"archived":true}'::jsonb,
           updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [idList]
    );
    return { ok: true, affected: r.rowCount || 0 };
  }
  if (op === 'unarchive') {
    const r = await pool.query(
      `UPDATE saved_outputs
       SET metadata = COALESCE(metadata, '{}'::jsonb) - 'archived',
           updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [idList]
    );
    return { ok: true, affected: r.rowCount || 0 };
  }
  return { ok: false, error: 'Unknown operation' };
}

export async function getAdminOutputsDashboardDb(filters = {}) {
  const widgetErrors = [];
  const emptyList = { outputs: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };

  if (!isBillingDbConfigured()) {
    return { ...emptyList, analytics: null, insights: [], debug: { dbConfigured: false } };
  }

  const cacheKey = JSON.stringify(filters);
  const hit = outputsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const range = resolveOutputsDateRange(filters);
  const tr = trendRangeFor(range);
  const prevRange = { from: tr.prevFrom, to: tr.prevTo };

  const opts = {
    range,
    type: filters.type || 'all',
    platform: filters.platform || 'all',
    language: filters.language || 'all',
    plan: filters.plan || 'all',
    search: filters.search || '',
    favoritesOnly: String(filters.favoritesOnly || '') === '1' || filters.favoritesOnly === true,
    highLength: String(filters.highLength || '') === '1' || filters.highLength === true,
    aiHeavy: String(filters.aiHeavy || '') === '1' || filters.aiHeavy === true,
    showArchived: String(filters.showArchived || '') === '1' || filters.showArchived === true,
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
    sortDir: filters.sortDir
  };

  const pool = getPool();
  let list = emptyList;
  try {
    list = await queryOutputsList(pool, opts);
  } catch (e) {
    console.error('[admin outputs] list failed', e);
    widgetErrors.push({ widget: 'list', message: e?.message || String(e) });
  }

  let kpis = null;
  let timeline = [];
  let prevTimeline = [];
  let breakdowns = null;
  try {
    kpis = await queryKpis(pool, range, prevRange, opts);
  } catch (e) {
    console.error('[admin outputs] kpis failed', e);
    widgetErrors.push({ widget: 'kpis', message: e?.message || String(e) });
  }
  try {
    timeline = await queryTimeline(pool, range, opts);
    prevTimeline = await queryTimeline(pool, prevRange, opts);
  } catch (e) {
    console.error('[admin outputs] timeline failed', e);
    widgetErrors.push({ widget: 'timeline', message: e?.message || String(e) });
  }
  try {
    breakdowns = await queryBreakdowns(pool, range, opts);
  } catch (e) {
    console.error('[admin outputs] breakdowns failed', e);
    widgetErrors.push({ widget: 'breakdowns', message: e?.message || String(e) });
  }

  const analytics =
    kpis || timeline.length || breakdowns
      ? { kpis, timeline, breakdowns, _widgetErrors: widgetErrors }
      : null;

  const insights = analytics ? buildInsights({ kpis, breakdowns, timeline, prevTimeline }) : [];

  const debug = {
    preset: range.preset,
    totalFiltered: list.total,
    rowsPage: list.outputs.length,
    widgetsFailed: widgetErrors
  };

  const data = { ...list, analytics, insights, debug };
  outputsCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
