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
  getPaymentByProviderExternalId,
  getUserIdByEmail,
  createPaymentAttempt,
  getMaxPaymentAttemptNumber,
  getLatestFailedPaymentByUser,
  markPaymentAttemptStatus,
  markPaymentSuccess,
  markPaymentFailed,
  upsertSubscriptionFromPayment,
  createInvoiceForPayment,
  listInvoicesByEmail,
  getInvoiceByIdForEmail,
  finalizePendingPaymentSuccess,
  markPaymentTerminalStatus,
  markPendingPaymentExpiredIfStale,
  resolveUserIdForAnalytics
} from './billing-repository.js';
import { getYekpayConfig, yekpayCreatePaymentRequest, yekpayVerifyPayment } from './yekpay.js';
import { recordServerAuditEvent } from './audit-internal.js';

const PAID_PLAN_KEYS = ['starter', 'pro', 'advanced', 'business'];

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


function normalizePaidPlanKey(raw) {
  const p = String(raw || 'pro').toLowerCase();
  if (PAID_PLAN_KEYS.includes(p)) return p;
  return 'pro';
}

function normalizeText(v, max) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.slice(0, max);
}

function normalizeAmountEur(raw, fallback) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const fb = Number(fallback);
  return Number.isFinite(fb) && fb > 0 ? fb : null;
}

function convertEurToIrr(eur) {
  const value = Number(eur);
  const rate = Number(process.env.YEKPAY_EUR_TO_IRR || 550000);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, rate, irr: null };
  const rateSafe = Number.isFinite(rate) && rate > 0 ? rate : 550000;
  const irr = Math.round(value * rateSafe);
  return { ok: true, rate: rateSafe, irr };
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


/** Marketing / attribution only — does not change charged price. */
function normalizeMarketingDiscount(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'hot20' ? 'hot20' : null;
}

