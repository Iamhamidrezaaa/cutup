/**
 * Payable invoices (pending payments) for Billing Activity — renewal, upgrade, expiry.
 */
import { getPool } from './db/pool.js';
import { getPlanDef, resolvePlanKey } from './plans-config.js';
import { PLAN_LABELS } from './plans/permissions.js';
import {
  ensureUserByEmail,
  insertPaymentPending,
  markPaymentTerminalStatus,
  getSubscriptionRowByEmail,
  getUserProfileApiPayload
} from './billing-repository.js';
import { emitSubscriptionExpired } from './email-events-bus.js';

const PAID_PLANS = new Set(['starter', 'pro', 'business']);
const RENEWAL_PROVIDER = 'renewal';

function frontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');
}

export function buildPayInvoiceDashboardUrl(paymentId) {
  const id = String(paymentId || '').trim();
  if (!id) return `${frontendBaseUrl()}/dashboard.html#billing`;
  return `${frontendBaseUrl()}/dashboard.html?payInvoice=${encodeURIComponent(id)}#billing`;
}

export function isSubscriptionPeriodExpired(subRow) {
  if (!subRow) return false;
  const planKey = resolvePlanKey(subRow.plan || 'free');
  if (planKey === 'free') return false;
  const end = subRow.current_period_end || subRow.expires_at;
  if (!end) return false;
  return new Date(end).getTime() < Date.now();
}

function planAmountEur(planKey) {
  const k = resolvePlanKey(planKey);
  const def = getPlanDef(k);
  return Number(def?.priceEur?.monthly ?? 0);
}

function mapPayableRow(row) {
  const planKey = resolvePlanKey(row.plan_key || row.plan || 'free');
  const amount = Number(row.final_amount_eur ?? row.amount_eur ?? row.amount ?? 0);
  return {
    id: String(row.id),
    createdAt: row.created_at,
    amount,
    currency: String(row.currency || 'EUR').toUpperCase(),
    plan: planKey,
    planName: PLAN_LABELS[planKey]?.name || planKey,
    provider: String(row.provider || ''),
    payUrl: buildPayInvoiceDashboardUrl(row.id),
    reason: row.provider === RENEWAL_PROVIDER ? 'renewal' : 'checkout'
  };
}

