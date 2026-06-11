/**
 * Admin overview dashboard — aggregated analytics (PostgreSQL).
 * Keeps queries parallelized; 60s in-memory cache per period.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { getAdminOverviewDb, ensureSubscriptionsSchema } from './billing-repository.js';
import { ensureAuditEventsTable } from './audit-repository.js';
import { tableExists } from './admin-db-safe.js';

const CACHE_TTL_MS = 60_000;
const OPENAI_EUR_PER_MINUTE = 0.0055;
const overviewCache = new Map();

const PAYMENT_DATE_EXPR = 'COALESCE(p.paid_at, p.created_at)';
const PAYMENT_AMOUNT_EXPR =
  'COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0)';
const PLAN_RANK_EXPR = `CASE lower(COALESCE(NULLIF(TRIM(p.plan_key), ''), NULLIF(TRIM(p.plan), ''), 'free'))
  WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 WHEN 'business' THEN 3 ELSE 0 END`;
const SUB_PERIOD_END_EXPR = 'COALESCE(s.current_period_end, s.expires_at)';

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function safeRate(n, d) {
  const den = Number(d) || 0;
  if (den <= 0) return 0;
  return Math.round((Number(n) / den) * 1000) / 10;
}

/** @returns {{ key: string, from: Date|null, to: Date, prevFrom: Date, prevTo: Date, trendFrom: Date, trendTo: Date }} */
export function resolveOverviewPeriod(periodKey) {
  const key = String(periodKey || '30d').toLowerCase();
  const to = new Date();
  let from = null;
  let spanMs = 30 * 86400000;

  if (key === 'today') {
    from = startOfUtcDay(to);
    spanMs = to.getTime() - from.getTime();
  } else if (key === '7d') {
    spanMs = 7 * 86400000;
    from = new Date(to.getTime() - spanMs);
  } else if (key === '90d') {
    spanMs = 90 * 86400000;
    from = new Date(to.getTime() - spanMs);
  } else if (key === 'all') {
    from = null;
    spanMs = 30 * 86400000;
  } else {
    spanMs = 30 * 86400000;
    from = new Date(to.getTime() - spanMs);
  }

  const trendTo = key === 'all' ? to : from ? to : to;
  const trendFrom =
    key === 'all' ? new Date(to.getTime() - spanMs) : from || new Date(to.getTime() - spanMs);
  const prevTo = new Date(trendFrom.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - (trendTo.getTime() - trendFrom.getTime()));

  return { key, from, to, prevFrom, prevTo, trendFrom, trendTo };
}

function dateWhere(col, from, to, params) {
  const parts = [];
  if (from) {
    params.push(from.toISOString());
    parts.push(`${col} >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to.toISOString());
    parts.push(`${col} <= $${params.length}::timestamptz`);
  }
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

async function queryLifetimeRevenue(pool) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue
     FROM payments p
     WHERE p.status = 'success'`
  );
  return Number(r.rows[0]?.revenue || 0);
}

async function queryRevenueMetrics(pool, from, to) {
  const params = [];
  const w = dateWhere(PAYMENT_DATE_EXPR, from, to, params);
  const r = await pool.query(
    `SELECT
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue,
       COUNT(*)::int AS payments
     FROM payments p
     WHERE p.status = 'success' AND ${w}`,
    params
  );
  return {
    revenue: Number(r.rows[0]?.revenue || 0),
    payments: Number(r.rows[0]?.payments || 0)
  };
}

async function queryRevenueByPlan(pool, from, to) {
  const params = [];
  const w = dateWhere(PAYMENT_DATE_EXPR, from, to, params);
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(p.plan_key), ''), NULLIF(TRIM(p.plan), ''), 'free') AS plan,
            COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue,
            COUNT(*)::int AS count
     FROM payments p
     WHERE p.status = 'success' AND ${w}
     GROUP BY 1
     ORDER BY revenue DESC`,
    params
  );
  return r.rows.map((row) => ({
    plan: row.plan,
    revenue: Number(row.revenue || 0),
    count: Number(row.count || 0)
  }));
}

async function queryRevenueTimeline(pool, from, to) {
  const params = [];
  const w = dateWhere(PAYMENT_DATE_EXPR, from, to, params);
  const r = await pool.query(
    `SELECT to_char(date_trunc('day', ${PAYMENT_DATE_EXPR}), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue
     FROM payments p
     WHERE p.status = 'success' AND ${w}
     GROUP BY 1
     ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({ day: row.day, revenue: Number(row.revenue || 0) }));
}

