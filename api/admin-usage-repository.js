/**
 * Admin Usage analytics workspace — PostgreSQL aggregations + paginated activity list.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { resolvePlanKey } from './plans-config.js';

const CACHE_TTL_MS = 45_000;
const OPENAI_EUR_PER_MINUTE = 0.0055;
const usageCache = new Map();

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

export function resolveUsageDateRange({ preset = 'all', startDate = '', endDate = '' } = {}) {
  const to = new Date();
  const p = String(preset || 'all').toLowerCase();
  let from = null;
  if (p === 'all') {
    return { from: null, to, preset: 'all' };
  }
  if (p === 'today') {
    from = startOfUtcDay(to);
  } else if (p === 'yesterday') {
    const y = startOfUtcDay(to);
    from = new Date(y.getTime() - 86400000);
    return { from, to: new Date(y.getTime() - 1), preset: p };
  } else if (p === '30d') {
    from = new Date(to.getTime() - 30 * 86400000);
  } else if (p === '7d') {
    from = new Date(to.getTime() - 7 * 86400000);
  } else if (p === 'custom' && startDate) {
    from = new Date(startDate);
    const end = endDate ? new Date(endDate) : to;
    return { from, to: end, preset: 'custom' };
  } else if (p === 'custom') {
    from = new Date(to.getTime() - 7 * 86400000);
  } else {
    from = new Date(to.getTime() - 7 * 86400000);
  }
  return { from, to, preset: p };
}

const TRANSLATION_ONLY_SQL = `(
  LOWER(COALESCE(h.metadata->>'translationOnly', '')) IN ('true', '1', 'yes')
  OR (h.metadata->'translationOnly')::text = 'true'
)`;

function buildUsageWhere(opts, params, alias = 'h') {
  const where = [];
  const { from, to } = opts.range || {};
  if (from) {
    params.push(from.toISOString());
    where.push(`${alias}.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to.toISOString());
    where.push(`${alias}.created_at <= $${params.length}::timestamptz`);
  }
  if (opts.type && opts.type !== 'all') {
    params.push(opts.type);
    where.push(`${alias}.type = $${params.length}`);
  }
  if (opts.platform && opts.platform !== 'all') {
    params.push(String(opts.platform).toLowerCase());
    where.push(
      `LOWER(COALESCE(${alias}.metadata->>'platform', ${alias}.metadata->>'source', 'unknown')) = $${params.length}`
    );
  }
  if (opts.plan && opts.plan !== 'all') {
    params.push(String(opts.plan).toLowerCase());
    where.push(`LOWER(COALESCE(s.plan, 'free')) = $${params.length}`);
  }
  if (opts.country && opts.country !== 'all') {
    params.push(String(opts.country).toUpperCase().slice(0, 2));
    where.push(`UPPER(COALESCE(up.country, '')) = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${String(opts.search).toLowerCase()}%`);
    where.push(`LOWER(u.email) LIKE $${params.length}`);
  }
  return where.join(' AND ');
}

function usageWhere(opts, params, alias = 'h') {
  const w = buildUsageWhere(opts, params, alias);
  return w ? `WHERE ${w}` : '';
}

const USAGE_FROM = `
  FROM usage_history h
  JOIN users u ON u.id = h.user_id
  LEFT JOIN subscriptions s ON s.user_id = u.id
  LEFT JOIN user_profiles up ON up.user_id = u.id
`;

async function queryKpis(pool, range, prevRange) {
  const run = async (from, to) => {
    const params = [];
    const whereSql = usageWhere({ range: { from, to } }, params);
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS total_minutes,
         COUNT(*)::int AS total_jobs,
         COUNT(*) FILTER (WHERE h.type = 'download')::int AS total_exports,
         COALESCE(AVG(CASE WHEN h.type = 'transcription' AND h.minutes > 0 THEN h.minutes END), 0)::float AS avg_duration,
         COUNT(*) FILTER (WHERE ${TRANSLATION_ONLY_SQL})::int AS translations,
         COUNT(*)::int AS total_events
       ${USAGE_FROM}
       ${whereSql}`,
      params
    );
    const row = r.rows[0] || {};
    const totalEvents = Number(row.total_events || 0);
    const translations = Number(row.translations || 0);
    return {
      totalMinutes: Number(row.total_minutes || 0),
      totalJobs: Number(row.total_jobs || 0),
      totalExports: Number(row.total_exports || 0),
      avgDuration: Math.round(Number(row.avg_duration || 0) * 10) / 10,
      translationPct: totalEvents > 0 ? Math.round((translations / totalEvents) * 1000) / 10 : 0,
      estimatedCostEur: Math.round(Number(row.total_minutes || 0) * OPENAI_EUR_PER_MINUTE * 100) / 100
    };
  };

  const [cur, prev] = await Promise.all([run(range.from, range.to), run(prevRange.from, prevRange.to)]);

  const params2 = [];
  const where2 = usageWhere({ range }, params2);
  const countryExtra = where2 ? `${where2} AND up.country IS NOT NULL` : `WHERE up.country IS NOT NULL`;
  const [platformRes, countryRes, activeTodayRes, avgLenRes] = await Promise.all([
    pool.query(
      `SELECT LOWER(COALESCE(h.metadata->>'platform', h.metadata->>'source', 'unknown')) AS platform,
              COUNT(*)::int AS c
       ${USAGE_FROM} ${where2}
       GROUP BY 1 ORDER BY c DESC LIMIT 1`,
      params2
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(TRIM(up.country), ''), '—') AS country, COUNT(*)::int AS c
       ${USAGE_FROM} ${countryExtra}
       GROUP BY 1 ORDER BY c DESC LIMIT 1`,
      params2
    ),
    pool.query(
      `SELECT COUNT(DISTINCT h.user_id)::int AS c FROM usage_history h
       WHERE h.created_at >= NOW() - INTERVAL '1 day'`
    ),
    range.from
      ? pool.query(
          `SELECT COALESCE(AVG(LENGTH(content)), 0)::float AS avg_len
           FROM saved_outputs so
           WHERE so.created_at >= $1::timestamptz AND so.created_at <= $2::timestamptz`,
          [range.from.toISOString(), range.to.toISOString()]
        )
      : pool.query(`SELECT COALESCE(AVG(LENGTH(content)), 0)::float AS avg_len FROM saved_outputs so`)
  ]);

  return {
    ...cur,
    avgTranscriptLength: Math.round(Number(avgLenRes.rows[0]?.avg_len || 0)),
    mostUsedPlatform: platformRes.rows[0]?.platform || '—',
    mostActiveCountry: countryRes.rows[0]?.country || '—',
    activeUsersToday: Number(activeTodayRes.rows[0]?.c || 0),
    trends: {
      totalMinutes: pctChange(cur.totalMinutes, prev.totalMinutes),
      totalJobs: pctChange(cur.totalJobs, prev.totalJobs),
      totalExports: pctChange(cur.totalExports, prev.totalExports),
      avgDuration: pctChange(cur.avgDuration, prev.avgDuration),
      estimatedCostEur: pctChange(cur.estimatedCostEur, prev.estimatedCostEur)
    },
    sparklines: await querySparklines(pool, range)
  };
}

async function querySparklines(pool, range) {
  const to = range.to || new Date();
  const from = range.from || new Date(to.getTime() - 90 * 86400000);
  const params = [from.toISOString(), to.toISOString()];
  const r = await pool.query(
    `SELECT to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes,
            COUNT(*)::int AS jobs
     FROM usage_history h
     WHERE h.created_at >= $1::timestamptz AND h.created_at <= $2::timestamptz
     GROUP BY 1 ORDER BY 1 ASC`,
    params
  );
  return {
    minutes: r.rows.map((x) => ({ day: x.day, value: Number(x.minutes || 0) })),
    jobs: r.rows.map((x) => ({ day: x.day, value: Number(x.jobs || 0) }))
  };
}

async function queryTimeline(pool, range) {
  const params = [];
  const whereSql = usageWhere({ range }, params);
  const r = await pool.query(
    `SELECT to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') AS day,
       COUNT(*) FILTER (WHERE h.type = 'transcription' AND NOT (${TRANSLATION_ONLY_SQL}))::int AS transcript,
       COUNT(*) FILTER (WHERE ${TRANSLATION_ONLY_SQL})::int AS translate,
       COUNT(*) FILTER (WHERE h.type = 'summarization')::int AS summary,
       COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind','') = 'audio')::int AS download_audio,
       COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind','') = 'video')::int AS download_video,
       COUNT(*) FILTER (WHERE h.type = 'srt')::int AS srt
     ${USAGE_FROM}
     ${whereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({
    day: row.day,
    transcript: Number(row.transcript || 0),
    translate: Number(row.translate || 0),
    summary: Number(row.summary || 0),
    downloadAudio: Number(row.download_audio || 0),
    downloadVideo: Number(row.download_video || 0),
    srt: Number(row.srt || 0)
  }));
}

async function queryBreakdowns(pool, range) {
  const params = [];
  const whereSql = usageWhere({ range }, params);

  const [byFeature, byPlatform, byCountry, byPlan, expensive] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE h.type = 'transcription' AND NOT (${TRANSLATION_ONLY_SQL}))::int AS transcript,
         COUNT(*) FILTER (WHERE ${TRANSLATION_ONLY_SQL})::int AS translate,
         COUNT(*) FILTER (WHERE h.type = 'summarization')::int AS summary,
         COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind','') = 'audio')::int AS download_audio,
         COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind','') = 'video')::int AS download_video,
         COUNT(*) FILTER (WHERE h.type = 'srt')::int AS srt
       ${USAGE_FROM} ${whereSql}`,
      params
    ),
    pool.query(
      `SELECT LOWER(COALESCE(h.metadata->>'platform', h.metadata->>'source', 'unknown')) AS name, COUNT(*)::int AS count
       ${USAGE_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC LIMIT 8`,
      params
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(TRIM(up.country), ''), '—') AS name, COUNT(*)::int AS count
       ${USAGE_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC LIMIT 10`,
      params
    ),
    pool.query(
      `SELECT COALESCE(s.plan, 'free') AS name, COUNT(*)::int AS count
       ${USAGE_FROM} ${whereSql} GROUP BY 1 ORDER BY count DESC`,
      params
    ),
    pool.query(
      `SELECT u.email,
              COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes,
              (COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0) * ${OPENAI_EUR_PER_MINUTE})::numeric AS cost_eur
       ${USAGE_FROM} ${whereSql}
       GROUP BY u.email ORDER BY cost_eur DESC LIMIT 8`,
      params
    )
  ]);

  const f = byFeature.rows[0] || {};
  return {
    byFeature: {
      transcript: Number(f.transcript || 0),
      translate: Number(f.translate || 0),
      summary: Number(f.summary || 0),
      downloadAudio: Number(f.download_audio || 0),
      downloadVideo: Number(f.download_video || 0),
      srt: Number(f.srt || 0)
    },
    byPlatform: byPlatform.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    byCountry: byCountry.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    byPlan: byPlan.rows.map((r) => ({ name: r.name, count: Number(r.count || 0) })),
    topExpensiveUsers: expensive.rows.map((r) => ({
      email: r.email,
      minutes: Number(r.minutes || 0),
      costEur: Math.round(Number(r.cost_eur || 0) * 100) / 100
    }))
  };
}

function mapActivityRow(row) {
  const meta = row.metadata || {};
  const platform = meta.platform || meta.source || 'unknown';
  const minutes = Number(row.minutes || 0);
  const isTranslation =
    meta.translationOnly === true ||
    meta.translationOnly === 1 ||
    String(meta.translationOnly || '').toLowerCase() === 'true';
  let exportType = '—';
  if (row.type === 'download') exportType = meta.kind === 'video' ? 'video' : meta.kind === 'audio' ? 'audio' : 'download';
  if (row.type === 'srt') exportType = 'srt';
  const status = minutes < 0 || meta.adjustment === 'refund' ? 'refunded' : 'completed';
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    type: row.type,
    minutes,
    metadata: meta,
    createdAt:
      row.created_at?.toISOString?.() ||
      row.created_at ||
      (row.createdAt?.toISOString ? row.createdAt.toISOString() : row.createdAt),
    email: row.email,
    plan: resolvePlanKey(row.plan || 'free'),
    country: row.country || '—',
    platform,
    title: meta.title || meta.videoTitle || meta.filename || '—',
    sourceUrl: meta.sourceUrl || meta.url || meta.sourceUrlNorm || '',
    costEstimateEur: Math.round(Math.max(0, minutes) * OPENAI_EUR_PER_MINUTE * 100) / 100,
    durationMinutes: Math.max(0, minutes),
    exportType,
    status,
    isTranslation
  };
}

async function queryActivities(pool, opts) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(opts.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const params = [];
  const whereSql = usageWhere(opts, params);
  const sortCol =
    opts.sort === 'minutes'
      ? 'h.minutes'
      : opts.sort === 'email'
        ? 'u.email'
        : opts.sort === 'type'
          ? 'h.type'
          : 'h.created_at';
  const sortDir = String(opts.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c ${USAGE_FROM} ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.c || 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(pageSize, offset);
  const r = await pool.query(
    `SELECT h.id, h.user_id, h.type, h.minutes, h.metadata, h.created_at, u.email,
            COALESCE(s.plan, 'free') AS plan, up.country
     ${USAGE_FROM}
     ${whereSql}
     ORDER BY ${sortCol} ${sortDir}, h.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return {
    activities: r.rows.map(mapActivityRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

function buildInsights(data) {
  const insights = [];
  const k = data.kpis || {};
  const b = data.breakdowns || {};
  const t = k.trends || {};

  if (t.totalMinutes != null && t.totalMinutes > 15) {
    insights.push({ tone: 'ok', text: `Processing volume increased ${t.totalMinutes}% vs the previous period.` });
  }
  if (k.translationPct > 20) {
    insights.push({ tone: 'ok', text: `Translation usage is ${k.translationPct}% of activity in this period.` });
  }
  const ig = (b.byPlatform || []).find((p) => p.name === 'instagram');
  const yt = (b.byPlatform || []).find((p) => p.name === 'youtube');
  if (ig && yt && ig.count > yt.count * 0.5) {
    insights.push({ tone: 'neutral', text: 'Instagram uploads are growing as a share of platform traffic.' });
  }
  const top = (b.topExpensiveUsers || [])[0];
  const second = (b.topExpensiveUsers || [])[1];
  if (top && second && top.costEur > second.costEur * 2) {
    insights.push({
      tone: 'warn',
      text: `High AI cost concentration: ${top.email} accounts for a large share of estimated spend.`
    });
  }
  if (t.avgDuration != null && t.avgDuration < -10) {
    insights.push({ tone: 'ok', text: 'Average processing time improved compared to the previous period.' });
  }
  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      text: 'Usage patterns are stable for the selected filters. Try a wider date range to surface trends.'
    });
  }
  return insights.slice(0, 5);
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

export function normalizeUsageActivityRow(row) {
  if (!row) return null;
  if (row.email && row.createdAt && !row.created_at) {
    return mapActivityRow({
      id: row.id,
      user_id: row.userId || null,
      type: row.type,
      minutes: row.minutes,
      metadata: row.metadata || {},
      created_at: row.createdAt,
      email: row.email,
      plan: row.plan,
      country: row.country
    });
  }
  return mapActivityRow(row);
}

export async function getAdminUsageDashboardDb(filters = {}) {
  const widgetErrors = [];
  const emptyList = {
    activities: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1
  };

  if (!isBillingDbConfigured()) {
    return { ...emptyList, analytics: null, insights: [], debug: { dbConfigured: false } };
  }

  const cacheKey = JSON.stringify(filters);
  const hit = usageCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const range = resolveUsageDateRange(filters);
  const tr = trendRangeFor(range);
  const prevRange = { from: tr.prevFrom, to: tr.prevTo };

  const opts = {
    range,
    type: filters.type || 'all',
    platform: filters.platform || 'all',
    plan: filters.plan || 'all',
    country: filters.country || 'all',
    search: filters.search || '',
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
    sortDir: filters.sortDir
  };

  const pool = getPool();
  let list = emptyList;
  try {
    list = await queryActivities(pool, opts);
  } catch (e) {
    console.error('[admin usage] activities query failed', e);
    widgetErrors.push({ widget: 'activities', message: e?.message || String(e) });
  }

  let kpis = null;
  let timeline = [];
  let breakdowns = null;
  try {
    kpis = await queryKpis(pool, range, prevRange);
  } catch (e) {
    console.error('[admin usage] kpis failed', e);
    widgetErrors.push({ widget: 'kpis', message: e?.message || String(e) });
  }
  try {
    timeline = await queryTimeline(pool, range);
  } catch (e) {
    console.error('[admin usage] timeline failed', e);
    widgetErrors.push({ widget: 'timeline', message: e?.message || String(e) });
  }
  try {
    breakdowns = await queryBreakdowns(pool, range);
  } catch (e) {
    console.error('[admin usage] breakdowns failed', e);
    widgetErrors.push({ widget: 'breakdowns', message: e?.message || String(e) });
  }

  const analytics = {
    kpis,
    timeline,
    breakdowns,
    range: {
      from: range.from?.toISOString() || null,
      to: range.to?.toISOString() || null,
      preset: range.preset
    },
    _widgetErrors: widgetErrors
  };

  let insights = [];
  try {
    if (kpis && breakdowns) insights = buildInsights({ kpis, breakdowns });
  } catch (e) {
    console.error('[admin usage] insights failed', e);
    widgetErrors.push({ widget: 'insights', message: e?.message || String(e) });
  }

  const debug = {
    rowsFetched: list.activities?.length || 0,
    totalFiltered: list.total || 0,
    chartTimelinePoints: timeline?.length || 0,
    chartFeatureBuckets: breakdowns?.byFeature ? Object.keys(breakdowns.byFeature).length : 0,
    widgetsFailed: widgetErrors.map((w) => w.widget),
    preset: range.preset,
    dbConfigured: true
  };
  console.info('[admin usage dashboard]', debug);

  const data = { ...list, analytics, insights, debug };
  usageCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
