/**
 * Admin overview dashboard — aggregated analytics (PostgreSQL).
 * Keeps queries parallelized; 60s in-memory cache per period.
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { getAdminOverviewDb } from './billing-repository.js';
import { ensureAuditEventsTable } from './audit-repository.js';

const CACHE_TTL_MS = 60_000;
const OPENAI_EUR_PER_MINUTE = 0.0055;
const overviewCache = new Map();

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
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

async function queryRevenueMetrics(pool, from, to) {
  const params = [];
  const w = dateWhere('p.created_at', from, to, params);
  const r = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
       COUNT(*) FILTER (WHERE p.status = 'success')::int AS payments
     FROM payments p
     WHERE ${w}`,
    params
  );
  return {
    revenue: Number(r.rows[0]?.revenue || 0),
    payments: Number(r.rows[0]?.payments || 0)
  };
}

async function queryRevenueByPlan(pool, from, to) {
  const params = [];
  const w = dateWhere('p.created_at', from, to, params);
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(p.plan), ''), p.plan_key, 'free') AS plan,
            COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
            COUNT(*) FILTER (WHERE p.status = 'success')::int AS count
     FROM payments p
     WHERE ${w}
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
  const w = dateWhere('p.created_at', from, to, params);
  const r = await pool.query(
    `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue
     FROM payments p
     WHERE ${w}
     GROUP BY 1
     ORDER BY 1 ASC`,
    params
  );
  return r.rows.map((row) => ({ day: row.day, revenue: Number(row.revenue || 0) }));
}

function computeMrrFromSubscriptions(rows) {
  let mrr = 0;
  for (const row of rows) {
    const pk = resolvePlanKey(row.plan);
    if (!pk || pk === 'free') continue;
    if (String(row.status || '').toLowerCase() !== 'active') continue;
    const def = getPlanDef(pk);
    mrr += Number(def?.priceEur?.monthly || 0);
  }
  return Math.round(mrr * 100) / 100;
}

async function querySubscriptions(pool) {
  const r = await pool.query(
    `SELECT plan, status, COUNT(*)::int AS count
     FROM subscriptions
     GROUP BY plan, status`
  );
  const rows = r.rows || [];
  let active = 0;
  let trial = 0;
  let expired = 0;
  for (const row of rows) {
    const plan = resolvePlanKey(row.plan);
    const status = String(row.status || '').toLowerCase();
    const n = Number(row.count || 0);
    if (plan !== 'free' && status === 'active') active += n;
    if (status === 'trialing') trial += n;
    if (['canceled', 'cancelled', 'expired', 'past_due'].includes(status) && plan !== 'free') expired += n;
  }
  const activeRows = await pool.query(
    `SELECT plan, status FROM subscriptions WHERE COALESCE(plan, 'free') <> 'free'`
  );
  const mrr = computeMrrFromSubscriptions(activeRows.rows);
  const churnRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM subscriptions
     WHERE COALESCE(plan, 'free') <> 'free'
       AND (
         lower(status) IN ('canceled', 'cancelled', 'expired')
         OR (expires_at IS NOT NULL AND expires_at < NOW())
       )
       AND updated_at >= NOW() - INTERVAL '30 days'`
  );
  const upgradeRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(p.amount_eur, p.amount, 0) >= 15)::int AS upgrades,
       COUNT(*) FILTER (WHERE COALESCE(p.amount_eur, p.amount, 0) > 0 AND COALESCE(p.amount_eur, p.amount, 0) < 15)::int AS downgrades
     FROM payments p
     WHERE p.status = 'success' AND p.created_at >= NOW() - INTERVAL '90 days'`
  );
  const up = Number(upgradeRes.rows[0]?.upgrades || 0);
  const down = Number(upgradeRes.rows[0]?.downgrades || 0);
  return {
    active,
    trial,
    expired,
    mrr,
    churnRate: safeRate(Number(churnRes.rows[0]?.c || 0), Math.max(active + expired, 1)),
    upgradeDowngradeRatio: down > 0 ? Math.round((up / down) * 100) / 100 : up > 0 ? up : null
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
  const wLen = dateWhere('created_at', from, to, lenParams);
  const lenRes = await pool.query(
    `SELECT COALESCE(AVG(LENGTH(content)), 0)::float AS avg_len
     FROM saved_outputs
     WHERE ${wLen}`,
    lenParams
  );
  return {
    totalMinutes,
    estimatedCostEur: Math.round(totalMinutes * OPENAI_EUR_PER_MINUTE * 100) / 100,
    avgProcessingMinutes: Math.round(Number(row.avg_duration || 0) * 10) / 10,
    avgTranscriptLength: Math.round(Number(lenRes.rows[0]?.avg_len || 0)),
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
  const downloadsRes = await pool.query(
    `SELECT
       COALESCE(SUM(audio_downloads), 0)::int AS audio,
       COALESCE(SUM(video_downloads), 0)::int AS video
     FROM usage`
  );
  const sizeParams = [];
  const wSize = dateWhere('created_at', from, to, sizeParams);
  const sizeRes = await pool.query(
    `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0)::bigint AS bytes FROM saved_outputs WHERE ${wSize}`,
    sizeParams
  );
  return {
    savedTranscripts: Number(byType.transcript || byType.transcription || 0) + Number(byType.text || 0),
    summaries: Number(byType.summary || byType.summarization || 0),
    srtExports: Number(byType.srt || 0),
    docxExports: Number(byType.docx || 0),
    txtExports: Number(byType.txt || 0),
    totalSaved: countsRes.rows.reduce((s, r) => s + Number(r.count || 0), 0),
    audioDownloads: Number(downloadsRes.rows[0]?.audio || 0),
    videoDownloads: Number(downloadsRes.rows[0]?.video || 0),
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
    `SELECT COALESCE(plan, 'free') AS plan, COUNT(*)::int AS count
     FROM subscriptions
     GROUP BY 1
     ORDER BY count DESC`
  );
  return r.rows.map((row) => ({ plan: row.plan, count: Number(row.count || 0) }));
}

async function queryCostVsRevenueTimeline(pool, from, to) {
  const params = [];
  const w = dateWhere('p.created_at', from, to, params);
  const rev = await pool.query(
    `SELECT to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue
     FROM payments p WHERE ${w} GROUP BY 1 ORDER BY 1`,
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
  let failedJobs = 0;
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
    failedJobs = Number(err.rows[0]?.c || 0);
  } catch (_e) {
    /* audit optional */
  }
  const pendingPay = await pool.query(
    `SELECT COUNT(*)::int AS c FROM payments WHERE status IN ('pending', 'failed') AND created_at >= NOW() - INTERVAL '24 hours'`
  );
  const queueRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM payments WHERE status = 'pending'`
  );
  return {
    onlineUsers,
    activeJobsInQueue: Number(queueRes.rows[0]?.c || 0),
    failedJobs: failedJobs + Number(pendingPay.rows[0]?.c || 0),
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
  const wPay = dateWhere('p.created_at', from, to, params);
  const wUsage = dateWhere('uh.created_at', from, to, params);
  const r = await pool.query(
    `SELECT u.email,
            COALESCE(s.plan, 'free') AS plan,
            COALESCE(up.country, '') AS country,
            COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0)::numeric AS revenue,
            COALESCE(SUM(CASE WHEN uh.minutes > 0 THEN uh.minutes ELSE 0 END), 0)::float AS usage_minutes,
            GREATEST(u.created_at, MAX(uh.created_at)) AS last_active
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN payments p ON p.user_id = u.id AND p.status = 'success' AND ${wPay}
     LEFT JOIN usage_history uh ON uh.user_id = u.id AND ${wUsage}
     GROUP BY u.id, u.email, s.plan, up.country, u.created_at
     HAVING COALESCE(SUM(CASE WHEN p.status = 'success' THEN COALESCE(p.amount_eur, p.amount, 0) ELSE 0 END), 0) > 0
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
  const wPay = dateWhere('p.created_at', from, to, payParams);
  const pays = await pool.query(
    `SELECT u.email, p.status, p.plan, COALESCE(p.amount_eur, p.amount, 0) AS amount, p.created_at
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE ${wPay}
     ORDER BY p.created_at DESC LIMIT 12`,
    payParams
  );
  for (const row of pays.rows) {
    items.push({
      type: row.status === 'success' ? 'purchase' : row.status === 'failed' ? 'payment_failed' : 'payment',
      label: row.status === 'success' ? 'Purchase' : row.status === 'failed' ? 'Failed payment' : 'Payment',
      detail: `${row.email} · ${row.plan || '—'} · €${Number(row.amount || 0).toFixed(2)}`,
      at: row.created_at?.toISOString?.() || row.created_at
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
    revenue: { total: 0, mrr: 0, growthPct: null, byPlan: [], timeline: [] },
    subscriptions: { active: 0, trial: 0, expired: 0, churnRate: 0, upgradeDowngradeRatio: null },
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

  const pool = getPool();
  const chartFrom = period.from || new Date(period.to.getTime() - 90 * 86400000);

  const [
    legacy,
    currentRev,
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