function computeMrrFromSubscriptions(rows) {
  let mrr = 0;
  const now = Date.now();
  for (const row of rows) {
    const pk = resolvePlanKey(row.plan);
    if (!pk || pk === 'free') continue;
    if (String(row.status || '').toLowerCase() !== 'active') continue;
    const periodEnd = row.current_period_end || row.expires_at;
    if (periodEnd && new Date(periodEnd).getTime() <= now) continue;
    const def = getPlanDef(pk);
    mrr += Number(def?.priceEur?.monthly || 0);
  }
  return Math.round(mrr * 100) / 100;
}

async function querySubscriptions(pool) {
  const snapRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE COALESCE(s.plan, 'free') <> 'free'
           AND lower(COALESCE(s.status, '')) = 'active'
           AND (${SUB_PERIOD_END_EXPR} IS NULL OR ${SUB_PERIOD_END_EXPR} > NOW())
       )::int AS active,
       COUNT(*) FILTER (WHERE lower(COALESCE(s.status, '')) = 'trialing')::int AS trial,
       COUNT(*) FILTER (
         WHERE COALESCE(s.plan, 'free') <> 'free'
           AND (
             lower(COALESCE(s.status, '')) IN ('canceled', 'cancelled', 'expired', 'past_due', 'unpaid')
             OR (${SUB_PERIOD_END_EXPR} IS NOT NULL AND ${SUB_PERIOD_END_EXPR} <= NOW())
           )
       )::int AS expired
     FROM subscriptions s`
  );
  const snap = snapRes.rows[0] || {};
  const active = Number(snap.active || 0);
  const trial = Number(snap.trial || 0);
  const expired = Number(snap.expired || 0);

  const activeRows = await pool.query(
    `SELECT s.plan, s.status, s.current_period_end, s.expires_at
     FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') <> 'free'
       AND lower(COALESCE(s.status, '')) = 'active'
       AND (${SUB_PERIOD_END_EXPR} IS NULL OR ${SUB_PERIOD_END_EXPR} > NOW())`
  );
  const mrr = computeMrrFromSubscriptions(activeRows.rows);

  const churnRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') <> 'free'
       AND (
         (
           lower(COALESCE(s.status, '')) IN ('canceled', 'cancelled', 'expired', 'past_due', 'unpaid')
           AND s.updated_at >= NOW() - INTERVAL '30 days'
         )
         OR (
           ${SUB_PERIOD_END_EXPR} IS NOT NULL
           AND ${SUB_PERIOD_END_EXPR} <= NOW()
           AND ${SUB_PERIOD_END_EXPR} >= NOW() - INTERVAL '30 days'
         )
       )`
  );

  const upgradeRes = await pool.query(
    `WITH ordered AS (
       SELECT
         p.user_id,
         ${PLAN_RANK_EXPR} AS rk,
         LAG(${PLAN_RANK_EXPR}) OVER (
           PARTITION BY p.user_id ORDER BY ${PAYMENT_DATE_EXPR}
         ) AS prev_rk
       FROM payments p
       WHERE p.status = 'success'
         AND ${PAYMENT_DATE_EXPR} >= NOW() - INTERVAL '90 days'
     )
     SELECT
       COUNT(*) FILTER (WHERE prev_rk IS NOT NULL AND rk > prev_rk)::int AS upgrades,
       COUNT(*) FILTER (WHERE prev_rk IS NOT NULL AND rk < prev_rk AND prev_rk > 0)::int AS downgrades
     FROM ordered`
  );
  const up = Number(upgradeRes.rows[0]?.upgrades || 0);
  const down = Number(upgradeRes.rows[0]?.downgrades || 0);
  return {
    active,
    trial,
    expired,
    mrr,
    churnRate: safeRate(Number(churnRes.rows[0]?.c || 0), Math.max(active + Number(churnRes.rows[0]?.c || 0), 1)),
    upgradeDowngradeRatio: down > 0 ? Math.round((up / down) * 100) / 100 : up
  };
}

