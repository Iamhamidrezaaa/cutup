import Stripe from 'stripe';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { PLANS } from './plans-config.js';
import {
  isBillingDbConfigured,
  getSubscriptionRowByEmail,
  getUserProfileApiPayload,
  insertPaymentPending,
  updatePaymentExternalId,
  getPaymentForUserById,
  finalizePendingPaymentSuccess,
  markPaymentTerminalStatus,
  markPendingPaymentExpiredIfStale,
  resolveUserIdForAnalytics
} from './billing-repository.js';
import { getYekpayConfig, yekpayCreatePaymentRequest, yekpayVerifyPayment } from './yekpay.js';
import { recordServerAuditEvent } from './audit-internal.js';

const PAID_PLAN_KEYS = ['starter', 'pro', 'advanced', 'business'];
const STRIPE_PLAN_KEYS = ['starter', 'pro', 'advanced', 'business'];

function getFrontendBaseUrl() {
  const explicit = (process.env.FRONTEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (secret.startsWith('sk_test_')) {
    const port = process.env.PORT || '3001';
    return `http://localhost:${port}`;
  }
  return 'https://cutup.shop';
}

function resolveStripePriceId(priceKey) {
  const envMap = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    advanced: process.env.STRIPE_PRICE_ADVANCED,
    business: process.env.STRIPE_PRICE_ADVANCED
  };
  return envMap[priceKey] || null;
}

function normalizePaidPlanKey(raw) {
  const p = String(raw || 'pro').toLowerCase();
  if (PAID_PLAN_KEYS.includes(p)) return p;
  return 'pro';
}

function readJsonBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

function requireSessionUser(req, res) {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    res.status(401).json({ error: 'No session' });
    return null;
  }
  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    res.status(401).json({ error: 'Session expired' });
    return null;
  }
  return { sessionId, email: session.user.email };
}

function planKeyFromStripeMetadata(meta) {
  const p = String(meta || '').toLowerCase();
  if (STRIPE_PLAN_KEYS.includes(p)) return p;
  return 'pro';
}

async function auditPaymentSuccess(req, email, sessionId, planKey, source) {
  const userId = await resolveUserIdForAnalytics(email);
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_success',
    userId,
    sessionId,
    metadata: { plan: planKey, source: source || 'verify' },
    req
  });
}

function normalizeStripeId(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && ref.id) return ref.id;
  return null;
}

/** Marketing / attribution only — does not change charged price. */
function normalizeMarketingDiscount(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'hot20' ? 'hot20' : null;
}

