import { getFixedEurToIrrRate, YEKPAY_MAX_IRR_RIAL } from './eur-irr-rate.js';

/**
 * YekPay integration (production gateway).
 * - Payment request: POST {apiBase}/api/payment/request
 * - Payment verify: POST {apiBase}/api/payment/verify
 * - Body: application/json
 * - Order field: orderNumber only (official docs — do not send orderId)
 */

const DEFAULT_API_BASE = 'https://gate.ypsapi.com';

/** ISO 4217 — merchant account is EUR-only (978→978). */
export const YEKPAY_FROM_CURRENCY_CODE = 978;
export const YEKPAY_TO_CURRENCY_CODE = 978;

export function yekpayCurrencyPair() {
  return { fromCurrencyCode: YEKPAY_FROM_CURRENCY_CODE, toCurrencyCode: YEKPAY_TO_CURRENCY_CODE };
}

export function yekpayAmountSemantics(fromCode, toCode) {
  const from = Number(fromCode);
  const to = Number(toCode);
  if (from === 978 && to === 978) {
    return {
      unit: 'eur_major',
      note: 'YekPay expects amount in full EUR major units (e.g. 19.99), not cents'
    };
  }
  if (from === 978 && to === 364) {
    return {
      unit: 'eur_major_legacy_irr',
      note: 'Legacy: amount in EUR; gateway converted to IRR'
    };
  }
  return { unit: 'unknown', note: 'check YekPay docs for this currency pair' };
}

let startupLogged = false;

function readMerchantId() {
  const fromPrimary = (process.env.YEKPAY_MERCHANT || '').trim();
  const fromLegacy = (process.env.YEKPAY_MERCHANT_ID || '').trim();
  return fromPrimary || fromLegacy;
}

function readSandboxMode() {
  return String(process.env.YEKPAY_SANDBOX_MODE || '')
    .trim()
    .toLowerCase() === 'true';
}

function readApiBaseUrl() {
  const explicit = (process.env.YEKPAY_API_BASE_URL || '').trim().replace(/\/$/, '');
  const sandbox = readSandboxMode();
  if (sandbox) {
    if (!explicit) {
      return { base: '', sandbox, error: 'sandbox_missing_api_base' };
    }
    return { base: explicit, sandbox, error: null };
  }
  if (explicit) {
    return { base: explicit, sandbox: false, error: null };
  }
  return { base: DEFAULT_API_BASE, sandbox: false, error: null };
}

/** JSON-safe startup snapshot (no secrets). */
export function getYekpayStartupState() {
  const merchantId = readMerchantId();
  const { base, sandbox, error } = readApiBaseUrl();
  const callbackUrl = (
    process.env.YEKPAY_CALLBACK_URL ||
    'https://cutup.shop/api/payment/callback'
  ).trim();
  const rateInfo = getFixedEurToIrrRate();
  return {
    environment: process.env.NODE_ENV || 'development',
    merchantConfigured: Boolean(merchantId),
    sandboxMode: sandbox,
    callbackUrl,
    apiBaseUrl: base || null,
    configError: error,
    eurToIrrConfigured: rateInfo.ok,
    eurToIrrRate: rateInfo.ok ? rateInfo.rate : null,
    eurToIrrSource: rateInfo.source,
    eurToIrrUpdatedAt: rateInfo.updatedAt || null,
    eurToIrrNavasanItem: rateInfo.navasanItem || null,
    eurToIrrRaw: rateInfo.rateRaw || null,
    eurToIrrChange24h: rateInfo.change24h ?? null,
    yekpayMaxIrrRial: YEKPAY_MAX_IRR_RIAL,
    requestContentType: 'application/json'
  };
}

export function logYekpayStartupOnce() {
  if (startupLogged) return;
  startupLogged = true;
  try {
    console.log('[yekpay]', JSON.stringify(getYekpayStartupState()));
  } catch (_e) {
    /* noop */
  }
}

export function getYekpayConfig() {
  logYekpayStartupOnce();
  const callbackUrl = (
    process.env.YEKPAY_CALLBACK_URL ||
    'https://cutup.shop/api/payment/callback'
  ).trim();
  const merchantId = readMerchantId();
  const rateInfo = getFixedEurToIrrRate();
  const { base, sandbox, error } = readApiBaseUrl();
  return {
    callbackUrl,
    merchantId,
    apiBaseUrl: base,
    sandboxMode: sandbox,
    configError: error,
    eurToIrrRate: rateInfo.ok ? rateInfo.rate : null,
    eurToIrrSource: rateInfo.source,
    eurToIrrConfigured: rateInfo.ok,
    eurToIrrUpdatedAt: rateInfo.updatedAt || null,
    eurToIrrNavasanItem: rateInfo.navasanItem || null,
    yekpayMaxIrrRial: YEKPAY_MAX_IRR_RIAL,
    isConfigured: Boolean(merchantId) && Boolean(base) && !error
  };
}

