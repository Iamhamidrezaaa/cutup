/**
 * Founder Bot — business metrics for /users /sales /mrr /health commands.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { getPlanDef, resolvePlanKey } from '../plans-config.js';
import { getDiskUsageForPath } from '../infrastructure/disk-usage.js';
import { CUTUP_STORAGE_ROOT, getStorageLifecycleSnapshot } from '../infrastructure/storage-lifecycle.js';

const PAYMENT_DATE_EXPR = 'COALESCE(p.paid_at, p.created_at)';
const PAYMENT_AMOUNT_EXPR =
  'COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0)';
const SUB_PERIOD_END_EXPR = 'COALESCE(s.current_period_end, s.expires_at)';

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function formatEur(amount) {
  const n = Number(amount) || 0;
  return `€${n.toFixed(2)}`;
}

function computeMrrFromRows(rows) {
  const byPlan = { starter: 0, pro: 0, business: 0 };
  let total = 0;
  const now = Date.now();

  for (const row of rows) {
    const pk = resolvePlanKey(row.plan);
    if (!pk || pk === 'free') continue;
    if (String(row.status || '').toLowerCase() !== 'active') continue;
    const periodEnd = row.current_period_end || row.expires_at;
    if (periodEnd && new Date(periodEnd).getTime() <= now) continue;
    const monthly = Number(getPlanDef(pk)?.priceEur?.monthly || 0);
    if (pk in byPlan) byPlan[pk] += monthly;
    total += monthly;
  }

  return {
    starter: Math.round(byPlan.starter * 100) / 100,
    pro: Math.round(byPlan.pro * 100) / 100,
    business: Math.round(byPlan.business * 100) / 100,
    total: Math.round(total * 100) / 100
  };
}

export async function getUsersMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const today = startOfUtcDay();
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const r = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE u.created_at >= $1::timestamptz)::int AS today,
       COUNT(*) FILTER (WHERE u.created_at >= $2::timestamptz)::int AS week
     FROM users u`,
    [today.toISOString(), weekAgo.toISOString()]
  );
  const row = r.rows[0] || {};
  return {
    ok: true,
    today: Number(row.today || 0),
    week: Number(row.week || 0),
    total: Number(row.total || 0)
  };
}

export async function getSalesMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const today = startOfUtcDay();
  const monthStart = startOfUtcMonth();

  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE p.status = 'success' AND ${PAYMENT_DATE_EXPR} >= $1::timestamptz
       )::int AS sales_today,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (
         WHERE p.status = 'success' AND ${PAYMENT_DATE_EXPR} >= $1::timestamptz
       ), 0)::numeric AS revenue_today,
       COUNT(*) FILTER (
         WHERE p.status = 'success' AND ${PAYMENT_DATE_EXPR} >= $2::timestamptz
       )::int AS sales_month,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (
         WHERE p.status = 'success' AND ${PAYMENT_DATE_EXPR} >= $2::timestamptz
       ), 0)::numeric AS revenue_month,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (WHERE p.status = 'success'), 0)::numeric AS revenue_total
     FROM payments p`,
    [today.toISOString(), monthStart.toISOString()]
  );
  const row = r.rows[0] || {};
  return {
    ok: true,
    salesToday: Number(row.sales_today || 0),
    revenueToday: Number(row.revenue_today || 0),
    salesMonth: Number(row.sales_month || 0),
    revenueMonth: Number(row.revenue_month || 0),
    revenueTotal: Number(row.revenue_total || 0)
  };
}

export async function getMrrMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.plan, s.status, s.current_period_end, s.expires_at
     FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') <> 'free'
       AND lower(COALESCE(s.status, '')) = 'active'
       AND (${SUB_PERIOD_END_EXPR} IS NULL OR ${SUB_PERIOD_END_EXPR} > NOW())`
  );
  const mrr = computeMrrFromRows(r.rows);
  return { ok: true, ...mrr };
}

async function checkDatabaseHealth() {
  if (!isBillingDbConfigured()) {
    return { ok: false, label: 'Not configured' };
  }
  try {
    await getPool().query('SELECT 1');
    return { ok: true, label: 'Connected' };
  } catch (err) {
    return { ok: false, label: err?.message || 'Error' };
  }
}

function checkStripeHealth() {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return { ok: false, label: 'Not configured' };
  return { ok: true, label: 'Configured' };
}

function getMemoryUsage() {
  const m = process.memoryUsage();
  const mb = (n) => `${Math.round((Number(n) / 1024 / 1024) * 10) / 10} MB`;
  return {
    rss: mb(m.rss),
    heapUsed: mb(m.heapUsed),
    heapTotal: mb(m.heapTotal)
  };
}

function getDiskUsage() {
  return getDiskUsageForPath(process.platform === 'win32' ? process.cwd() : '/');
}

function getStorageMetrics() {
  try {
    const snapshot = getStorageLifecycleSnapshot();
    const disk = getDiskUsageForPath(CUTUP_STORAGE_ROOT);
    if (!disk.ok) {
      return { ok: false, label: disk.label || 'Unavailable', temporaryJobsCount: snapshot.jobCount || 0 };
    }
    return {
      ok: true,
      usedGb: disk.usedGb,
      freeGb: disk.freeGb,
      usedPct: disk.usedPct,
      totalGb: disk.totalGb,
      temporaryJobsCount: snapshot.jobCount || 0
    };
  } catch (err) {
    return { ok: false, label: err?.message || 'Unavailable', temporaryJobsCount: 0 };
  }
}

export async function getHealthMetrics() {
  const db = await checkDatabaseHealth();
  const stripe = checkStripeHealth();
  const disk = getDiskUsage();
  const storage = getStorageMetrics();
  const memory = getMemoryUsage();

  return {
    ok: true,
    api: { ok: true, label: 'Running' },
    database: db,
    stripe,
    disk,
    storage,
    memory
  };
}

export { formatEur };

// ——— V1.1 metrics ———

const PLAN_KEY_EXPR =
  `lower(COALESCE(NULLIF(TRIM(p.plan_key), ''), NULLIF(TRIM(p.plan), ''), 'free'))`;

function conversionRatePercent(paid, registered) {
  const p = Number(paid) || 0;
  const r = Number(registered) || 0;
  if (r <= 0) return 0;
  return Math.round((p / r) * 1000) / 10;
}

function sumPlanRevenue(rows) {
  const totals = { starter: 0, pro: 0, business: 0 };
  for (const row of rows) {
    const pk = resolvePlanKey(row.plan);
    if (pk in totals) totals[pk] += Number(row.revenue || 0);
  }
  return {
    starter: Math.round(totals.starter * 100) / 100,
    pro: Math.round(totals.pro * 100) / 100,
    business: Math.round(totals.business * 100) / 100
  };
}

async function queryConversionWindow(pool, since) {
  const r = await pool.query(
    `WITH since_ts AS (SELECT $1::timestamptz AS since)
     SELECT
       (SELECT COUNT(*)::int FROM users u, since_ts s WHERE u.created_at >= s.since) AS new_users,
       (SELECT COUNT(*)::int
        FROM users u, since_ts s
        WHERE u.created_at >= s.since
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.user_id = u.id
              AND p.status = 'success'
              AND ${PAYMENT_DATE_EXPR} >= s.since
          )) AS paid_users`,
    [since.toISOString()]
  );
  const row = r.rows[0] || {};
  const newUsers = Number(row.new_users || 0);
  const paidUsers = Number(row.paid_users || 0);
  return {
    newUsers,
    paidUsers,
    conversionRate: conversionRatePercent(paidUsers, newUsers)
  };
}

export async function getRevenueMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const today = startOfUtcDay();
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const monthStart = startOfUtcMonth();

  const totalsRes = await pool.query(
    `SELECT
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (
         WHERE ${PAYMENT_DATE_EXPR} >= $1::timestamptz
       ), 0)::numeric AS today,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (
         WHERE ${PAYMENT_DATE_EXPR} >= $2::timestamptz
       ), 0)::numeric AS week,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}) FILTER (
         WHERE ${PAYMENT_DATE_EXPR} >= $3::timestamptz
       ), 0)::numeric AS month,
       COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS lifetime
     FROM payments p
     WHERE p.status = 'success'`,
    [today.toISOString(), weekAgo.toISOString(), monthStart.toISOString()]
  );

  const byPlanRes = await pool.query(
    `SELECT ${PLAN_KEY_EXPR} AS plan,
            COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue
     FROM payments p
     WHERE p.status = 'success'
     GROUP BY 1`
  );

  const t = totalsRes.rows[0] || {};
  const byPlan = sumPlanRevenue(byPlanRes.rows);

  return {
    ok: true,
    today: Number(t.today || 0),
    week: Number(t.week || 0),
    month: Number(t.month || 0),
    lifetime: Number(t.lifetime || 0),
    byPlan
  };
}

export async function getConversionsMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const today = startOfUtcDay();
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const monthAgo = new Date(Date.now() - 30 * 86400000);

  const [todayWin, weekWin, monthWin] = await Promise.all([
    queryConversionWindow(pool, today),
    queryConversionWindow(pool, weekAgo),
    queryConversionWindow(pool, monthAgo)
  ]);

  return { ok: true, today: todayWin, last7d: weekWin, last30d: monthWin };
}

export async function getSubscriptionsMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const today = startOfUtcDay();

  const activeRes = await pool.query(
    `SELECT lower(COALESCE(s.plan, 'free')) AS plan, COUNT(*)::int AS count
     FROM subscriptions s
     WHERE COALESCE(s.plan, 'free') <> 'free'
       AND lower(COALESCE(s.status, '')) = 'active'
       AND (${SUB_PERIOD_END_EXPR} IS NULL OR ${SUB_PERIOD_END_EXPR} > NOW())
     GROUP BY 1`
  );

  const active = { starter: 0, pro: 0, business: 0 };
  for (const row of activeRes.rows) {
    const pk = resolvePlanKey(row.plan);
    if (pk in active) active[pk] += Number(row.count || 0);
  }

  const newRes = await pool.query(
    `SELECT COUNT(DISTINCT fp.user_id)::int AS count
     FROM (
       SELECT user_id, MIN(${PAYMENT_DATE_EXPR}) AS first_paid
       FROM payments
       WHERE status = 'success'
       GROUP BY user_id
     ) fp
     WHERE fp.first_paid >= $1::timestamptz`,
    [today.toISOString()]
  );

  const cancelledRes = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM subscriptions s
     WHERE s.updated_at >= $1::timestamptz
       AND lower(COALESCE(s.status, '')) IN ('canceled', 'cancelled', 'expired')`,
    [today.toISOString()]
  );

  const newToday = Number(newRes.rows[0]?.count || 0);
  const cancelledToday = Number(cancelledRes.rows[0]?.count || 0);

  return {
    ok: true,
    active,
    newToday,
    cancelledToday,
    netGrowth: newToday - cancelledToday
  };
}

export async function getTopCountriesMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const countryExpr = `COALESCE(NULLIF(TRIM(up.country), ''), '—')`;

  const [registrations, paidUsers, revenue] = await Promise.all([
    pool.query(
      `SELECT ${countryExpr} AS country, COUNT(*)::int AS count
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       GROUP BY 1
       ORDER BY count DESC, country ASC
       LIMIT 10`
    ),
    pool.query(
      `SELECT ${countryExpr} AS country, COUNT(DISTINCT u.id)::int AS count
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE EXISTS (
         SELECT 1 FROM payments p
         WHERE p.user_id = u.id AND p.status = 'success'
       )
       GROUP BY 1
       ORDER BY count DESC, country ASC
       LIMIT 10`
    ),
    pool.query(
      `SELECT ${countryExpr} AS country,
              COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS revenue
       FROM payments p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE p.status = 'success'
       GROUP BY 1
       ORDER BY revenue DESC, country ASC
       LIMIT 10`
    )
  ]);

  const mapRows = (rows, valueKey = 'count') =>
    rows.map((r) => ({
      country: r.country || '—',
      value: Number(r[valueKey] || 0)
    }));

  return {
    ok: true,
    registrations: mapRows(registrations.rows),
    paidUsers: mapRows(paidUsers.rows),
    revenue: mapRows(revenue.rows, 'revenue')
  };
}

