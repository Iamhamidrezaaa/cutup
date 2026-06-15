/**
 * Founder Bot — admin-only slash commands.
 */
import { getFounderBotAdminChatId, queueTelegramMessage } from './telegram.js';
import {
  getUsersMetrics,
  getSalesMetrics,
  getMrrMetrics,
  getHealthMetrics,
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
  return [
    '🩺 Health',
    '',
    `API: ${status(m.api?.ok)} ${m.api?.label || '—'}`,
    `Database: ${status(m.database?.ok)} ${m.database?.label || '—'}`,
    `Stripe: ${status(m.stripe?.ok)} ${m.stripe?.label || '—'}`,
    `Disk: ${diskLine}`,
    `Memory: ${m.memory?.heapUsed || '—'} heap · ${m.memory?.rss || '—'} RSS`
  ].join('\n');
}

async function dispatchCommand(command) {
  switch (command) {
    case '/users':
      return formatUsers(await getUsersMetrics());
    case '/sales':
      return formatSales(await getSalesMetrics());
    case '/mrr':
      return formatMrr(await getMrrMetrics());
    case '/health':
      return formatHealth(await getHealthMetrics());
    case '/start':
    case '/help':
      return [
        'CutUp Founder Bot',
        '',
        '/users — signups',
        '/sales — revenue',
        '/mrr — recurring revenue',
        '/health — system status'
      ].join('\n');
    default:
      return null;
  }
}

export async function handleTelegramUpdate(update) {
  const message = update?.message;
  if (!message?.text) return;

  const chatId = message.chat?.id;
  if (!isAuthorizedChat(chatId)) {
    return;
  }

  const command = extractCommand(message.text);
  if (!command) return;

  const reply = await dispatchCommand(command);
  if (!reply) return;

  queueTelegramMessage(reply, { chatId });
}

export { planLabel };