async function queryUserMetrics(pool, from, to) {
  const params = [];
  const wUsers = dateWhere('u.created_at', from, to, params);
  const newUsersRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM users u WHERE ${wUsers}`,
    params
  );

  const dauRes = await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS c FROM usage_history
     WHERE created_at >= NOW() - INTERVAL '1 day' AND user_id IS NOT NULL`
  );
  const wauRes = await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS c FROM usage_history
     WHERE created_at >= NOW() - INTERVAL '7 days' AND user_id IS NOT NULL`
  );
  const mauRes = await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS c FROM usage_history
     WHERE created_at >= NOW() - INTERVAL '30 days' AND user_id IS NOT NULL`
  );

  let returningPct = null;
  try {
    await ensureAuditEventsTable();
    const ret = await pool.query(
      `WITH active AS (
         SELECT user_id, COUNT(DISTINCT date_trunc('day', created_at)) AS days
         FROM usage_history
         WHERE created_at >= NOW() - INTERVAL '30 days' AND user_id IS NOT NULL
         GROUP BY user_id
       )
       SELECT
         COUNT(*) FILTER (WHERE days >= 2)::int AS returning,
         COUNT(*)::int AS total
       FROM active`
    );
    returningPct = safeRate(ret.rows[0]?.returning, ret.rows[0]?.total);
  } catch (_e) {
    /* optional */
  }

  const activeParams = [];
  const wActive = dateWhere('h.created_at', from, to, activeParams);
  const activeInPeriodRes = await pool.query(
    `SELECT COUNT(DISTINCT h.user_id)::int AS c FROM usage_history h
     WHERE h.user_id IS NOT NULL AND ${wActive}`,
    activeParams
  );

  let countriesRes;
  if (from || to) {
    const countryParams = [];
    const wSignup = dateWhere('u.created_at', from, to, countryParams);
    const wUsage = dateWhere('h.created_at', from, to, countryParams);
    countriesRes = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(up.country), ''), '—') AS country, COUNT(DISTINCT u.id)::int AS count
       FROM users u
       JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN usage_history h ON h.user_id = u.id
       WHERE (${wSignup}) OR (${wUsage})
       GROUP BY 1
       ORDER BY count DESC
       LIMIT 12`,
      countryParams
    );
  } else {
    countriesRes = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(country), ''), '—') AS country, COUNT(*)::int AS count
       FROM user_profiles
       GROUP BY 1
       ORDER BY count DESC
       LIMIT 12`
    );
  }

  const topParams = [];
  const wTop = dateWhere('h.created_at', from, to, topParams);
  const topActiveRes = await pool.query(
    `SELECT u.email, COALESCE(SUM(h.minutes), 0)::float AS usage_minutes, MAX(h.created_at) AS last_active
     FROM usage_history h
     JOIN users u ON u.id = h.user_id
     WHERE ${wTop}
     GROUP BY u.email
     ORDER BY usage_minutes DESC
     LIMIT 8`,
    topParams
  );

  return {
    newUsers: Number(newUsersRes.rows[0]?.c || 0),
    activeInPeriod: Number(activeInPeriodRes.rows[0]?.c || 0),
    dau: Number(dauRes.rows[0]?.c || 0),
    wau: Number(wauRes.rows[0]?.c || 0),
    mau: Number(mauRes.rows[0]?.c || 0),
    returningPct,
    countries: countriesRes.rows.map((r) => ({
      country: r.country,
      count: Number(r.count || 0)
    })),
    mostActive: topActiveRes.rows.map((r) => ({
      email: r.email,
      usageMinutes: Number(r.usage_minutes || 0),
      lastActive: r.last_active?.toISOString?.() || r.last_active
    }))
  };
}