async function processSuccessfulPayment({ payment, authority, verifyResult, req, sessionId = null }) {
  const planKeyResolved = String(payment.plan_key || payment.plan || 'pro').toLowerCase();
  if (!PAID_PLAN_KEYS.includes(planKeyResolved)) {
    return { ok: false, error: 'invalid_plan' };
  }
  const paid = await markPaymentSuccess(payment.id, {
    refId: verifyResult?.raw?.Result?.ReferenceNumber || verifyResult?.raw?.ReferenceNumber || null,
    amountIrr: verifyResult?.amount ?? null
  });
  if (!paid) return { ok: false, error: 'payment_not_found' };
  const userId = payment.user_id || (await getUserIdByEmail(payment.email));
  const sub = await upsertSubscriptionFromPayment({
    userId,
    planKey: planKeyResolved,
    paymentId: payment.id,
    autoRenew: true,
    durationDays: 30
  });
  const invoice = await createInvoiceForPayment({
    userId,
    paymentId: payment.id,
    amount: Number(payment.amount_eur || payment.amount || 0),
    currency: String(payment.currency || 'EUR')
  });
  const end = new Date(sub.expiresAt || Date.now());
  const out = await finalizePendingPaymentSuccess(
    payment.email,
    payment.id,
    planKeyResolved,
    null,
    null,
    end
  );
  if (!out.ok && !out.idempotent) return { ok: false, error: out.error || 'finalize_failed' };
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: sub.created ? 'subscription_created' : 'subscription_extended',
    userId,
    sessionId,
    metadata: { plan: planKeyResolved, paymentId: String(payment.id), authority },
    req
  });
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_success',
    userId,
    sessionId,
    metadata: { plan: planKeyResolved, paymentId: String(payment.id), authority, invoiceNumber: invoice?.invoice_number || null },
    req
  });
  return { ok: true, payment: paid, subscription: sub, invoice };
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
  const provider = 'yekpay';
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
  const planAmountEur = planCfg?.priceEur?.monthly != null ? planCfg.priceEur.monthly : null;
  const amount = normalizeAmountEur(body?.amount, planAmountEur);
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
    await createPaymentAttempt({
      paymentId,
      userId: auditUserId,
      attemptNumber: 1,
      status: 'pending'
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

  const yk = getYekpayConfig();
  if (provider === 'yekpay') {
    if (!yk.merchantId) {
      return res.status(500).json({
        ok: false,
        error: 'missing_merchant_id',
        details: { Message: 'YEKPAY_MERCHANT_ID is missing on server.' }
      });
    }

    const eur = Number(amount);
    if (!eur || eur <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount'
      });
    }
    const conv = convertEurToIrr(eur);
    if (!conv.ok || !conv.irr) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount'
      });
    }
    const amountIrr = conv.irr;
    const conversionRate = conv.rate;

    const paymentId = await insertPaymentPending({
      email,
      provider: 'yekpay',
      amount: eur,
      amountIrr,
      currency: 'EUR',
      externalId: null,
      planKey,
      discountCode
    });
    const callbackUrl = yk.callbackUrl;
    const profilePayload = {
      email: normalizeText(body?.email || profile?.email || email, 320),
      mobile: normalizeText(body?.mobile || body?.phone || profile?.phone, 64),
      firstName: normalizeText(body?.firstName || body?.first_name || profile?.first_name, 255),
      lastName: normalizeText(body?.lastName || body?.last_name || profile?.last_name, 255),
      address: normalizeText(body?.address || profile?.address, 1024),
      postalCode: normalizeText(body?.postalCode || body?.postal_code || profile?.postal_code, 64),
      country: normalizeText(body?.country || profile?.country, 8).toUpperCase()
    };
    if (!yk.merchantId || !amountIrr || !profilePayload.email) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required payment data'
      });
    }
    console.log('PAYMENT AMOUNT:', {
      eur,
      rate: conversionRate,
      irr: amountIrr
    });
    console.log('PAYMENT CREATE INPUT:', {
      plan: planKey,
      amount_eur: eur,
      amount_irr: amountIrr,
      email: profilePayload.email,
      mobile: profilePayload.mobile,
      merchantId: process.env.YEKPAY_MERCHANT_ID
    });
    const orderNumber = String(paymentId);

    const created = await yekpayCreatePaymentRequest({
      merchantId: yk.merchantId,
      fromCurrencyCode: 978,
      toCurrencyCode: 364,
      email: profilePayload.email,
      mobile: profilePayload.mobile,
      firstName: profilePayload.firstName,
      lastName: profilePayload.lastName,
      address: profilePayload.address,
      postalCode: profilePayload.postalCode,
      country: profilePayload.country || 'IR',
      city: 'N/A',
      description: `Cutup ${planKey} plan`,
      amount: amountIrr,
      orderNumber,
      callback: callbackUrl
    });
    console.log('YEKPAY RESPONSE:', created.raw || null);

    if (!created.ok || !created.authority || !created.paymentUrl) {
      console.log('[payment] yekpay failed', 'create', created.error || 'bad_response');
      try {
        await markPaymentTerminalStatus(email, paymentId, 'failed');
      } catch (e) {
        console.error('[payment] yekpay failed markPaymentTerminalStatus', e);
      }
      return res.status(500).json({
        ok: false,
        error: 'payment_failed',
        details: created.raw || { message: created.error || 'bad_response' }
      });
    }

    await updatePaymentExternalId(paymentId, email, created.authority);
    await markPaymentAttemptStatus(paymentId, 1, 'success');
    void recordServerAuditEvent({
      eventType: 'product',
      eventName: 'payment_redirected',
      userId: auditUserId,
      sessionId,
      metadata: { plan: planKey, provider: 'yekpay', paymentId: String(paymentId) },
      req
    });
    console.log('[payment] yekpay created', paymentId, email, created.authority);
    console.log('[payment] yekpay redirect', paymentId, created.paymentUrl);
    return res.status(200).json({
      ok: true,
      redirect_url: created.paymentUrl,
      payment_url: created.paymentUrl,
      payment_id: paymentId
    });
  }

  return res.status(400).json({ ok: false, error: 'Unsupported provider. yekpay only.' });
}

export async function paymentCallbackHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Billing database not configured' });
  }

  const body = readJsonBody(req);
  const authority = normalizeText(
    body?.authority ?? body?.Authority ?? req.query?.authority ?? req.query?.Authority,
    255
  );
  const successRaw = String(
    body?.success ?? body?.Success ?? req.query?.success ?? req.query?.Success ?? ''
  ).toLowerCase();
  const isSuccess = successRaw === '1' || successRaw === 'true' || successRaw === 'yes';

  if (!authority) {
    return res.redirect('/payment-failed.html');
  }

  const payment = await getPaymentByProviderExternalId('yekpay', authority);
  if (!payment?.id || !payment?.email) {
    return res.redirect('/payment-failed.html');
  }

  const sessionId = null;
  const userId = await resolveUserIdForAnalytics(payment.email);
  if (!isSuccess) {
    await markPaymentFailed(payment.id, 'gateway_callback_unsuccess');
    void recordServerAuditEvent({
      eventType: 'product',
      eventName: 'payment_failed',
      userId,
      sessionId,
      metadata: { plan: payment.plan_key || null, provider: 'yekpay', reason: 'gateway_callback_unsuccess' },
      req
    });
    return res.redirect('/payment-failed.html');
  }

  const verified = await yekpayVerifyPayment(authority);
  if (!verified.ok || !verified.success) {
    await markPaymentFailed(payment.id, verified.error || 'verify_failed');
    void recordServerAuditEvent({
      eventType: 'product',
      eventName: 'payment_failed',
      userId,
      sessionId,
      metadata: { plan: payment.plan_key || null, provider: 'yekpay', reason: verified.error || 'verify_failed' },
      req
    });
    return res.redirect('/payment-failed.html');
  }

  const out = await processSuccessfulPayment({
    payment,
    authority,
    verifyResult: verified,
    req,
    sessionId
  });
  if (!out.ok) {
    await markPaymentFailed(payment.id, out.error || 'finalize_failed');
    void recordServerAuditEvent({
      eventType: 'product',
      eventName: 'payment_failed',
      userId,
      sessionId,
      metadata: { plan: payment.plan_key || null, provider: 'yekpay', reason: out.error || 'finalize_failed' },
      req
    });
    return res.redirect('/payment-failed.html');
  }

  return res.redirect('/payment-success.html?status=success');
}

