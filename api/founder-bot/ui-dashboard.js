import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { tableExists } from '../admin-db-safe.js';
import { getUsersMetrics, getRevenueMetrics, getMrrMetrics, formatEur, getConversionsMetrics } from './metrics.js';
import { getExportsMetrics } from './metrics-v12.js';
import { getTicketsMetrics } from './metrics-v13.js';

async function getFailedExportsToday() {
  if (!isBillingDbConfigured()) return 0;
  const pool = getPool();
  if (!(await tableExists(pool, 'project_exports'))) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM project_exports
     WHERE status = 'failed' AND updated_at >= $1::timestamptz`,
    [today.toISOString()]
  );
  return Number(r.rows[0]?.c || 0);
}

export async function buildDashboardText() {
  const [users, revenue, mrr, exports, tickets, failedExports] = await Promise.all([
    getUsersMetrics(),
    getRevenueMetrics(),
    getMrrMetrics(),
    getExportsMetrics(),
    getTicketsMetrics(),
    getFailedExportsToday()
  ]);

  const openTickets =
    tickets.ok ? Number(tickets.open || 0) + Number(tickets.waiting || 0) : '—';

  return [
    '📊 CutUp Dashboard',
    '',
    `Users Today: ${users.ok ? users.today : '—'}`,
    `Revenue Today: ${revenue.ok ? formatEur(revenue.today) : '—'}`,
    `MRR: ${mrr.ok ? formatEur(mrr.total) : '—'}`,
    `Exports Today: ${exports.ok ? exports.today : '—'}`,
    `Failed Exports: ${failedExports}`,
    `Open Tickets: ${openTickets}`
  ].join('\n');
}

export async function buildGrowthText() {
  const [users, conversions] = await Promise.all([getUsersMetrics(), getConversionsMetrics()]);
  if (!users.ok) return `⚠️ Growth\n\n${users.error || 'Unavailable'}`;
  const c = conversions.ok ? conversions.today : null;
  return [
    '📈 Growth',
    '',
    `New users today: ${users.today}`,
    `New users this week: ${users.week}`,
    `Total users: ${users.total}`,
    '',
    c
      ? `Paid users today: ${c.paidUsers}\nConversion rate today: ${c.conversionRate}%`
      : 'Conversion data: —'
  ].join('\n');
}

export function buildAboutText() {
  return [
    'ℹ About CutUp Founder Bot',
    '',
    'Telegram command center for CutUp metrics, operations, and support.',
    '',
    'Use the menu below or slash commands (/help).',
    'Versions: V1 · V1.1 · V1.2 · V1.3 · UI'
  ].join('\n');
}