async function queryAiUsage(pool, from, to) {
  const params = [];
  const w = dateWhere('h.created_at', from, to, params);
  const usageRes = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS total_minutes,
       COALESCE(AVG(CASE WHEN h.type = 'transcription' AND h.minutes > 0 THEN h.minutes END), 0)::float AS avg_duration,
       COUNT(*) FILTER (WHERE h.type = 'transcription')::int AS transcriptions,
       COUNT(*) FILTER (WHERE h.type = 'summarization')::int AS summaries,
       COUNT(*) FILTER (WHERE COALESCE((h.metadata->>'translationOnly')::boolean, false) = true)::int AS translations
     FROM usage_history h
     WHERE ${w}`,
    params
  );
  const row = usageRes.rows[0] || {};
  const totalMinutes = Number(row.total_minutes || 0);
  const usersRes = await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS c FROM usage_history h WHERE ${w}`,
    params
  );
  const activeUsers = Number(usersRes.rows[0]?.c || 0);
  const lenParams = [];
  const wLen = dateWhere('h.created_at', from, to, lenParams);
  const lenRes = await pool.query(
    `SELECT COALESCE(
       AVG(NULLIF((h.metadata->>'textLength')::int, 0)),
       AVG(NULLIF((h.metadata->>'charCount')::int, 0)),
       0
     )::float AS avg_len
     FROM usage_history h
     WHERE h.type = 'transcription' AND ${wLen}`,
    lenParams
  );
  let avgTranscriptLength = Math.round(Number(lenRes.rows[0]?.avg_len || 0));
  if (!avgTranscriptLength) {
    const savedLenParams = [];
    const wSavedLen = dateWhere('created_at', from, to, savedLenParams);
    const savedLenRes = await pool.query(
      `SELECT COALESCE(AVG(LENGTH(content)), 0)::float AS avg_len
       FROM saved_outputs
       WHERE LOWER(type) IN ('transcript', 'transcription', 'text') AND ${wSavedLen}`,
      savedLenParams
    );
    avgTranscriptLength = Math.round(Number(savedLenRes.rows[0]?.avg_len || 0));
  }
  return {
    totalMinutes,
    estimatedCostEur: Math.round(totalMinutes * OPENAI_EUR_PER_MINUTE * 100) / 100,
    avgProcessingMinutes: Math.round(Number(row.avg_duration || 0) * 10) / 10,
    avgTranscriptLength,
    translationUsage: Number(row.translations || 0),
    summaryUsage: Number(row.summaries || 0),
    costPerUser:
      activeUsers > 0
        ? Math.round(((totalMinutes * OPENAI_EUR_PER_MINUTE) / activeUsers) * 100) / 100
        : null
  };
}

async function queryStorage(pool, from, to) {
  const params = [];
  const w = dateWhere('created_at', from, to, params);
  const countsRes = await pool.query(
    `SELECT type, COUNT(*)::int AS count FROM saved_outputs WHERE ${w} GROUP BY type`,
    params
  );
  const byType = Object.fromEntries(countsRes.rows.map((r) => [r.type, Number(r.count || 0)]));
  const usageParams = [];
  const wUsage = dateWhere('created_at', from, to, usageParams);
  const usageTypeRes = await pool.query(
    `SELECT type, COUNT(*)::int AS count
     FROM usage_history
     WHERE ${wUsage} AND type IN ('srt', 'mp4_export')
     GROUP BY type`,
    usageParams
  );
  const usageByType = Object.fromEntries(usageTypeRes.rows.map((r) => [r.type, Number(r.count || 0)]));
  let mp4Exports =
    Number(byType.mp4 || 0) + Number(usageByType.mp4_export || 0);
  if (await tableExists(pool, 'project_exports')) {
    const mp4Params = [];
    const wMp4 = dateWhere('COALESCE(e.completed_at, e.created_at)', from, to, mp4Params);
    const mp4Res = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM project_exports e
       WHERE e.status = 'completed' AND ${wMp4}`,
      mp4Params
    );
    mp4Exports = Math.max(mp4Exports, Number(mp4Res.rows[0]?.c || 0));
  }
  const sizeParams = [];
  const wSize = dateWhere('created_at', from, to, sizeParams);
  const sizeRes = await pool.query(
    `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0)::bigint AS bytes FROM saved_outputs WHERE ${wSize}`,
    sizeParams
  );
  return {
    savedTranscripts: Number(byType.transcript || byType.transcription || 0) + Number(byType.text || 0),
    summaries: Number(byType.summary || byType.summarization || 0),
    srtExports: Number(byType.srt || 0) + Number(usageByType.srt || 0),
    mp4Exports,
    docxExports: Number(byType.docx || 0),
    txtExports: Number(byType.txt || 0),
    totalSaved: countsRes.rows.reduce((s, r) => s + Number(r.count || 0), 0) + mp4Exports,
    storageBytes: Number(sizeRes.rows[0]?.bytes || 0)
  };
}

async function queryFeatureUsage(pool, from, to) {
  const params = [];
  const w = dateWhere('h.created_at', from, to, params);
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE h.type = 'transcription' AND COALESCE((h.metadata->>'translationOnly')::boolean, false) IS NOT TRUE)::int AS transcript,
       COUNT(*) FILTER (WHERE COALESCE((h.metadata->>'translationOnly')::boolean, false) = true)::int AS translate,
       COUNT(*) FILTER (WHERE h.type = 'summarization')::int AS summary,
       COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind', '') = 'video')::int AS download_video,
       COUNT(*) FILTER (WHERE h.type = 'download' AND COALESCE(h.metadata->>'kind', '') = 'audio')::int AS download_audio
     FROM usage_history h
     WHERE ${w}`,
    params
  );
  const row = r.rows[0] || {};
  return {
    transcript: Number(row.transcript || 0),
    translate: Number(row.translate || 0),
    summary: Number(row.summary || 0),
    downloadVideo: Number(row.download_video || 0),
    downloadAudio: Number(row.download_audio || 0)
  };
}