export async function listPayableInvoicesByEmail(email) {
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.id, p.created_at, p.amount, p.amount_eur, p.final_amount_eur, p.currency,
            p.plan_key, p.plan, p.provider
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE lower(u.email) = lower($1)
       AND p.status = 'pending'
     ORDER BY p.created_at DESC
     LIMIT 20`,
    [email]
  );
  return r.rows.map(mapPayableRow);
}

export async function getPendingPaymentForUserPlan(email, planKey) {
  const pk = resolvePlanKey(planKey);
  if (!PAID_PLANS.has(pk)) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT p.*
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE lower(u.email) = lower($1)
       AND p.status = 'pending'
       AND lower(COALESCE(NULLIF(TRIM(p.plan_key), ''), p.plan, '')) = lower($2)
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [email, pk]
  );
  return r.rows[0] || null;
}

/**
 * Create or reuse a pending payment row (payable invoice) without starting YekPay yet.
 */
export async function ensurePayableInvoice({ email, planKey, reason = 'checkout' }) {
  const em = String(email || '').trim().toLowerCase();
  const pk = resolvePlanKey(planKey);
  if (!em || !PAID_PLANS.has(pk)) {
    return { ok: false, error: 'invalid_plan' };
  }

  const existing = await getPendingPaymentForUserPlan(em, pk);
  if (existing) {
    return { ok: true, paymentId: String(existing.id), reused: true, payUrl: buildPayInvoiceDashboardUrl(existing.id) };
  }

  const amount = planAmountEur(pk);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }

  const provider = reason === 'renewal' ? RENEWAL_PROVIDER : 'yekpay';
  const paymentId = await insertPaymentPending({
    email: em,
    provider,
    amount,
    originalAmountEur: amount,
    discountAmountEur: 0,
    finalAmountEur: amount,
    currency: 'EUR',
    externalId: null,
    planKey: pk,
    discountCode: null,
    appliedOfferId: null
  });

  return {
    ok: true,
    paymentId: String(paymentId),
    reused: false,
    payUrl: buildPayInvoiceDashboardUrl(paymentId)
  };
}

export async function cancelPayableInvoice(email, paymentId) {
  const n = await markPaymentTerminalStatus(email, paymentId, 'canceled');
  return n > 0;
}

function expiryEmailKind(paymentId) {
  return `sub_exp:${String(paymentId).slice(0, 8)}`;
}

export async function wasExpiryEmailSentForPayment(paymentId) {
  const pool = getPool();
  const kind = expiryEmailKind(paymentId);
  const r = await pool.query(`SELECT 1 FROM conversion_email_log WHERE kind = $1 LIMIT 1`, [kind]);
  return r.rows.length > 0;
}

export async function logExpiryEmailSent(email, paymentId) {
  const em = String(email || '').trim().toLowerCase();
  const kind = expiryEmailKind(paymentId);
  if (!em) return;
  const pool = getPool();
  await pool.query(`INSERT INTO conversion_email_log (email, kind) VALUES ($1, $2)`, [em, kind]);
}

export async function findSubscriptionsJustExpired({ limit = 50 } = {}) {
  const pool = getPool();
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const r = await pool.query(
    `SELECT s.user_id, s.plan, s.status, s.current_period_end, s.expires_at, u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE lower(COALESCE(s.plan, 'free')) NOT IN ('free')
       AND COALESCE(s.current_period_end, s.expires_at) IS NOT NULL
       AND COALESCE(s.current_period_end, s.expires_at) < NOW()
       AND lower(COALESCE(s.status, 'active')) IN ('active', 'trialing', 'past_due')
     ORDER BY COALESCE(s.current_period_end, s.expires_at) ASC
     LIMIT $1`,
    [lim]
  );
  return r.rows;
}

export async function processExpiredSubscriptionRow(row) {
  const email = String(row.email || '').trim().toLowerCase();
  const planKey = resolvePlanKey(row.plan || 'free');
  if (!email || !PAID_PLANS.has(planKey)) {
    return { ok: false, reason: 'skip_plan' };
  }

  const invoice = await ensurePayableInvoice({ email, planKey, reason: 'renewal' });
  if (!invoice.ok) {
    return { ok: false, reason: invoice.error || 'invoice_failed' };
  }

  if (!(await wasExpiryEmailSentForPayment(invoice.paymentId))) {
    let firstName = 'there';
    try {
      const profile = await getUserProfileApiPayload(email);
      firstName = String(profile?.first_name || profile?.firstName || 'there').trim() || 'there';
    } catch (_e) {
      /* noop */
    }
    const planName = PLAN_LABELS[planKey]?.name || planKey;
    const payUrl = invoice.payUrl;
    const amount = planAmountEur(planKey);
    await emitSubscriptionExpired({
      email,
      firstName,
      planName,
      payUrl,
      amount: `€${amount.toFixed(2)}`,
      paymentId: invoice.paymentId
    });
    await logExpiryEmailSent(email, invoice.paymentId);
  }

  return { ok: true, paymentId: invoice.paymentId, email, planKey };
}

export async function processAllExpiredSubscriptions({ limit = 50 } = {}) {
  const rows = await findSubscriptionsJustExpired({ limit });
  const results = [];
  for (const row of rows) {
    try {
      results.push(await processExpiredSubscriptionRow(row));
    } catch (e) {
      console.error('[billing-payable] expiry process failed', row?.email, e?.message || e);
      results.push({ ok: false, email: row?.email, reason: 'error' });
    }
  }
  return results;
}

export function isRenewalProvider(provider) {
  return String(provider || '').toLowerCase() === RENEWAL_PROVIDER;
}

export { RENEWAL_PROVIDER };
