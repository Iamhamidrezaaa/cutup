/**
 * Founder Bot V1.4 — daily executive briefing metrics.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { tableExists } from '../admin-db-safe.js';
import {
  getMrrMetrics,
  getSubscriptionsMetrics,
  formatEur
} from './metrics.js';
import { getTicketsMetrics, getUrgentMetrics } from './metrics-v13.js';
import { getProvidersMetrics, getErrorsMetrics } from './metrics-v12.js';

const PAYMENT_DATE_EXPR = 'COALESCE(p.paid_at, p.created_at)';
const PAYMENT_AMOUNT_EXPR =
  'COALESCE(p.final_amount_eur, p.amount_eur, p.amount, 0)';

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function yesterdayUtcWindow() {
  const end = startOfUtcDay();
  const start = new Date(end.getTime() - 86400000);
  return { start, end };
}

async function getYesterdayRevenue(pool) {
  const { start, end } = yesterdayUtcWindow();
  const r = await pool.query(
    `SELECT COALESCE(SUM(${PAYMENT_AMOUNT_EXPR}), 0)::numeric AS amount
     FROM payments p
     WHERE p.status = 'success'
       AND ${PAYMENT_DATE_EXPR} >= $1::timestamptz
       AND ${PAYMENT_DATE_EXPR} < $2::timestamptz`,
    [start.toISOString(), end.toISOString()]
  );
  return Number(r.rows[0]?.amount || 0);
}

async function getYesterdayNewUsers(pool) {
  const { start, end } = yesterdayUtcWindow();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM users u
     WHERE u.created_at >= $1::timestamptz AND u.created_at < $2::timestamptz`,
    [start.toISOString(), end.toISOString()]
  );
  return Number(r.rows[0]?.c || 0);
}

async function getYesterdayExportCounts(pool) {
  if (!(await tableExists(pool, 'project_exports'))) {
    return { successful: 0, failed: 0 };
  }
  const { start, end } = yesterdayUtcWindow();
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE e.status = 'completed'
           AND COALESCE(e.completed_at, e.created_at) >= $1::timestamptz
           AND COALESCE(e.completed_at, e.created_at) < $2::timestamptz
       )::int AS successful,
       COUNT(*) FILTER (
         WHERE e.status = 'failed'
           AND e.updated_at >= $1::timestamptz
           AND e.updated_at < $2::timestamptz
       )::int AS failed
     FROM project_exports e`,
    [start.toISOString(), end.toISOString()]
  );
  const row = r.rows[0] || {};
  return {
    successful: Number(row.successful || 0),
    failed: Number(row.failed || 0)
  };
}

export function formatBriefingDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

const OPENAI_LATENCY_MS = 3000;

export function buildBriefingProblems({
  failedExportsYesterday,
  urgentCount,
  providers,
  errors
}) {
  const problems = [];

  const openai = providers?.ok
    ? providers.providers?.find((p) => p.name === 'OpenAI')
    : null;
  if (
    openai &&
    (openai.status === 'Degraded' ||
      (Number(openai.responseMs) || 0) >= OPENAI_LATENCY_MS)
  ) {
    problems.push('OpenAI latency high');
  }

  const failed = Number(failedExportsYesterday) || 0;
  if (failed > 0) {
    problems.push(`${failed} failed export${failed === 1 ? '' : 's'}`);
  }

  const urgent = Number(urgentCount) || 0;
  if (urgent > 0) {
    problems.push(`${urgent} urgent ticket${urgent === 1 ? '' : 's'}`);
  }

  if (hasStripeWebhookErrors(errors)) {
    problems.push('Stripe webhook errors');
  }

  return problems;
}

function hasStripeWebhookErrors(errors) {
  if (!errors?.ok) return false;
  const hay = (errors.top || []).some((item) => {
    const msg = `${item.message || ''} ${item.category || ''}`.toLowerCase();
    return /stripe/.test(msg) && /webhook|signature|handler/.test(msg);
  });
  if (hay) return true;
  const billing = errors.buckets?.Billing || [];
  return billing.some((item) => /stripe/.test(String(item.message || '').toLowerCase()));
}

export async function getBriefingMetrics() {
  const [mrr, subscriptions, tickets, urgent, providers, errors] = await Promise.all([
    getMrrMetrics(),
    getSubscriptionsMetrics(),
    getTicketsMetrics(),
    getUrgentMetrics(),
    getProvidersMetrics(),
    getErrorsMetrics()
  ]);

  if (!isBillingDbConfigured()) {
    return {
      ok: false,
      error: 'database_not_configured',
      mrr,
      subscriptions,
      tickets,
      urgent,
      providers,
      errors
    };
  }

  const pool = getPool();
  const [revenueYesterday, newUsersYesterday, exportsYesterday] = await Promise.all([
    getYesterdayRevenue(pool),
    getYesterdayNewUsers(pool),
    getYesterdayExportCounts(pool)
  ]);

  const openTickets = tickets.ok
    ? Number(tickets.open || 0) + Number(tickets.waiting || 0)
    : null;

  const active = subscriptions.ok
    ? subscriptions.active
    : { starter: null, pro: null, business: null };

  const urgentCount = urgent.ok ? (urgent.urgent?.length || 0) : 0;

  const problems = buildBriefingProblems({
    failedExportsYesterday: exportsYesterday.failed,
    urgentCount,
    providers,
    errors
  });

  return {
    ok: true,
    dateLabel: formatBriefingDate(),
    revenueYesterday,
    newUsersYesterday,
    successfulExportsYesterday: exportsYesterday.successful,
    failedExportsYesterday: exportsYesterday.failed,
    openTickets,
    activeSubscriptions: active,
    mrr: mrr.ok ? mrr.total : null,
    problems
  };
}

export async function buildBriefingText() {
  const m = await getBriefingMetrics();
  if (!m.ok) {
    return `⚠️ Daily Briefing\n\n${m.error || 'Unavailable'}`;
  }

  const problemsBlock =
    m.problems.length > 0
      ? m.problems.map((p) => `• ${p}`).join('\n')
      : '✅ No critical issues detected';

  return [
    '📈 CutUp Daily Briefing',
    '',
    'Date:',
    m.dateLabel,
    '',
    '💰 Yesterday Revenue',
    formatEur(m.revenueYesterday),
    '',
    '👥 New Users',
    String(m.newUsersYesterday),
    '',
    '🎬 Successful Exports',
    String(m.successfulExportsYesterday),
    '',
    '🚨 Failed Exports',
    String(m.failedExportsYesterday),
    '',
    '🎫 Open Tickets',
    m.openTickets != null ? String(m.openTickets) : '—',
    '',
    '📊 Active Subscriptions',
    '',
    `Starter: ${m.activeSubscriptions.starter ?? '—'}`,
    `Pro: ${m.activeSubscriptions.pro ?? '—'}`,
    `Business: ${m.activeSubscriptions.business ?? '—'}`,
    '',
    '💵 Current MRR',
    m.mrr != null ? formatEur(m.mrr) : '—',
    '',
    '⚠ Problems',
    '',
    problemsBlock
  ].join('\n');
}