async function queryUserGrowthTimeline(pool, from, to) {
  const params = [];
  const w = dateWhere('u.created_at', from, to, params);
  const r = await pool.query(
    `SELECT to_char(date_trunc('day', u.created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS users
     FROM users u
     WHERE ${w}
     GROUP BY 1
     ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({ day: row.day, users: Number(row.users || 0) }));
}

async function queryPlansDistribution(pool) {
  const r = await pool.query(
    `SELECT COALESCE(s.plan, 'free') AS plan, COUNT(*)::int AS count
     FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') = 'free'
        OR (
          lower(COALESCE(s.status, '')) IN ('active', 'trialing')
          AND (${SUB_PERIOD_END_EXPR} IS NULL OR ${SUB_PERIOD_END_EXPR} > NOW())
        )
     GROUP BY 1
     ORDER BY count DESC`
  );
  return r.rows.map((row) => ({ plan: row.plan, count: Number(row.count || 0) }));
}

async function queryCostVsRevenueTimeline(pool, from, to) {
  const params = [];
  const w = dateWhere(PAYMENT_DATE_EXPR, from, to, params);
  const rev = await pool.query(
    `SELECT to_char(date_trunc('day', ${PAYMENT_DATE_EXPR}), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue
     FROM payments p
     WHERE p.status = 'success' AND ${w}
     GROUP BY 1 ORDER BY 1`,
    params
  );
  const params2 = [];
  const w2 = dateWhere('h.created_at', from, to, params2);
  const cost = await pool.query(
    `SELECT to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes
     FROM usage_history h WHERE ${w2} GROUP BY 1 ORDER BY 1`,
    params2
  );
  const dayMap = new Map();
  for (const row of rev.rows) {
    dayMap.set(row.day, { day: row.day, revenue: Number(row.revenue || 0), costEur: 0 });
  }
  for (const row of cost.rows) {
    const cur = dayMap.get(row.day) || { day: row.day, revenue: 0, costEur: 0 };
    cur.costEur = Math.round(Number(row.minutes || 0) * OPENAI_EUR_PER_MINUTE * 100) / 100;
    dayMap.set(row.day, cur);
  }
  return [...dayMap.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

async function queryLiveMetrics(pool) {
  let onlineUsers = 0;
  let errors24h = 0;
  try {
    await ensureAuditEventsTable();
    const online = await pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS c FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '15 minutes' AND user_id IS NOT NULL`
    );
    onlineUsers = Number(online.rows[0]?.c || 0);
    const err = await pool.query(
      `SELECT COUNT(*)::int AS c FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '24 hours' AND event_type = 'error'`
    );
    errors24h = Number(err.rows[0]?.c || 0);
  } catch (_e) {
    /* audit optional */
  }
  const pendingAllRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM payments WHERE status = 'pending'`
  );
  const pending24hRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM payments
     WHERE status = 'pending' AND created_at >= NOW() - INTERVAL '24 hours'`
  );
  const failedPay24hRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM payments
     WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'`
  );
  return {
    onlineUsers,
    pendingPayments: Number(pendingAllRes.rows[0]?.c || 0),
    pendingPayments24h: Number(pending24hRes.rows[0]?.c || 0),
    failedPayments24h: Number(failedPay24hRes.rows[0]?.c || 0),
    errors24h,
    activeJobsInQueue: Number(pendingAllRes.rows[0]?.c || 0),
    failedJobs: errors24h,
    avgResponseTimeMs: null
  };
}

