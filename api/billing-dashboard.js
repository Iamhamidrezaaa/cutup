/**
 * Centralized billing dashboard payload — subscription, usage, history, payment method.
 */
import Stripe from 'stripe';
import {
  ensureUserByEmail,
  getSubscriptionRowByEmail,
  getLegacyUsageShape,
  listInvoicesByEmail,
  isBillingDbConfigured
} from './billing-repository.js';
import { getPool } from './db/pool.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { PLAN_CREDITS, PLAN_LABELS } from './plans/permissions.js';

const SPECIAL_EMAIL = 'h.asgarizade@gmail.com';

function planPriceMeta(planKey) {
  const k = resolvePlanKey(planKey);
  const fromConfig = getPlanDef(k)?.priceEur?.monthly;
  const monthly = Number(fromConfig ?? 0);
  const display = monthly > 0 ? `€${monthly.toFixed(2)}` : '€0';
  const period = k === 'free' ? null : '/ month';
  return {
    amount: monthly,
    currency: 'EUR',
    display: period ? `${display} / month` : display,
    periodLabel: period ? 'month' : null
  };
}

export async function listBillingHistoryRows(email, limit = 50) {
  const rows = [];
  const seen = new Set();

  try {
    const invoices = await listInvoicesByEmail(email, limit);
    for (const inv of invoices) {
      const id = String(inv.id);
      seen.add(id);
      const planKey = resolvePlanKey(inv.plan_key || inv.plan || 'free');
      rows.push({
        id,
        date: inv.issued_at,
        amount: Number(inv.amount) || Number(inv.amount_eur) || 0,
        currency: String(inv.currency || 'EUR').toUpperCase(),
        plan: planKey,
        planName: PLAN_LABELS[planKey]?.name || planKey,
        status: String(inv.status || 'paid').toLowerCase(),
        invoiceNumber: inv.invoice_number || null,
        downloadUrl: inv.pdf_url || `/api/invoices/${id}`,
        source: 'invoice'
      });
    }
  } catch (e) {
    console.warn('[billing-dashboard] invoice list failed', e?.message);
  }

  try {
    const pool = getPool();
    const pay = await pool.query(
      `SELECT p.id, p.created_at, p.paid_at, p.status, p.plan_key, p.plan,
              COALESCE(p.amount_eur, p.amount, 0) AS amount_eur, p.currency
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE lower(u.email) = lower($1)
         AND p.status IN ('success', 'failed')
       ORDER BY COALESCE(p.paid_at, p.created_at) DESC
       LIMIT $2`,
      [email, limit]
    );
    for (const p of pay.rows) {
      const id = `payment-${p.id}`;
      if (seen.has(String(p.id))) continue;
      const planKey = resolvePlanKey(p.plan_key || p.plan || 'free');
      rows.push({
        id: String(p.id),
        date: p.paid_at || p.created_at,
        amount: Number(p.amount_eur) || 0,
        currency: String(p.currency || 'EUR').toUpperCase(),
        plan: planKey,
        planName: PLAN_LABELS[planKey]?.name || planKey,
        status: p.status === 'success' ? 'paid' : 'failed',
        invoiceNumber: null,
        downloadUrl: null,
        source: 'payment'
      });
    }
  } catch (e) {
    console.warn('[billing-dashboard] payments list failed', e?.message);
  }

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return rows.slice(0, limit);
}

