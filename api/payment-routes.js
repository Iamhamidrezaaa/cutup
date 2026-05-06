import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getPlanDef } from './plans-config.js';
import {
  isBillingDbConfigured,
  getUserProfileApiPayload,
  insertPaymentPending,
  updatePaymentExternalId,
  getPaymentForUserById,
  getPaymentByProviderExternalId,
  getPaymentByProviderOrderId,
  preparePaymentYekpayRetry,
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
  resolveUserIdForAnalytics,
} from './billing-repository.js';
import {
  getYekpayConfig,
  yekpayCreatePaymentRequest,
  yekpayVerifyPayment,
  yekpayCurrencyPair,
  yekpayAmountSemantics,
  attachYekpayOrderIdentifiers
} from './yekpay.js';
import { recordServerAuditEvent } from './audit-internal.js';
import { redeemOfferAtomic, validateOfferForCheckout } from './offers-repository.js';
import { generateUniqueOrderId } from './payment-order-id.js';
import { ensurePaymentAttemptsSchema } from './payment-attempts-bootstrap.js';

const PAID_PLAN_KEYS = ['starter', 'pro', 'business'];

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

function paymentFrontendRedirect(res, pathWithLeadingSlash) {
  const base = getFrontendBaseUrl().replace(/\/$/, '');
  const p = pathWithLeadingSlash.startsWith('/') ? pathWithLeadingSlash : `/${pathWithLeadingSlash}`;
  return res.redirect(302, `${base}${p}`);
}

/** Server-side only: legacy rows with pre-set IRR (978→364). */
function validateYekpayIrrAgainstPayment(paymentRow, verifiedAmountIrr) {
  const expected = Math.round(Number(paymentRow.amount_irr));
  if (!Number.isFinite(expected) || expected <= 0) {
    return { ok: true, skipped: true };
  }
  if (verifiedAmountIrr == null || !Number.isFinite(Number(verifiedAmountIrr))) {
    return { ok: false, error: 'missing_verified_amount' };
  }
  const actual = Math.round(Number(verifiedAmountIrr));
  const tolerance = Math.max(2, Math.ceil(expected * 0.001));
  if (Math.abs(expected - actual) > tolerance) {
    return { ok: false, error: 'amount_mismatch', expected, actual, tolerance };
  }
  return { ok: true, mode: 'irr' };
}

/**
 * Interpret YekPay verify `amount` for EUR-only (978→978): major units vs cents.
 * @returns {{ ok: boolean, mode?: string, settledEur?: number, storeAmountIrr?: number|null, error?: string }}
 */
function interpretYekpayVerifiedAmount(paymentRow, verifiedAmount) {
  const expectedEur = Number(
    paymentRow.final_amount_eur ?? paymentRow.amount_eur ?? paymentRow.amount ?? 0
  );
  if (!Number.isFinite(expectedEur) || expectedEur <= 0) {
    return { ok: false, error: 'invalid_expected_eur' };
  }
  if (verifiedAmount == null || !Number.isFinite(Number(verifiedAmount))) {
    return { ok: false, error: 'missing_verified_amount' };
  }
  const raw = Number(verifiedAmount);
  const tolerance = Math.max(0.02, expectedEur * 0.01);
  const asMajor = raw;
  const asFromCents = raw / 100;
  if (Math.abs(asMajor - expectedEur) <= tolerance) {
    return {
      ok: true,
      mode: 'eur_major',
      settledEur: Math.round(asMajor * 100) / 100,
      storeAmountIrr: null
    };
  }
  if (Math.abs(asFromCents - expectedEur) <= tolerance) {
    return {
      ok: true,
      mode: 'eur_cents',
      settledEur: Math.round(asFromCents * 100) / 100,
      storeAmountIrr: null
    };
  }
  return {
    ok: false,
    error: 'amount_mismatch',
    expectedEur,
    verifiedRaw: raw,
    asMajor,
    asFromCents
  };
}

/** Replay-safe amount gate: IRR legacy row or EUR settlement vs amount_eur. */
function validateYekpaySettledAmount(paymentRow, verifiedAmount) {
  const irr = validateYekpayIrrAgainstPayment(paymentRow, verifiedAmount);
  if (!irr.skipped) {
    return {
      ...irr,
      storeAmountIrr: irr.ok ? Math.round(Number(verifiedAmount)) : null
    };
  }
  return interpretYekpayVerifiedAmount(paymentRow, verifiedAmount);
}