export async function paymentRetryHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isBillingDbConfigured()) return res.status(503).json({ error: 'Billing database not configured' });
  const auth = requireSessionUser(req, res);
  if (!auth) return;
  const failed = await getLatestFailedPaymentByUser(auth.email);
  if (!failed) return res.status(404).json({ error: 'No failed payment found' });
  const maxAttempt = await getMaxPaymentAttemptNumber(failed.id);
  if (maxAttempt >= 3) return res.status(429).json({ error: 'max_retries_reached' });
  const attemptNumber = maxAttempt + 1;
  await createPaymentAttempt({
    paymentId: failed.id,
    userId: failed.user_id,
    attemptNumber,
    status: 'pending'
  });
  const yk = getYekpayConfig();
  const amountEur = Number(failed.amount_eur || failed.amount || 0);
  const conv = convertEurToIrr(amountEur);
  const amountIrr = conv.ok && conv.irr ? conv.irr : Math.max(1, Math.round(amountEur * 550000));
  const created = await yekpayCreatePaymentRequest({
    merchantId: yk.merchantId,
    fromCurrencyCode: 978,
    toCurrencyCode: 364,
    email: auth.email,
    mobile: '',
    firstName: '',
    lastName: '',
    address: '',
    postalCode: '',
    country: 'IR',
    city: 'N/A',
    description: `Cutup ${failed.plan_key || failed.plan || 'pro'} plan`,
    amount: amountIrr,
    orderNumber: String(failed.id),
    callback: yk.callbackUrl
  });
  if (!created.ok || !created.authority || !created.paymentUrl) {
    await markPaymentAttemptStatus(failed.id, attemptNumber, 'failed', created.error || 'retry_create_failed');
    await markPaymentFailed(failed.id, created.error || 'retry_create_failed');
    return res.status(502).json({ error: 'retry_failed' });
  }
  await updatePaymentExternalId(failed.id, auth.email, created.authority);
  await markPaymentAttemptStatus(failed.id, attemptNumber, 'success');
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_retry',
    userId: failed.user_id,
    sessionId: auth.sessionId,
    metadata: { paymentId: String(failed.id), retryAttempt: attemptNumber, plan: failed.plan_key || failed.plan || null },
    req
  });
  return res.status(200).json({
    ok: true,
    payment_id: failed.id,
    retry_attempt: attemptNumber,
    redirect_url: created.paymentUrl
  });
}

export async function invoicesListHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = requireSessionUser(req, res);
  if (!auth) return;
  const rows = await listInvoicesByEmail(auth.email, Number(req.query?.limit || 100));
  return res.status(200).json({ ok: true, invoices: rows });
}

export async function invoiceByIdHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = requireSessionUser(req, res);
  if (!auth) return;
  const invoiceId = String(req.params?.id || req.query?.id || req.query?.[0] || '').trim();
  if (!invoiceId) return res.status(400).json({ error: 'invoice_id_required' });
  const row = await getInvoiceByIdForEmail(invoiceId, auth.email);
  if (!row) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json({ ok: true, invoice: row });
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
    if (!yk.isConfigured) {
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

    const out = await processSuccessfulPayment({
      payment: { ...payment, email },
      authority: authGiven,
      verifyResult: verified,
      req,
      sessionId: auth.sessionId
    });
    if (!out.ok) {
      console.log('[payment] yekpay failed', 'finalize', out.error, paymentId);
      return res.status(409).json({ success: false, status: out.error || 'failed' });
    }
    console.log('[payment] yekpay verified', paymentId, email);
    return res.status(200).json({
      success: true,
      status: 'success',
      idempotent: false,
      plan: planKeyResolved
    });
  }

  return res.status(400).json({ error: 'Unsupported provider. yekpay only.' });
}
