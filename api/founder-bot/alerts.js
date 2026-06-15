/**
 * Founder Bot — non-blocking founder alerts.
 */
import { queueTelegramMessage } from './telegram.js';
import { getUsersMetrics, getMrrMetrics, formatEur } from './metrics.js';
import { planLabel } from './commands.js';
import { getPool, isBillingDbConfigured } from '../db/pool.js';

const PLAN_RANK = { free: 0, starter: 1, pro: 2, business: 3 };

function displayName(payload = {}) {
  const parts = [payload.firstName, payload.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (payload.name) return String(payload.name);
  if (payload.displayName) return String(payload.displayName);
  if (payload.email) return String(payload.email).split('@')[0];
  return '—';
}

async function lookupCountry(userId, email) {
  if (!isBillingDbConfigured()) return '—';
  try {
    const pool = getPool();
    if (userId) {
      const r = await pool.query(
        `SELECT country FROM user_profiles WHERE user_id = $1::uuid LIMIT 1`,
        [userId]
      );
      const c = String(r.rows[0]?.country || '').trim();
      if (c) return c;
    }
    if (email) {
      const r = await pool.query(
        `SELECT up.country
         FROM user_profiles up
         JOIN users u ON u.id = up.user_id
         WHERE lower(u.email) = lower($1)
         LIMIT 1`,
        [email]
      );
      const c = String(r.rows[0]?.country || '').trim();
      if (c) return c;
    }
  } catch (_e) {
    /* noop */
  }
  return '—';
}

function planChangeType(fromPlan, toPlan) {
  const from = PLAN_RANK[String(fromPlan || 'free').toLowerCase()] ?? 0;
  const to = PLAN_RANK[String(toPlan || 'free').toLowerCase()] ?? 0;
  if (to > from) return 'upgrade';
  if (to < from) return 'downgrade';
  return 'change';
}

/**
 * New user registration (Google OAuth or admin-created).
 */
export async function onUserRegistered(payload = {}) {
  try {
    const [users, country] = await Promise.all([
      getUsersMetrics(),
      lookupCountry(payload.userId, payload.email)
    ]);
    const text = [
      '🎉 New User Registered',
      '',
      `Name: ${displayName(payload)}`,
      `Country: ${country}`,
      '',
      `Total Users: ${users.ok ? users.total : '—'}`
    ].join('\n');
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onUserRegistered', err?.message || err);
  }
}

/**
 * Successful payment (Stripe checkout, renewal, YekPay).
 */
export async function onPaymentSuccessful(payload = {}) {
  try {
    const plan = planLabel(payload.planName || payload.plan || payload.planKey);
    const amount =
      payload.amount != null && String(payload.amount).trim()
        ? String(payload.amount)
        : payload.amountEur != null
          ? formatEur(payload.amountEur)
          : '—';
    const mrr = await getMrrMetrics();
    const text = [
      '💰 New Sale',
      '',
      `Plan: ${plan}`,
      `Amount: ${amount}`,
      '',
      `MRR: ${mrr.ok ? formatEur(mrr.total) : '—'}`
    ].join('\n');
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onPaymentSuccessful', err?.message || err);
  }
}

/**
 * Subscription upgrade or downgrade.
 */
export async function onSubscriptionPlanChange(payload = {}) {
  try {
    const fromPlan = String(payload.fromPlan || 'free').toLowerCase();
    const toPlan = String(payload.toPlan || payload.planName || 'free').toLowerCase();
    const type = payload.changeType || planChangeType(fromPlan, toPlan);
    if (type === 'change') return;

    const emoji = type === 'upgrade' ? '⬆️' : '⬇️';
    const title = type === 'upgrade' ? 'Subscription Upgraded' : 'Subscription Downgraded';
    const mrr = await getMrrMetrics();
    const text = [
      `${emoji} ${title}`,
      '',
      `From: ${planLabel(fromPlan)}`,
      `To: ${planLabel(toPlan)}`,
      payload.email ? `User: ${payload.email}` : null,
      '',
      `MRR: ${mrr.ok ? formatEur(mrr.total) : '—'}`
    ]
      .filter((line) => line !== null)
      .join('\n');
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onSubscriptionPlanChange', err?.message || err);
  }
}

/**
 * Failed export / render job.
 */
export async function onExportFailed(payload = {}) {
  try {
    const text = [
      '⚠️ Export Failed',
      '',
      `Project: ${payload.projectName || payload.presetId || '—'}`,
      payload.email ? `User: ${payload.email}` : null,
      payload.jobId ? `Job: ${payload.jobId}` : null,
      payload.error ? `Error: ${String(payload.error).slice(0, 280)}` : null
    ]
      .filter((line) => line !== null)
      .join('\n');
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onExportFailed', err?.message || err);
  }
}

function notifyFounder(fn, payload) {
  void fn(payload).catch(() => {});
}

export function founderAlertUserRegistered(payload) {
  notifyFounder(onUserRegistered, payload);
}

export function founderAlertPaymentSuccessful(payload) {
  notifyFounder(onPaymentSuccessful, payload);
}

export function founderAlertSubscriptionPlanChange(payload) {
  notifyFounder(onSubscriptionPlanChange, payload);
}

export function founderAlertExportFailed(payload) {
  notifyFounder(onExportFailed, payload);
}