export async function paymentCreateHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Billing database not configured' });
  }

  const auth = requireSessionUser(req, res);
  if (!auth) return;

  const body = readJsonBody(req);
  const planKey = normalizePaidPlanKey(body?.plan ?? body?.planKey ?? body?.priceKey);
  const provider = String(body?.provider || 'stripe').toLowerCase().slice(0, 64);
  const email = auth.email;
  const sessionId = auth.sessionId;
  const baseUrl = getFrontendBaseUrl();

  let profile;
  try {
    profile = await getUserProfileApiPayload(email);
  } catch (e) {
    console.error('[payment] profile load failed', e);
    return res.status(503).json({ error: 'profile_error' });
  }
  if (!profile || profile.incomplete) {
    return res.status(400).json({ error: 'profile_incomplete' });
  }

  const auditUserId = await resolveUserIdForAnalytics(email);
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_attempt',
    userId: auditUserId,
    sessionId,
    metadata: { plan: planKey },
    req
  });

  const planCfg = PLANS[planKey];
  const amount = planCfg?.priceEur?.monthly != null ? planCfg.priceEur.monthly : null;
  const discountCode = normalizeMarketingDiscount(body?.discount);

  if (provider === 'manual') {
    const paymentId = await insertPaymentPending({
      email,
      provider: 'manual',
      amount,
      currency: 'EUR',
      externalId: null,
      planKey,
      discountCode
    });
    const redirect_url = `${baseUrl}/payment-success.html?session=${encodeURIComponent(sessionId)}&payment=pending&payment_id=${encodeURIComponent(paymentId)}`;
    console.log('[payment] created', paymentId, email, 'manual');
    return res.status(200).json({
      ok: true,
      redirect_url,
      payment_url: redirect_url,
      payment_id: paymentId
    });
  }

  if (provider === 'yekpay') {
    const yk = getYekpayConfig();
    if (!yk.isConfigured) {
      console.log('[payment] yekpay failed', 'not configured');
      return res.status(503).json({ error: 'Payment provider not configured' });
    }
    if (amount == null || !Number.isFinite(Number(amount))) {
      return res.status(400).json({ error: 'Invalid plan amount' });
    }

    const paymentId = await insertPaymentPending({
      email,
      provider: 'yekpay',
      amount,
      currency: 'EUR',
      externalId: null,
      planKey,
      discountCode
    });

    const sep = yk.callbackUrl.includes('?') ? '&' : '?';
    const callbackUrl = `${yk.callbackUrl}${sep}payment_id=${encodeURIComponent(paymentId)}`;
    const description =
      `Cutup subscription: ${planKey}` + (discountCode ? ` (offer ${discountCode})` : '');

    const created = await yekpayCreatePaymentRequest({
      amount: Number(amount),
      currency: 'EUR',
      callbackUrl,
      description
    });

    if (!created.ok || !created.authority || !created.paymentUrl) {
      console.log('[payment] yekpay failed', 'create', created.error || 'bad_response');
      try {
        await markPaymentTerminalStatus(email, paymentId, 'failed');
      } catch (e) {
        console.error('[payment] yekpay failed markPaymentTerminalStatus', e);
      }
      return res.status(502).json({ error: 'Payment could not be started. Please try again later.' });
    }

    await updatePaymentExternalId(paymentId, email, created.authority);
    console.log('[payment] yekpay created', paymentId, email, created.authority);
    console.log('[payment] yekpay redirect', paymentId, created.paymentUrl);
    return res.status(200).json({
      ok: true,
      redirect_url: created.paymentUrl,
      payment_url: created.paymentUrl,
      payment_id: paymentId
    });
  }

  if (provider !== 'stripe') {
    return res.status(400).json({ error: 'Unsupported provider' });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('[payment] create STRIPE_SECRET_KEY missing');
    return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
  }

  const priceId = resolveStripePriceId(planKey);
  if (!priceId) {
    console.error('[payment] create missing Stripe price env for', planKey);
    return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
  }

  let existingStripeCustomerId = null;
  try {
    const row = await getSubscriptionRowByEmail(email);
    if (row?.stripe_customer_id) existingStripeCustomerId = row.stripe_customer_id;
  } catch (e) {
    console.error('[payment] create subscription load failed', e);
    return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
  }

  const paymentId = await insertPaymentPending({
    email,
    provider: 'stripe',
    amount,
    currency: 'EUR',
    externalId: null,
    planKey,
    discountCode
  });

  const stripe = new Stripe(secret);
  try {
    const q = (k, v) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    const success_url = `${baseUrl}/payment-success.html?${q('session', sessionId)}&${q('payment', 'success')}&${q('payment_id', String(paymentId))}&checkout_session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${baseUrl}/checkout.html?${q('plan', planKey)}&${q('session', sessionId)}&${q('payment', 'cancel')}&${q('payment_id', String(paymentId))}`;

    const sessionPayload = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      client_reference_id: sessionId,
      metadata: {
        userEmail: email,
        plan: planKey,
        cutupPaymentId: String(paymentId),
        cutupDiscount: discountCode || ''
      },
      subscription_data: {
        metadata: {
          userEmail: email,
          plan: planKey,
          cutupPaymentId: String(paymentId),
          cutupDiscount: discountCode || ''
        }
      }
    };

    if (existingStripeCustomerId) {
      sessionPayload.customer = existingStripeCustomerId;
    } else {
      sessionPayload.customer_email = email;
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionPayload);
    await updatePaymentExternalId(paymentId, email, checkoutSession.id);

    console.log('[payment] created', paymentId, email, 'stripe', checkoutSession.id);
    return res.status(200).json({
      ok: true,
      redirect_url: checkoutSession.url,
      payment_url: checkoutSession.url,
      payment_id: paymentId
    });
  } catch (err) {
    console.error('[payment] failed', 'create', err.message);
    try {
      await markPaymentTerminalStatus(email, paymentId, 'failed');
    } catch (e) {
      console.error('[payment] failed to mark payment failed', e);
    }
    return res.status(500).json({ error: 'Payment failed. Please try again.' });
  }
}