function getYekpayFetchTimeoutMs() {
  const n = Number(process.env.YEKPAY_FETCH_TIMEOUT_MS || 22000);
  if (!Number.isFinite(n) || n < 3000) return 22000;
  return Math.min(n, 120000);
}

/** Log-only copy — never pass return value to fetch. */
function maskYekpayPayloadForLog(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return {
    ...payload,
    merchantId: payload.merchantId ? '[set]' : '[missing]'
  };
}

/** Deep clone so logging/masking can never mutate the wire payload. */
function cloneWirePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return JSON.parse(JSON.stringify(payload));
}

function buildYekpayJsonHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

const YEKPAY_CREATE_FIELD_KEYS = [
  'merchantId',
  'amount',
  'callback',
  'orderNumber',
  'fromCurrencyCode',
  'toCurrencyCode',
  'firstName',
  'lastName',
  'email',
  'mobile',
  'address',
  'postalCode',
  'country',
  'city',
  'description'
];

/** Attach gateway orderNumber only — never orderId. */
export function attachYekpayOrderIdentifiers(payload, uniqueOrderNumber) {
  const id = String(uniqueOrderNumber || '').trim();
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  delete next.orderId;
  delete next.OrderId;
  delete next.OrderNumber;
  if (!id) return next;
  next.orderNumber = id;
  return next;
}

function normalizeCreatePayload(payload) {
  const base = payload && typeof payload === 'object' ? { ...payload } : {};
  const orderNumber = String(
    base.orderNumber ?? base.orderId ?? base.OrderNumber ?? base.OrderId ?? ''
  ).trim();

  const minimal = {};
  for (const key of YEKPAY_CREATE_FIELD_KEYS) {
    if (key === 'orderNumber') continue;
    if (base[key] !== undefined && base[key] !== null && base[key] !== '') {
      minimal[key] = base[key];
    }
  }
  if (orderNumber) {
    const numericOnly = orderNumber.replace(/\D/g, '');
    minimal.orderNumber = String(numericOnly);
    console.log(
      '[yekpay-order-format]',
      JSON.stringify({
        orderNumber: minimal.orderNumber,
        length: minimal.orderNumber.length,
        type: typeof minimal.orderNumber,
        numericOnly: /^[0-9]+$/.test(minimal.orderNumber)
      })
    );
  }

  return minimal;
}

function parseYekpayJsonResponse(json) {
  const d =
    json?.Result && typeof json.Result === 'object'
      ? json.Result
      : json?.data && typeof json.data === 'object'
        ? json.data
        : json;
  const code = d?.Code ?? d?.code ?? json?.Code ?? json?.code;
  const description =
    d?.Description ?? d?.description ?? json?.Description ?? json?.message ?? null;
  const authority = d?.authority ?? d?.Authority ?? json?.authority ?? json?.Authority;
  return { d, code, description, authority, codeNum: Number(code) };
}

async function yekpayJsonPost(url, payload) {
  const cfg = getYekpayConfig();
  const { callbackUrl, merchantId: configMerchantId } = cfg;
  const wirePayload = cloneWirePayload(payload);
  const timeoutMs = getYekpayFetchTimeoutMs();
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);

  console.log(
    '[yekpay-json-request]',
    JSON.stringify({
      endpoint: url,
      contentType: 'application/json',
      timeout: timeoutMs,
      merchantConfigured: Boolean(configMerchantId),
      callbackUrl: callbackUrl || null,
      payload: maskYekpayPayloadForLog(wirePayload)
    })
  );

  console.log(
    '[yekpay-final-payload-check]',
    typeof wirePayload.merchantId,
    wirePayload.merchantId
  );

  console.log(
    '[yekpay-payload-keys]',
    JSON.stringify({
      endpoint: url,
      keys: Object.keys(wirePayload)
    })
  );

  const bodyJson = JSON.stringify(wirePayload);

  let res;
  let rawText = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildYekpayJsonHeaders(),
      body: bodyJson,
      signal: ctrl.signal
    });
    rawText = await res.text();
  } catch (e) {
    const timedOut = e?.name === 'AbortError' || String(e?.message || '').includes('aborted');
    const err = timedOut ? 'upstream_timeout' : e.message || 'network_error';
    console.log(
      '[yekpay-json-response]',
      JSON.stringify({
        endpoint: url,
        error: err,
        timedOut: Boolean(timedOut),
        rawText: ''
      })
    );
    return { res: null, json: {}, rawText: '', error: err, httpStatus: null, timedOut };
  } finally {
    clearTimeout(tid);
  }

  console.log(
    '[yekpay-json-response]',
    JSON.stringify({
      endpoint: url,
      httpStatus: res.status,
      rawText: rawText.length > 8000 ? `${rawText.slice(0, 8000)}…` : rawText
    })
  );

  let json = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch (_parseErr) {
    json = {};
  }

  const { code, description, authority, codeNum } = parseYekpayJsonResponse(json);

  return { res, json, rawText, codeNum, description, authority, bodyPayload: wirePayload };
}