function safeProviderBodyForClient(raw) {
  try {
    const s = JSON.stringify(raw ?? {});
    if (s.length <= 8000) return JSON.parse(s);
    return { truncated: true, rawPreview: s.slice(0, 4000) };
  } catch {
    return { error: 'unserializable_provider_body' };
  }
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

/** Allows payment create when DB profile row is stale-incomplete but checkout sent full billing. */
function hasBillingPayloadForPayment(body, authEmail) {
  const email = normalizeText(body?.email, 320).toLowerCase();
  const authNorm = String(authEmail || '')
    .trim()
    .toLowerCase();
  if (!email || !authNorm || email !== authNorm) return false;
  const mobile = normalizeText(body?.mobile || body?.phone, 64);
  const firstName = normalizeText(body?.firstName || body?.first_name, 255);
  const lastName = normalizeText(body?.lastName || body?.last_name, 255);
  const address = normalizeText(body?.address, 1024);
  const postal = normalizeText(body?.postalCode || body?.postal_code, 64);
  const country = normalizeText(body?.country, 8);
  return Boolean(
    email &&
      mobile.length >= 6 &&
      firstName &&
      lastName &&
      address.length >= 5 &&
      postal.length >= 2 &&
      country.length >= 2
  );
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


async function processSuccessfulPayment({ payment, authority, verifyResult, req, sessionId = null }) {
  const email = payment.email;
  const fresh = await getPaymentForUserById(payment.id, email);
  if (!fresh) {
    console.log('[billing-activation]', JSON.stringify({ error: 'payment_not_found', paymentId: String(payment.id) }));
    return { ok: false, error: 'payment_not_found' };
  }
  if (fresh.status === 'success') {
    const uid = fresh.user_id || (await getUserIdByEmail(email));
    console.log(
      '[billing-activation]',
      JSON.stringify({
        userId: uid ? String(uid) : null,
        plan: String(fresh.plan_key || fresh.plan || '').toLowerCase(),
        amount: Number(fresh.amount_irr || 0) || null,
        verificationResult: 'already_success',
        authority: authority ? String(authority).slice(-12) : null,
        subscriptionActivationResult: 'idempotent_skip'
      })
    );
    return { ok: true, idempotent: true, payment: fresh };
  }
  if (fresh.status !== 'pending') {
    return { ok: false, error: 'invalid_payment_state' };
  }

  const amountCheck = validateYekpaySettledAmount(fresh, verifyResult?.amount);
  if (!amountCheck.ok) {
    console.log(
      '[billing-activation]',
      JSON.stringify({
        userId: fresh.user_id ? String(fresh.user_id) : null,
        plan: String(fresh.plan_key || '').toLowerCase(),
        amount: Number(fresh.amount_irr || 0) || null,
        verificationResult: amountCheck.error || 'amount_rejected',
        authority: authority ? String(authority).slice(-12) : null,
        subscriptionActivationResult: 'blocked'
      })
    );
    return { ok: false, error: amountCheck.error || 'amount_mismatch' };
  }

  const planKeyResolved = String(fresh.plan_key || fresh.plan || 'pro').toLowerCase();
  if (!PAID_PLAN_KEYS.includes(planKeyResolved)) {
    return { ok: false, error: 'invalid_plan' };
  }
  const paid = await markPaymentSuccess(fresh.id, {
    refId: verifyResult?.raw?.Result?.ReferenceNumber || verifyResult?.raw?.ReferenceNumber || null,
    amountIrr: amountCheck.storeAmountIrr ?? null
  });
  if (!paid) {
    const again = await getPaymentForUserById(fresh.id, email);
    if (again?.status === 'success') {
      return { ok: true, idempotent: true, payment: again };
    }
    return { ok: false, error: 'payment_not_found' };
  }
  if (fresh.applied_offer_id && Number(fresh.discount_amount_eur || 0) > 0) {
    const redeem = await redeemOfferAtomic({
      userId: fresh.user_id,
      offerId: fresh.applied_offer_id,
      paymentId: fresh.id,
      originalAmountEur: Number(fresh.original_amount_eur || fresh.amount_eur || fresh.amount || 0),
      discountAmountEur: Number(fresh.discount_amount_eur || 0),
      finalAmountEur: Number(fresh.final_amount_eur || fresh.amount_eur || fresh.amount || 0)
    });
    if (!redeem.ok && redeem.reason !== 'already_redeemed') {
      return { ok: false, error: redeem.reason || 'redeem_failed' };
    }
  }
  const userId = fresh.user_id || (await getUserIdByEmail(fresh.email));
  const sub = await upsertSubscriptionFromPayment({
    userId,
    planKey: planKeyResolved,
    paymentId: fresh.id,
    autoRenew: true,
    durationDays: 30
  });
  const invoice = await createInvoiceForPayment({
    userId,
    paymentId: fresh.id,
    amount: Number(fresh.final_amount_eur || fresh.amount_eur || fresh.amount || 0),
    currency: String(fresh.currency || 'EUR')
  });
  const end = new Date(sub.expiresAt || Date.now());
  const out = await finalizePendingPaymentSuccess(
    fresh.email,
    fresh.id,
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
    metadata: { plan: planKeyResolved, paymentId: String(fresh.id), authority },
    req
  });
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_success',
    userId,
    sessionId,
    metadata: {
      plan: planKeyResolved,
      paymentId: String(fresh.id),
      authority,
      invoiceNumber: invoice?.invoice_number || null
    },
    req
  });
  console.log(
    '[billing-activation]',
    JSON.stringify({
      userId: userId ? String(userId) : null,
      plan: planKeyResolved,
      amount: Number(fresh.amount_irr || 0) || null,
      verificationResult: 'ok',
      authority: authority ? String(authority).slice(-12) : null,
      subscriptionActivationResult: sub.created ? 'created' : sub.extended ? 'extended' : 'updated'
    })
  );
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
  if (!profile) {
    return res.status(400).json({ success: false, ok: false, error: 'profile_missing' });
  }
  if (profile.incomplete && !hasBillingPayloadForPayment(body, email)) {
    return res.status(400).json({
      success: false,
      ok: false,
      error: 'profile_incomplete',
      providerStatus: null,
      providerBody: null
    });
  }

  const auditUserId = await resolveUserIdForAnalytics(email);
  if (!auditUserId) {
    return res.status(400).json({ ok: false, error: 'user_not_ready' });
  }
  void recordServerAuditEvent({
    eventType: 'product',
    eventName: 'payment_attempt',
    userId: auditUserId,
    sessionId,
    metadata: { plan: planKey },
    req
  });

  const planCfg = getPlanDef(planKey);
  const planAmountEur = planCfg?.priceEur?.monthly != null ? Number(planCfg.priceEur.monthly) : null;
  if (!Number.isFinite(planAmountEur) || planAmountEur <= 0) {
    return res.status(500).json({
      success: false,
      ok: false,
      error: 'plan_price_missing',
      providerStatus: null,
      providerBody: null
    });
  }
  /** EUR is server-derived from plan config only (never trust client `amount` — avoids legacy minor-unit bugs). */
  const amount = planAmountEur;
  const discountCode = String(body?.couponCode || body?.discount || '').trim().toUpperCase();
  let pricing = {
    originalAmountEur: Number(amount || 0),
    discountAmountEur: 0,
    finalAmountEur: Number(amount || 0),
    offerId: null,
    discountCode: null
  };
  if (discountCode) {
    const offerValidation = await validateOfferForCheckout({
      userId: auditUserId,
      planKey,
      code: discountCode,
      amountEur: amount
    });
    if (!offerValidation.ok) {
      if (offerValidation.reason === 'offers_unavailable') {
        console.warn('[payment] offers unavailable; continuing without coupon');
      } else {
      return res.status(400).json({ ok: false, error: 'invalid_coupon', reason: offerValidation.reason || 'invalid_or_expired' });
      }
    }
    if (offerValidation.ok) {
      pricing = {
        originalAmountEur: offerValidation.originalAmountEur,
        discountAmountEur: offerValidation.discountAmountEur,
        finalAmountEur: offerValidation.finalAmountEur,
        offerId: offerValidation.offer.id,
        discountCode: offerValidation.offer.code
      };
    }
  }

  if (provider === 'manual') {
    const paymentId = await insertPaymentPending({
      email,
      provider: 'manual',
      amount,
      originalAmountEur: pricing.originalAmountEur,
      discountAmountEur: pricing.discountAmountEur,
      finalAmountEur: pricing.finalAmountEur,
      currency: 'EUR',
      externalId: null,
      planKey,
      discountCode: pricing.discountCode,
      appliedOfferId: pricing.offerId
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
        success: false,
        ok: false,
        error: 'missing_merchant',
        providerStatus: null,
        providerBody: null,
        merchantConfigured: false,
        callbackUrl: yk.callbackUrl,
        details: { Message: 'Set YEKPAY_MERCHANT or YEKPAY_MERCHANT_ID on the server.' }
      });
    }
    if (yk.configError || !yk.apiBaseUrl) {
      return res.status(503).json({
        success: false,
        ok: false,
        error: 'yekpay_misconfigured',
        providerStatus: null,
        providerBody: null,
        merchantConfigured: Boolean(yk.merchantId),
        callbackUrl: yk.callbackUrl,
        details: {
          Message:
            yk.configError === 'sandbox_missing_api_base'
              ? 'YEKPAY_SANDBOX_MODE=true requires YEKPAY_API_BASE_URL.'
              : 'YekPay API base URL is missing or invalid.'
        }
      });
    }

    const eur = Number(pricing.finalAmountEur || amount);
    if (!Number.isFinite(eur) || eur <= 0 || eur > 500) {
      return res.status(400).json({
        success: false,
        ok: false,
        error: 'invalid_checkout_eur',
        details: { eur, maxAllowedEur: 500 }
      });
    }
    /** YekPay 978→978 (EUR-only): `amount` is full EUR major units (e.g. 19.99), not cents. */
    const yekpayAmountEur = Math.round(eur * 100) / 100;
    const { fromCurrencyCode, toCurrencyCode } = yekpayCurrencyPair();

    try {
      await ensurePaymentAttemptsSchema();
    } catch (e) {
      console.warn('[payment] provider_order_id schema ensure', e?.message || e);
    }

    const orderId = generateUniqueOrderId();
    console.log(
      '[payment-order-id]',
      JSON.stringify({
        context: 'create',
        orderId,
        orderIdLength: orderId.length,
        planKey,
        email: email.slice(0, 3) + '…'
      })
    );

    const paymentId = await insertPaymentPending({
      email,
      provider: 'yekpay',
      amount: eur,
      originalAmountEur: pricing.originalAmountEur,
      discountAmountEur: pricing.discountAmountEur,
      finalAmountEur: pricing.finalAmountEur,
      amountIrr: null,
      currency: 'EUR',
      externalId: null,
      providerOrderId: orderId,
      planKey,
      discountCode: pricing.discountCode,
      appliedOfferId: pricing.offerId
    });
    await createPaymentAttempt({
      paymentId,
      userId: auditUserId,
      attemptNumber: 1,
      status: 'pending'
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
    if (!yk.merchantId || !profilePayload.email) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required payment data'
      });
    }

    const yekpayOutbound = attachYekpayOrderIdentifiers(
      {
        merchantId: yk.merchantId,
        fromCurrencyCode,
        toCurrencyCode,
        email: profilePayload.email,
        mobile: profilePayload.mobile,
        firstName: profilePayload.firstName,
        lastName: profilePayload.lastName,
        address: profilePayload.address,
        postalCode: profilePayload.postalCode,
        country: profilePayload.country || 'IR',
        city: 'N/A',
        description: `Cutup ${planKey} plan`,
        amount: yekpayAmountEur,
        callback: callbackUrl
      },
      orderId
    );

    console.log(
      '[payment-yekpay-amount]',
      JSON.stringify({
        planKey,
        paymentId: String(paymentId),
        orderId,
        amount_eur: eur,
        yekpay_request_amount_eur: yekpayAmountEur,
        fromCurrencyCode,
        toCurrencyCode,
        amount_semantics: yekpayAmountSemantics(fromCurrencyCode, toCurrencyCode),
        amount_eur_original: pricing.originalAmountEur,
        amount_eur_final: pricing.finalAmountEur,
        amount_irr_db_pending: null,
        yekpay_payload: { ...yekpayOutbound, merchantId: '[set]' }
      })
    );

    const created = await yekpayCreatePaymentRequest(yekpayOutbound);

    if (!created.ok || !created.authority || !created.paymentUrl) {
      console.log(
        '[yekpay-init]',
        JSON.stringify({
          userId: String(auditUserId),
          plan: planKey,
          amountEur: eur,
          yekpayAmountEur,
          amountIrrDb: null,
          verificationResult: 'create_failed',
          authority: null,
          details: created.error || 'bad_response'
        })
      );
      console.log('[payment] yekpay failed', 'create', created.error || 'bad_response');
      try {
        await markPaymentTerminalStatus(email, paymentId, 'failed');
      } catch (e) {
        console.error('[payment] yekpay failed markPaymentTerminalStatus', e);
      }
      const upstreamStatus = created.httpStatus != null ? Number(created.httpStatus) : null;
      return res.status(502).json({
        success: false,
        ok: false,
        error: created.error || 'payment_failed',
        providerStatus: upstreamStatus,
        providerBody: safeProviderBodyForClient(created.raw),
        merchantConfigured: Boolean(yk.merchantId),
        callbackUrl: yk.callbackUrl,
        timedOut: Boolean(created.timedOut)
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
    console.log(
      '[yekpay-init]',
      JSON.stringify({
        userId: String(auditUserId),
        plan: planKey,
        amountEur: eur,
        yekpayAmountEur,
        amountIrrDb: null,
        verificationResult: 'redirect_issued',
        authority: created.authority ? String(created.authority).slice(-12) : null
      })
    );
    console.log('[payment] yekpay created', paymentId, email, created.authority);
    console.log('[payment] yekpay redirect', paymentId, created.paymentUrl);
    return res.status(200).json({
      ok: true,
      success: true,
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
  const gatewayOrderId = normalizeText(
    body?.orderNumber ??
      body?.OrderNumber ??
      body?.orderId ??
      body?.OrderId ??
      req.query?.orderNumber ??
      req.query?.OrderNumber,
    64
  );
  const successRaw = String(
    body?.success ?? body?.Success ?? req.query?.success ?? req.query?.Success ?? ''
  ).toLowerCase();
  const isSuccess = successRaw === '1' || successRaw === 'true' || successRaw === 'yes';

  if (!authority && !gatewayOrderId) {
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  let payment = authority ? await getPaymentByProviderExternalId('yekpay', authority) : null;
  if (!payment?.id && gatewayOrderId) {
    payment = await getPaymentByProviderOrderId('yekpay', gatewayOrderId);
  }
  if (!payment?.id || !payment?.email) {
    console.log(
      '[yekpay-callback]',
      JSON.stringify({
        verificationResult: 'payment_not_found',
        authority: authority ? authority.slice(-12) : null,
        gatewayOrderId: gatewayOrderId || null
      })
    );
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  if (String(payment.status || '').toLowerCase() === 'success') {
    return paymentFrontendRedirect(res, '/payment-success.html?from=yekpay&status=success');
  }
  if (String(payment.status || '').toLowerCase() !== 'pending') {
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  const sessionId = null;
  const userId = await resolveUserIdForAnalytics(payment.email);
  const planKey = String(payment.plan_key || payment.plan || '').toLowerCase();
  const amountEur = Number(payment.amount_eur ?? payment.final_amount_eur ?? payment.amount ?? 0);

  console.log(
    '[yekpay-callback]',
    JSON.stringify({
      userId: userId ? String(userId) : null,
      plan: planKey,
      paymentId: String(payment.id),
      provider_order_id: payment.provider_order_id || null,
      amount_eur_pending: amountEur,
      amount_irr_db: payment.amount_irr != null ? Number(payment.amount_irr) : null,
      verificationResult: 'received',
      authority: authority ? authority.slice(-12) : null,
      gatewayOrderId: gatewayOrderId || payment.provider_order_id || null,
      gatewaySuccessFlag: isSuccess
    })
  );

  const verifyAuthority = authority || payment.authority || payment.external_id;
  if (!verifyAuthority) {
    console.log(
      '[yekpay-callback]',
      JSON.stringify({
        paymentId: String(payment.id),
        verificationResult: 'missing_authority',
        gatewayOrderId: gatewayOrderId || payment.provider_order_id || null
      })
    );
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

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
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  const verified = await yekpayVerifyPayment(verifyAuthority);
  const amountPreview = interpretYekpayVerifiedAmount(payment, verified.amount);
  console.log(
    '[yekpay-verify]',
    JSON.stringify({
      userId: userId ? String(userId) : null,
      plan: planKey,
      amount_eur_pending: amountEur,
      verificationResult: verified.ok && verified.success ? 'success' : verified.error || 'declined',
      authority: authority.slice(-12),
      gatewayAmountRaw: verified.amount != null ? Number(verified.amount) : null,
      amountInterpretation: amountPreview.ok
        ? { mode: amountPreview.mode, settledEur: amountPreview.settledEur }
        : { error: amountPreview.error, details: amountPreview }
    })
  );

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
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  const amountPre = validateYekpaySettledAmount(payment, verified.amount);
  if (!amountPre.ok) {
    await markPaymentFailed(payment.id, amountPre.error || 'amount_mismatch');
    void recordServerAuditEvent({
      eventType: 'product',
      eventName: 'payment_failed',
      userId,
      sessionId,
      metadata: {
        plan: payment.plan_key || null,
        provider: 'yekpay',
        reason: amountPre.error || 'amount_mismatch'
      },
      req
    });
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  const out = await processSuccessfulPayment({
    payment,
    authority: verifyAuthority,
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
    return paymentFrontendRedirect(res, '/payment-failed.html');
  }

  return paymentFrontendRedirect(res, '/payment-success.html?from=yekpay&status=success');
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
  const orderId = generateUniqueOrderId();
  console.log(
    '[payment-order-id]',
    JSON.stringify({
      context: 'retry',
      orderId,
      orderIdLength: orderId.length,
      paymentId: String(failed.id),
      attemptNumber
    })
  );
  const prepared = await preparePaymentYekpayRetry(auth.email, failed.id, orderId);
  if (!prepared) {
    return res.status(409).json({ error: 'payment_not_retryable' });
  }
  await createPaymentAttempt({
    paymentId: failed.id,
    userId: failed.user_id,
    attemptNumber,
    status: 'pending'
  });
  const yk = getYekpayConfig();
  const amountEur = Number(failed.amount_eur || failed.amount || 0);
  if (!Number.isFinite(amountEur) || amountEur <= 0 || amountEur > 500) {
    await markPaymentAttemptStatus(failed.id, attemptNumber, 'failed', 'invalid_stored_eur');
    return res.status(400).json({ error: 'invalid_stored_eur' });
  }
  const yekpayAmountEur = Math.round(amountEur * 100) / 100;
  const { fromCurrencyCode, toCurrencyCode } = yekpayCurrencyPair();
  if (!yk.merchantId || yk.configError || !yk.apiBaseUrl) {
    await markPaymentAttemptStatus(failed.id, attemptNumber, 'failed', 'yekpay_misconfigured');
    return res.status(503).json({ error: 'Payment provider not configured' });
  }
  console.log(
    '[payment-yekpay-amount]',
    JSON.stringify({
      context: 'retry',
      paymentId: String(failed.id),
      orderId,
      attemptNumber,
      amount_eur: amountEur,
      yekpay_request_amount_eur: yekpayAmountEur,
      fromCurrencyCode,
      toCurrencyCode,
      amount_semantics: yekpayAmountSemantics(fromCurrencyCode, toCurrencyCode)
    })
  );
  const created = await yekpayCreatePaymentRequest(
    attachYekpayOrderIdentifiers(
      {
        merchantId: yk.merchantId,
        fromCurrencyCode,
        toCurrencyCode,
        email: auth.email,
        mobile: '',
        firstName: '',
        lastName: '',
        address: '',
        postalCode: '',
        country: 'IR',
        city: 'N/A',
        description: `Cutup ${failed.plan_key || failed.plan || 'pro'} plan`,
        amount: yekpayAmountEur,
        callback: yk.callbackUrl
      },
      orderId
    )
  );
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
    order_id: orderId,
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

    const auditUid = await resolveUserIdForAnalytics(email);
    console.log(
      '[yekpay-verify]',
      JSON.stringify({
        userId: auditUid ? String(auditUid) : null,
        plan: String(payment.plan_key || '').toLowerCase(),
        amount: Number(payment.amount_irr || 0) || null,
        verificationResult: !verified.ok ? verified.error : verified.success ? 'success' : verified.error || 'declined',
        authority: authGiven.slice(-12),
        paymentId: String(paymentId)
      })
    );

    if (!verified.ok) {
      console.log('[payment] yekpay failed', 'verify transport', verified.error);
      return res.status(502).json({ success: false, error: verified.error || 'verify_failed' });
    }

    if (!verified.success) {
      await markPaymentTerminalStatus(email, paymentId, 'failed');
      console.log('[payment] yekpay failed', 'verify declined', paymentId, verified.error);
      return res.status(200).json({ success: false, status: 'failed' });
    }

    const amountCheck = validateYekpaySettledAmount(payment, verified.amount);
    if (!amountCheck.ok) {
      await markPaymentTerminalStatus(email, paymentId, 'failed');
      console.log('[payment] yekpay failed', 'amount mismatch', paymentId, amountCheck.error);
      return res.status(200).json({ success: false, status: 'failed', error: amountCheck.error || 'amount_mismatch' });
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