export async function getLastPaymentFailure(email) {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT p.status, pa.error_message, p.updated_at
       FROM payments p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT error_message FROM payment_attempts
         WHERE payment_id = p.id ORDER BY attempt_number DESC LIMIT 1
       ) pa ON true
       WHERE lower(u.email) = lower($1) AND p.status = 'failed'
       ORDER BY p.updated_at DESC
       LIMIT 1`,
      [email]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

async function fetchStripeBillingExtras(subRow) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !subRow?.stripe_customer_id) {
    return {
      paymentMethod: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      subscriptionStatus: null
    };
  }
  try {
    const stripe = new Stripe(secret);
    let paymentMethod = null;
    let cancelAtPeriodEnd = false;
    let cancelAt = null;
    let subscriptionStatus = null;

    const customer = await stripe.customers.retrieve(subRow.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method']
    });
    const pm = customer.invoice_settings?.default_payment_method;
    if (pm && typeof pm === 'object' && pm.card) {
      paymentMethod = {
        brand: pm.card.brand || 'card',
        last4: pm.card.last4 || '****',
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
        display: `${String(pm.card.brand || 'Card').replace(/^./, (c) => c.toUpperCase())} ending in ${pm.card.last4}`
      };
    }

    if (subRow.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
      cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      subscriptionStatus = sub.status || null;
      if (sub.cancel_at) {
        cancelAt = new Date(sub.cancel_at * 1000).toISOString();
      } else if (cancelAtPeriodEnd && sub.current_period_end) {
        cancelAt = new Date(sub.current_period_end * 1000).toISOString();
      }
    }

    return { paymentMethod, cancelAtPeriodEnd, cancelAt, subscriptionStatus };
  } catch (e) {
    console.warn('[billing-dashboard] Stripe extras failed', e?.message);
    return {
      paymentMethod: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      subscriptionStatus: null
    };
  }
}

/** Safe empty shell — frontend can always render when API returns an error status. */
export function emptyBillingPayload(errorMessage, partial = {}) {
  const sub = partial.subscription || {};
  const usage = partial.usage || {};
  return {
    ok: false,
    error: errorMessage || 'Unable to load billing data',
    subscription: {
      plan: sub.plan || 'free',
      planName: sub.planName || 'Free',
      planTagline: sub.planTagline || null,
      price: sub.price || { amount: 0, currency: 'EUR', display: '€0', periodLabel: null },
      billingPeriod: sub.billingPeriod || 'monthly',
      status: sub.status || 'free',
      nextRenewalDate: sub.nextRenewalDate || null,
      currentPeriodStart: sub.currentPeriodStart || null,
      currentPeriodEnd: sub.currentPeriodEnd || null,
      cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
      cancelAt: sub.cancelAt || null,
      stripeCustomerId: sub.stripeCustomerId || null,
      stripeSubscriptionId: sub.stripeSubscriptionId || null
    },
    usage: {
      monthlyCredits: Number(usage.monthlyCredits) || 0,
      usedCredits: Number(usage.usedCredits) || 0,
      remainingCredits: Number(usage.remainingCredits) || 0
    },
    paymentMethod: partial.paymentMethod ?? null,
    billingHistory: Array.isArray(partial.billingHistory) ? partial.billingHistory : [],
    upcomingCharge: partial.upcomingCharge ?? null,
    paymentFailure: partial.paymentFailure ?? null,
    actions: partial.actions || {
      canOpenPortal: false,
      canRetryPayment: false,
      canUpgrade: true
    }
  };
}

export async function buildBillingDashboardPayload(email) {
  if (!isBillingDbConfigured()) {
    return { error: 'DATABASE_URL is not configured' };
  }

  await ensureUserByEmail(email);
  const subRow = email === SPECIAL_EMAIL
    ? {
        plan: 'business',
        status: 'active',
        billing_period: 'annual',
        current_period_end: new Date(Date.now() + 365 * 86400000),
        stripe_customer_id: null,
        stripe_subscription_id: null
      }
    : await getSubscriptionRowByEmail(email);

  const planKey = resolvePlanKey(subRow?.plan || 'free');
  const plan = getPlanDef(planKey);
  const usage = await getLegacyUsageShape(email);
  const creditLimit = plan?.monthlyGenerationLimit ?? plan?.monthlyLimit ?? PLAN_CREDITS[planKey] ?? 3;
  const usedCredits = Math.round(Number(usage.monthly?.minutes) || 0);
  const remainingCredits = Math.max(0, creditLimit - usedCredits);

  const stripeExtras = await fetchStripeBillingExtras(subRow);
  const status = stripeExtras.subscriptionStatus || subRow?.status || (planKey === 'free' ? 'free' : 'active');
  const billingHistory = await listBillingHistoryRows(email, 50);
  const lastFailure = await getLastPaymentFailure(email);

  const price = planPriceMeta(planKey);
  const nextRenewal = subRow?.current_period_end || subRow?.expires_at || null;

  const upcomingCharge =
    planKey !== 'free' && ['active', 'trialing'].includes(String(status).toLowerCase()) && price.amount > 0
      ? {
          amount: price.amount,
          currency: price.currency,
          display: price.display.replace(' / month', '').trim(),
          date: nextRenewal
        }
      : null;

  let paymentFailure = null;
  const st = String(status).toLowerCase();
  if (st === 'past_due' || st === 'unpaid') {
    paymentFailure = {
      status: st,
      reason: lastFailure?.error_message || 'Payment could not be processed',
      message: 'Your subscription may be interrupted.'
    };
  }

  return {
    subscription: {
      plan: planKey,
      planName: plan?.nameEn || plan?.name || PLAN_LABELS[planKey]?.name || planKey,
      planTagline: plan?.tagline || PLAN_LABELS[planKey]?.tagline || null,
      price,
      billingPeriod: subRow?.billing_period || 'monthly',
      status,
      nextRenewalDate: nextRenewal,
      currentPeriodStart: subRow?.current_period_start || subRow?.started_at || subRow?.created_at || null,
      currentPeriodEnd: nextRenewal,
      cancelAtPeriodEnd: stripeExtras.cancelAtPeriodEnd || false,
      cancelAt: stripeExtras.cancelAt,
      stripeCustomerId: subRow?.stripe_customer_id || null,
      stripeSubscriptionId: subRow?.stripe_subscription_id || null
    },
    usage: {
      monthlyCredits: creditLimit,
      usedCredits,
      remainingCredits
    },
    paymentMethod: stripeExtras.paymentMethod,
    billingHistory,
    upcomingCharge,
    paymentFailure,
    actions: {
      canOpenPortal: Boolean(subRow?.stripe_customer_id && process.env.STRIPE_SECRET_KEY),
      canRetryPayment: Boolean(lastFailure && st === 'past_due'),
      canUpgrade: planKey !== 'business'
    }
  };
}