export async function paymentVerifyHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Billing database not configured' });
  }

  const auth = requireSessionUser(req, res);
  if (!auth) return;

  const body = readJsonBody(req);
  const paymentId = body?.payment_id || body?.paymentId;
  const providerReference = body?.provider_reference || body?.providerReference;
  const bodyProvider = body?.provider ? String(body.provider).toLowerCase() : null;

  if (!paymentId || !providerReference) {
    return res.status(400).json({ error: 'payment_id and provider_reference required' });
  }

  const email = auth.email;
  let payment = await getPaymentForUserById(paymentId, email);
  if (!payment) {
    console.log('[payment] failed', 'verify not_found', paymentId);
    return res.status(404).json({ error: 'Payment not found' });
  }

  if (payment.status === 'success') {
    console.log('[payment] verified', paymentId, email, 'idempotent');
    return res
      .status(200)
      .json({ status: 'success', success: true, idempotent: true });
  }

  if (payment.status === 'pending') {
    const expired = await markPendingPaymentExpiredIfStale(email, paymentId);
    if (expired) {
      return res.status(200).json({ success: false, status: 'expired' });
    }
  }

  payment = await getPaymentForUserById(paymentId, email);
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }
  if (payment.status === 'success') {
    console.log('[payment] verified', paymentId, email, 'idempotent');
    return res
      .status(200)
      .json({ status: 'success', success: true, idempotent: true });
  }
  if (payment.status !== 'pending') {
    console.log('[payment] failed', 'verify bad_state', payment.status, paymentId);
    return res.status(409).json({ status: payment.status, success: false, error: 'not_pending' });
  }

  const paymentProv = String(payment.provider).toLowerCase();
  if (bodyProvider != null && bodyProvider !== paymentProv) {
    console.log('[payment] failed', 'provider_mismatch', paymentId, bodyProvider, paymentProv);
    return res.status(403).json({ success: false, error: 'provider_mismatch' });
  }
  if (paymentProv === 'yekpay' && bodyProvider !== 'yekpay') {
    return res.status(400).json({ success: false, error: 'provider yekpay required in body' });
  }

  if (payment.provider === 'manual') {
    const secret = (process.env.CUTUP_MANUAL_PAYMENT_VERIFY_SECRET || '').trim();
    const fromDb = payment.plan_key ? String(payment.plan_key).toLowerCase() : '';
    const fromBody = String(body?.plan_key || body?.planKey || '').toLowerCase();
    const planKeyRaw = PAID_PLAN_KEYS.includes(fromDb) ? fromDb : fromBody;
    if (!secret || providerReference !== secret || !PAID_PLAN_KEYS.includes(planKeyRaw)) {
      console.log('[payment] failed', 'manual verify rejected', paymentId);
      return res.status(403).json({ error: 'manual_verify_rejected' });
    }
    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    const out = await finalizePendingPaymentSuccess(
      email,
      paymentId,
      planKeyRaw,
      null,
      null,
      end
    );
    if (!out.ok) {
      return res.status(409).json({ status: 'failed', error: out.error });
    }
    console.log('[payment] verified', paymentId, email, 'manual');
    if (!out.idempotent) {
      await auditPaymentSuccess(req, email, auth.sessionId, planKeyRaw, 'manual_verify');
    }
    return res.status(200).json({
      status: 'success',
      success: true,
      idempotent: Boolean(out.idempotent),
      plan: planKeyRaw
    });
  }

  if (payment.provider === 'yekpay') {
    const yk = getYekpayConfig();
    if (!yk.apiKey) {
      console.log('[payment] yekpay failed', 'not configured');
      return res.status(503).json({ error: 'Payment provider not configured', success: false });
    }

    const authStored = String(payment.external_id || '').trim();
    const authGiven = String(providerReference).trim();
    if (!authStored || authStored !== authGiven) {
      console.log('[payment] yekpay failed', 'authority_mismatch', paymentId);
      return res.status(403).json({ success: false, error: 'authority_mismatch' });
    }

    console.log('[payment] yekpay verify start', paymentId, email);
    const verified = await yekpayVerifyPayment(authGiven);

    if (!verified.ok) {
      console.log('[payment] yekpay failed', 'verify transport', verified.error);
      return res.status(502).json({ success: false, error: verified.error || 'verify_failed' });
    }

    if (!verified.success) {
      await markPaymentTerminalStatus(email, paymentId, 'failed');
      console.log('[payment] yekpay failed', 'verify declined', paymentId, verified.error);
      return res.status(200).json({ success: false, status: 'failed' });
    }

    if (verified.amount != null && payment.amount != null) {
      const a = Number(verified.amount);
      const b = Number(payment.amount);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 0.02) {
        console.warn('[payment] amount mismatch (using plan_key)', paymentId, a, b);
      }
    }

    const planKeyResolved = payment.plan_key ? String(payment.plan_key).toLowerCase() : '';
    if (!PAID_PLAN_KEYS.includes(planKeyResolved)) {
      await markPaymentTerminalStatus(email, paymentId, 'failed');
      console.log('[payment] yekpay failed', 'missing plan_key', paymentId);
      return res.status(200).json({ success: false, status: 'failed' });
    }

    const end = new Date();
    end.setMonth(end.getMonth() + 1);
    const out = await finalizePendingPaymentSuccess(
      email,
      paymentId,
      planKeyResolved,
      null,
      null,
      end
    );
    if (!out.ok) {
      console.log('[payment] yekpay failed', 'finalize', out.error, paymentId);
      return res.status(409).json({ success: false, status: out.error || 'failed' });
    }

    console.log('[payment] yekpay verified', paymentId, email);
    if (!out.idempotent) {
      await auditPaymentSuccess(req, email, auth.sessionId, planKeyResolved, 'yekpay_verify');
    }
    return res.status(200).json({
      success: true,
      status: 'success',
      idempotent: Boolean(out.idempotent),
      plan: planKeyResolved
    });
  }

  if (payment.provider !== 'stripe') {
    return res.status(400).json({ error: 'Unsupported provider' });
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const stripe = new Stripe(stripeSecret);
  let sess;
  try {
    sess = await stripe.checkout.sessions.retrieve(String(providerReference), {
      expand: ['subscription']
    });
  } catch (e) {
    console.log('[payment] failed', 'stripe retrieve', e.message);
    return res.status(400).json({ status: 'failed', error: 'invalid_provider_reference' });
  }

  const metaPid = sess.metadata?.cutupPaymentId ? String(sess.metadata.cutupPaymentId) : '';
  const metaEmail = String(sess.metadata?.userEmail || '').trim().toLowerCase();
  if (metaPid !== String(paymentId) || metaEmail !== email.trim().toLowerCase()) {
    console.log('[payment] failed', 'metadata mismatch', paymentId);
    return res.status(403).json({ status: 'failed', error: 'session_mismatch' });
  }

  if (sess.status === 'expired') {
    await markPaymentTerminalStatus(email, paymentId, 'failed');
    console.log('[payment] failed', 'session expired', paymentId);
    return res.status(200).json({ status: 'failed' });
  }

  if (sess.payment_status !== 'paid' || sess.mode !== 'subscription') {
    console.log('[payment] verified', paymentId, 'pending', sess.payment_status, sess.status);
    return res.status(200).json({ status: 'pending' });
  }

  const planKey = planKeyFromStripeMetadata(sess.metadata?.plan);
  let subId = normalizeStripeId(sess.subscription);
  let custId = normalizeStripeId(sess.customer);
  let periodEnd = null;
  if (subId) {
    const sub =
      typeof sess.subscription === 'object' && sess.subscription?.current_period_end
        ? sess.subscription
        : await stripe.subscriptions.retrieve(subId);
    periodEnd = new Date(sub.current_period_end * 1000);
    if (!custId) custId = normalizeStripeId(sub.customer);
  }
  if (!periodEnd) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    periodEnd = d;
  }

  const out = await finalizePendingPaymentSuccess(
    email,
    paymentId,
    planKey,
    custId,
    subId,
    periodEnd
  );
  if (!out.ok) {
    console.log('[payment] failed', 'finalize', out.error, paymentId);
    return res.status(409).json({ status: out.error || 'failed' });
  }

  console.log('[payment] verified', paymentId, email, 'stripe');
  if (!out.idempotent) {
    await auditPaymentSuccess(req, email, auth.sessionId, planKey, 'stripe_verify');
  }
  return res.status(200).json({
    status: 'success',
    success: true,
    idempotent: Boolean(out.idempotent),
    plan: planKey
  });
}
