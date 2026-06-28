/**
 * Founder Bot — admin-only slash commands.
 */
import { getFounderBotAdminChatId, queueTelegramMessage } from './telegram.js';
import {
  getUsersMetrics,
  getSalesMetrics,
  getMrrMetrics,
  getHealthMetrics,
  getRevenueMetrics,
  getConversionsMetrics,
  getSubscriptionsMetrics,
  getTopCountriesMetrics,
  formatEur
} from './metrics.js';

const PLAN_LABELS = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business'
};

function planLabel(plan) {
  const k = String(plan || 'free').toLowerCase();
  return PLAN_LABELS[k] || k;
}

function isAuthorizedChat(chatId) {
  const admin = getFounderBotAdminChatId();
  if (!admin) return false;
  return String(chatId) === String(admin);
}

function extractCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const token = raw.split(/\s+/)[0].toLowerCase();
  const base = token.split('@')[0];
  return base || null;
}

function formatUsers(m) {
  if (!m.ok) return `⚠️ Users\n\n${m.error || 'Unavailable'}`;
  return [
    '👥 Users',
    '',
    `Today: ${m.today}`,
    `This week: ${m.week}`,
    `Total: ${m.total}`
  ].join('\n');
}

function formatSales(m) {
  if (!m.ok) return `⚠️ Sales\n\n${m.error || 'Unavailable'}`;
  return [
    '💰 Sales',
    '',
    `Today: ${m.salesToday} (${formatEur(m.revenueToday)})`,
    `This month: ${m.salesMonth} (${formatEur(m.revenueMonth)})`,
    `Revenue total: ${formatEur(m.revenueTotal)}`
  ].join('\n');
}

function formatMrr(m) {
  if (!m.ok) return `⚠️ MRR\n\n${m.error || 'Unavailable'}`;
  return [
    '📈 MRR',
    '',
    `Starter: ${formatEur(m.starter)}`,
    `Pro: ${formatEur(m.pro)}`,
    `Business: ${formatEur(m.business)}`,
    '',
    `Total: ${formatEur(m.total)}`
  ].join('\n');
}

function formatHealth(m) {
  if (!m.ok) return `⚠️ Health\n\nUnavailable`;
  const status = (ok) => (ok ? '✅' : '❌');
  const diskLine = m.disk?.ok
    ? `${m.disk.usedPct}% used · ${m.disk.freeGb} GB free`
    : m.disk?.label || 'Unavailable';
  const storageLines =
    m.storage?.ok
      ? [
          '',
          'Storage',
          `Used Space: ${m.storage.usedGb} GB`,
          `Free Space: ${m.storage.freeGb} GB`,
          `Disk Usage: ${m.storage.usedPct}%`,
          `Temporary Jobs: ${m.storage.temporaryJobsCount}`
        ]
      : m.storage?.temporaryJobsCount != null
        ? ['', 'Storage', `Temporary Jobs: ${m.storage.temporaryJobsCount}`, m.storage.label || 'Disk unavailable']
        : [];
  return [
    '🩺 Health',
    '',
    `API: ${status(m.api?.ok)} ${m.api?.label || '—'}`,
    `Database: ${status(m.database?.ok)} ${m.database?.label || '—'}`,
    `Stripe: ${status(m.stripe?.ok)} ${m.stripe?.label || '—'}`,
    `Disk: ${diskLine}`,
    ...storageLines,
    `Memory: ${m.memory?.heapUsed || '—'} heap · ${m.memory?.rss || '—'} RSS`
  ].join('\n');
}

function formatRevenue(m) {
  if (!m.ok) return `⚠️ Revenue\n\n${m.error || 'Unavailable'}`;
  return [
    '💰 Revenue',
    '',
    `Today: ${formatEur(m.today)}`,
    `This Week: ${formatEur(m.week)}`,
    `This Month: ${formatEur(m.month)}`,
    '',
    `Starter: ${formatEur(m.byPlan.starter)}`,
    `Pro: ${formatEur(m.byPlan.pro)}`,
    `Business: ${formatEur(m.byPlan.business)}`,
    '',
    `Lifetime: ${formatEur(m.lifetime)}`
  ].join('\n');
}

function formatConversionWindow(label, w) {
  return [
    label,
    `New users: ${w.newUsers}`,
    `Paid users: ${w.paidUsers}`,
    `Conversion: ${w.conversionRate}%`
  ].join('\n');
}

function formatConversions(m) {
  if (!m.ok) return `⚠️ Conversions\n\n${m.error || 'Unavailable'}`;
  return [
    '📊 Conversions',
    '',
    formatConversionWindow('Today', m.today),
    '',
    formatConversionWindow('Last 7 Days', m.last7d),
    '',
    formatConversionWindow('Last 30 Days', m.last30d)
  ].join('\n');
}

function formatSubscriptions(m) {
  if (!m.ok) return `⚠️ Subscriptions\n\n${m.error || 'Unavailable'}`;
  return [
    '📋 Subscriptions',
    '',
    `Active Starter: ${m.active.starter}`,
    `Active Pro: ${m.active.pro}`,
    `Active Business: ${m.active.business}`,
    '',
    `New Subscriptions Today: ${m.newToday}`,
    `Cancelled Today: ${m.cancelledToday}`,
    `Net Growth: ${m.netGrowth >= 0 ? '+' : ''}${m.netGrowth}`
  ].join('\n');
}

function formatCountryList(rows, valueFormatter = (v) => String(v)) {
  if (!rows?.length) return '—';
  return rows
    .map((r, i) => `${i + 1}. ${r.country} — ${valueFormatter(r.value)}`)
    .join('\n');
}

function formatTopCountries(m) {
  if (!m.ok) return `⚠️ Top Countries\n\n${m.error || 'Unavailable'}`;
  return [
    '🌍 Top Countries',
    '',
    'Registrations',
    formatCountryList(m.registrations),
    '',
    'Paid Users',
    formatCountryList(m.paidUsers),
    '',
    'Revenue',
    formatCountryList(m.revenue, (v) => formatEur(v))
  ].join('\n');
}

export async function dispatchCommand(command) {
  switch (command) {
    case '/users':
      return formatUsers(await getUsersMetrics());
    case '/sales':
      return formatSales(await getSalesMetrics());
    case '/mrr':
      return formatMrr(await getMrrMetrics());
    case '/health':
      return formatHealth(await getHealthMetrics());
    case '/revenue':
      return formatRevenue(await getRevenueMetrics());
    case '/conversions':
      return formatConversions(await getConversionsMetrics());
    case '/subscriptions':
      return formatSubscriptions(await getSubscriptionsMetrics());
    case '/topcountries':
      return formatTopCountries(await getTopCountriesMetrics());
    case '/help':
      return [
        'CutUp Founder Bot',
        '',
        '/users — signups',
        '/sales — revenue',
        '/mrr — recurring revenue',
        '/health — system status',
        '/revenue — revenue breakdown',
        '/conversions — signup → paid',
        '/subscriptions — active & churn',
        '/topcountries — geo leaderboard',
        '/dashboard — executive summary'
      ].join('\n');
    case '/start':
      return null;
    default:
      return null;
  }
}

export { planLabel };

export async function handleTelegramUpdate(update) {
  const { handleFounderBotUiUpdate } = await import('./ui-handler.js');
  return handleFounderBotUiUpdate(update);
}