async function queryConversion(pool, from, to) {
  const params = [];
  const w = dateWhere('created_at', from, to, params);
  const funnel = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE event = 'pricing_viewed')::int AS views,
      COUNT(*) FILTER (WHERE event = 'payment_started')::int AS started,
      COUNT(*) FILTER (WHERE event = 'payment_success')::int AS success,
      COUNT(*) FILTER (WHERE event = 'payment_failed')::int AS failed
    FROM analytics_events
    WHERE ${w}`,
    params
  );
  const row = funnel.rows[0] || {};
  const views = Number(row.views || 0);
  const started = Number(row.started || 0);
  const success = Number(row.success || 0);
  const offers = await pool.query(
    `SELECT COALESCE(SUM(current_uses), 0)::int AS uses, COUNT(*)::int AS total
     FROM offers WHERE active = true`
  );
  return {
    checkoutCompletionPct: safeRate(success, started),
    conversionRate: safeRate(success, views),
    abandonedCheckouts: Math.max(0, started - success),
    couponUsage: Number(offers.rows[0]?.uses || 0),
    activeOffers: Number(offers.rows[0]?.total || 0),
    offerRedemptionPct: null
  };
}

async function queryTopCustomers(pool, from, to) {
  const params = [];
  const wUsage = dateWhere('uh.created_at', from, to, params);
  const r = await pool.query(
    `SELECT u.email,
            COALESCE(s.plan, 'free') AS plan,
            COALESCE(up.country, '') AS country,
            COALESCE((
              SELECT SUM(COALESCE(p2.final_amount_eur, p2.amount_eur, p2.amount, 0))
              FROM payments p2
              WHERE p2.user_id = u.id AND p2.status = 'success'
            ), 0)::numeric AS revenue,
            COALESCE(SUM(CASE WHEN uh.minutes > 0 THEN uh.minutes ELSE 0 END), 0)::float AS usage_minutes,
            GREATEST(u.created_at, MAX(uh.created_at)) AS last_active
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN usage_history uh ON uh.user_id = u.id AND ${wUsage}
     GROUP BY u.id, u.email, s.plan, up.country, u.created_at
     HAVING COALESCE((
              SELECT SUM(COALESCE(p2.final_amount_eur, p2.amount_eur, p2.amount, 0))
              FROM payments p2
              WHERE p2.user_id = u.id AND p2.status = 'success'
            ), 0) > 0
         OR COALESCE(SUM(CASE WHEN uh.minutes > 0 THEN uh.minutes ELSE 0 END), 0) > 0
     ORDER BY revenue DESC, usage_minutes DESC
     LIMIT 12`,
    params
  );
  return r.rows.map((row) => ({
    email: row.email,
    plan: row.plan,
    country: row.country || '—',
    revenue: Number(row.revenue || 0),
    totalUsage: Number(row.usage_minutes || 0),
    lastActive: row.last_active?.toISOString?.() || row.last_active
  }));
}

async function queryActivityFeed(pool, from, to) {
  const items = [];
  const userParams = [];
  const wUsers = dateWhere('created_at', from, to, userParams);
  const users = await pool.query(
    `SELECT email, created_at FROM users WHERE ${wUsers} ORDER BY created_at DESC LIMIT 8`,
    userParams
  );
  for (const row of users.rows) {
    items.push({
      type: 'user_signup',
      label: 'New user',
      detail: row.email,
      at: row.created_at?.toISOString?.() || row.created_at
    });
  }
  const payParams = [];
  const wPay = dateWhere(PAYMENT_DATE_EXPR, from, to, payParams);
  const pays = await pool.query(
    `SELECT u.email, p.status, p.plan,
            COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0) AS amount,
            ${PAYMENT_DATE_EXPR} AS paid_at
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE ${wPay}
     ORDER BY ${PAYMENT_DATE_EXPR} DESC LIMIT 12`,
    payParams
  );
  for (const row of pays.rows) {
    items.push({
      type: row.status === 'success' ? 'purchase' : row.status === 'failed' ? 'payment_failed' : 'payment',
      label: row.status === 'success' ? 'Purchase' : row.status === 'failed' ? 'Failed payment' : 'Payment',
      detail: `${row.email} · ${row.plan || '—'} · €${Number(row.amount || 0).toFixed(2)}`,
      at: row.paid_at?.toISOString?.() || row.paid_at
    });
  }
  const usageParams = [];
  const wUsage = dateWhere('h.created_at', from, to, usageParams);
  const usage = await pool.query(
    `SELECT u.email, h.type, h.minutes, h.created_at
     FROM usage_history h JOIN users u ON u.id = h.user_id
     WHERE ${wUsage}
     ORDER BY h.created_at DESC LIMIT 10`,
    usageParams
  );
  for (const row of usage.rows) {
    items.push({
      type: 'ai_processing',
      label: 'AI processing',
      detail: `${row.email} · ${row.type} · ${Number(row.minutes || 0)} min`,
      at: row.created_at?.toISOString?.() || row.created_at
    });
  }
  try {
    await ensureAuditEventsTable();
    const auditParams = [];
    const wAudit = dateWhere('created_at', from, to, auditParams);
    const audit = await pool.query(
      `SELECT event_name, event_type, COALESCE(metadata->>'email', '') AS email, created_at
       FROM audit_events
       WHERE event_name IN ('login', 'admin_action', 'payment_success', 'export')
         AND ${wAudit}
       ORDER BY created_at DESC LIMIT 10`,
      auditParams
    );
    for (const row of audit.rows) {
      items.push({
        type: row.event_name,
        label: row.event_name.replace(/_/g, ' '),
        detail: row.email || row.event_type,
        at: row.created_at?.toISOString?.() || row.created_at
      });
    }
  } catch (_e) {
    /* optional */
  }
  return items
    .filter((x) => x.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 25);
}

function buildInsights(data) {
  const insights = [];
  const revGrowth = data.revenue?.growthPct;
  if (revGrowth != null && revGrowth > 5) {
    insights.push({
      tone: 'ok',
      text: `Revenue increased ${revGrowth}% vs the previous period.`
    });
  } else if (revGrowth != null && revGrowth < -5) {
    insights.push({
      tone: 'warn',
      text: `Revenue decreased ${Math.abs(revGrowth)}% vs the previous period.`
    });
  }
  if (data.ai?.translationUsage > data.ai?.summaryUsage && data.ai?.translationUsage > 10) {
    insights.push({ tone: 'ok', text: 'Translation usage is growing rapidly.' });
  }
  if (data.conversion?.abandonedCheckouts > 5) {
    insights.push({
      tone: 'warn',
      text: `High abandonment on checkout (${data.conversion.abandonedCheckouts} started, not completed).`
    });
  }
  const topCountry = data.users?.countries?.[0];
  if (topCountry && topCountry.country && topCountry.country !== '—') {
    insights.push({
      tone: 'neutral',
      text: `Most users are from ${topCountry.country} (${topCountry.count} profiles).`
    });
  }
  const starter = data.revenue?.byPlan?.find((p) => p.plan === 'starter');
  const pro = data.revenue?.byPlan?.find((p) => p.plan === 'pro');
  if (starter && pro && starter.count > 0 && pro.count / starter.count < 0.3) {
    insights.push({ tone: 'warn', text: 'Starter plan converts poorly relative to Pro.' });
  }
  if (data.ai?.costPerUser != null && data.ai.costPerUser > 2) {
    insights.push({
      tone: 'warn',
      text: 'Average AI cost per active user is elevated — review usage patterns.'
    });
  }
  if (
    Number(data.revenue?.total || 0) === 0 &&
    Number(data.revenue?.lifetime || 0) > 0 &&
    Number(data.revenue?.mrr || 0) > 0
  ) {
    insights.push({
      tone: 'neutral',
      text: `No payments in this period, but lifetime revenue is €${Number(data.revenue.lifetime).toFixed(2)} and MRR reflects ${data.subscriptions?.active || 0} active paid plan(s).`
    });
  } else if (Number(data.revenue?.total || 0) === 0 && Number(data.revenue?.mrr || 0) > 0) {
    insights.push({
      tone: 'neutral',
      text: 'MRR is an estimate from active plan prices — period revenue only counts successful payments in the selected window.'
    });
  }
  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      text: 'Dashboard metrics are stable for this period. Adjust the timeframe to explore trends.'
    });
  }
  return insights.slice(0, 6);
}

async function computeDashboard(periodKey) {
  const period = resolveOverviewPeriod(periodKey);
  const empty = {
    period: period.key,
    range: { from: period.from?.toISOString() || null, to: period.to.toISOString() },
    revenue: { total: 0, lifetime: 0, mrr: 0, growthPct: null, byPlan: [], timeline: [] },
    subscriptions: { active: 0, trial: 0, expired: 0, churnRate: 0, upgradeDowngradeRatio: 0 },
    users: { newUsers: 0, dau: 0, wau: 0, mau: 0, returningPct: null, countries: [], mostActive: [] },
    ai: {},
    storage: {},
    charts: { featureUsage: {}, userGrowth: [], plansDistribution: [], costVsRevenue: [] },
    live: {},
    conversion: {},
    insights: [],
    activity: [],
    topCustomers: []
  };

  if (!isBillingDbConfigured()) return empty;

  await ensureSubscriptionsSchema();
  const pool = getPool();
  const chartFrom = period.from || new Date(period.to.getTime() - 90 * 86400000);

  const [
    legacy,
    currentRev,
    lifetimeRev,
    prevRev,
    revenueByPlan,
    revenueTimeline,
    subscriptions,
    users,
    ai,
    storage,
    featureUsage,
    userGrowth,
    plansDistribution,
    costVsRevenue,
    live,
    conversion,
    topCustomers,
    activity
  ] = await Promise.all([
    getAdminOverviewDb(),
    queryRevenueMetrics(pool, period.from, period.to),
    queryLifetimeRevenue(pool),
    queryRevenueMetrics(pool, period.prevFrom, period.prevTo),
    queryRevenueByPlan(pool, period.from, period.to),
    queryRevenueTimeline(pool, chartFrom, period.to),
    querySubscriptions(pool),
    queryUserMetrics(pool, period.from, period.to),
    queryAiUsage(pool, period.from, period.to),
    queryStorage(pool, period.from, period.to),
    queryFeatureUsage(pool, period.from, period.to),
    queryUserGrowthTimeline(pool, chartFrom, period.to),
    queryPlansDistribution(pool),
    queryCostVsRevenueTimeline(pool, chartFrom, period.to),
    queryLiveMetrics(pool),
    queryConversion(pool, period.from, period.to),
    queryTopCustomers(pool, period.from, period.to),
    queryActivityFeed(pool, period.from, period.to)
  ]);

  const growthPct = pctChange(currentRev.revenue, prevRev.revenue);

  const dashboard = {
    period: period.key,
    range: { from: period.from?.toISOString() || null, to: period.to.toISOString() },
    legacy,
    revenue: {
      total: currentRev.revenue,
      lifetime: lifetimeRev,
      mrr: subscriptions.mrr,
      growthPct,
      byPlan: revenueByPlan,
      timeline: revenueTimeline,
      payments: currentRev.payments
    },
    subscriptions: {
      active: subscriptions.active,
      trial: subscriptions.trial,
      expired: subscriptions.expired,
      churnRate: subscriptions.churnRate,
      upgradeDowngradeRatio: subscriptions.upgradeDowngradeRatio
    },
    users,
    ai,
    storage,
    charts: {
      featureUsage,
      userGrowth,
      plansDistribution,
      costVsRevenue
    },
    live,
    conversion,
    topCustomers,
    activity,
    insights: []
  };
  dashboard.insights = buildInsights(dashboard);
  return dashboard;
}

export async function getAdminOverviewDashboardDb(periodKey = '30d') {
  const key = String(periodKey || '30d').toLowerCase();
  const hit = overviewCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = await computeDashboard(key);
  overviewCache.set(key, { at: Date.now(), data });
  return data;
}