/**
 * @returns {{ ok: boolean, authority?: string, paymentUrl?: string, raw: object, error?: string, httpStatus?: number|null, timedOut?: boolean }}
 */
export async function yekpayCreatePaymentRequest(payload) {
  const cfg = getYekpayConfig();
  const { apiBaseUrl } = cfg;
  if (!apiBaseUrl) {
    return { ok: false, raw: {}, error: 'yekpay_not_configured', httpStatus: null };
  }
  const url = `${apiBaseUrl}/api/payment/request`;
  const bodyFields = normalizeCreatePayload(payload);

  const outbound = await yekpayJsonPost(url, bodyFields);
  if (!outbound.res) {
    return {
      ok: false,
      raw: outbound.json || {},
      error: outbound.error || 'network_error',
      httpStatus: outbound.httpStatus ?? null,
      timedOut: Boolean(outbound.timedOut)
    };
  }

  const { res, json, codeNum, description, authority } = outbound;
  const paymentUrl = authority
    ? `${apiBaseUrl}/api/payment/start/${encodeURIComponent(String(authority))}`
    : null;
  const accepted = res.ok && authority && paymentUrl && codeNum === 100;

  if (accepted) {
    return { ok: true, authority: String(authority), paymentUrl: String(paymentUrl), raw: json, httpStatus: res.status };
  }

  const errMsg = description != null ? String(description) : `http_${res.status}`;
  console.log(
    '[yekpay-create-error]',
    JSON.stringify({
      endpoint: url,
      httpStatus: res.status,
      orderNumber: bodyFields.orderNumber ?? null,
      providerCode: codeNum,
      providerDescription: errMsg,
      error: errMsg
    })
  );
  return { ok: false, raw: json, error: errMsg, httpStatus: res.status };
}

/**
 * @returns {{ ok: boolean, success?: boolean, amount?: number|null, raw: object, error?: string }}
 */
export async function yekpayVerifyPayment(authority) {
  const { merchantId, apiBaseUrl } = getYekpayConfig();
  if (!merchantId || !apiBaseUrl) {
    return { ok: false, raw: {}, error: 'yekpay_not_configured' };
  }
  const url = `${apiBaseUrl}/api/payment/verify`;
  const bodyFields = { merchantId, authority: String(authority) };

  const outbound = await yekpayJsonPost(url, bodyFields);
  if (!outbound.res) {
    const timedOut = outbound.timedOut;
    return { ok: false, raw: {}, error: timedOut ? 'upstream_timeout' : outbound.error || 'network_error' };
  }

  const { res, json, codeNum, description } = outbound;
  const successByCode = codeNum === 100;
  const success = successByCode;

  const d =
    json?.Result && typeof json.Result === 'object'
      ? json.Result
      : json?.data && typeof json.data === 'object'
        ? json.data
        : json;
  let amount = d?.amount ?? json?.amount;
  if (amount != null) amount = Number(amount);

  if (!res.ok && !successByCode) {
    const errMsg = description != null ? String(description) : `http_${res.status}`;
    return { ok: true, success: false, amount: amount ?? null, raw: json, error: String(errMsg) };
  }

  const amountAsFullEur = amount != null ? Number(amount) : null;
  const amountAsCentsEur =
    amountAsFullEur != null && Number.isFinite(amountAsFullEur) ? amountAsFullEur / 100 : null;

  console.log(
    '[yekpay-verify-response]',
    JSON.stringify({
      httpStatus: res.status,
      success,
      code: codeNum,
      amount_raw: amount ?? null,
      amount_interpretation_eur_major: amountAsFullEur,
      amount_interpretation_if_cents: amountAsCentsEur,
      note: 'EUR-only merchant (978→978): compare verify amount to pending amount_eur as major units first'
    })
  );

  return { ok: true, success, amount: amount ?? null, raw: json, code: codeNum };
}
