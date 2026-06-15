/**
 * Founder Bot — business metrics for /users /sales /mrr /health commands.
 */
import { statfsSync } from 'fs';
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { getPlanDef, resolvePlanKey } from '../plans-config.js';

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
  try {
    const path = process.platform === 'win32' ? process.cwd().slice(0, 3) : '/';
    const s = statfsSync(path);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    const used = total - free;
    const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return {
      ok: true,
      path,
      usedPct,
      freeGb: Math.round((free / 1024 / 1024 / 1024) * 10) / 10,
      totalGb: Math.round((total / 1024 / 1024 / 1024) * 10) / 10
    };
  } catch (err) {
    return { ok: false, label: err?.message || 'Unavailable' };
  }
}

export async function getHealthMetrics() {
  const db = await checkDatabaseHealth();
  const stripe = checkStripeHealth();
  const disk = getDiskUsage();
  const memory = getMemoryUsage();

  return {
    ok: true,
    api: { ok: true, label: 'Running' },
    database: db,
    stripe,
    disk,
    memory
  };
}

export { formatEur };
