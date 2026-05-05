/**
 * YekPay integration for gate.ypsapi.com endpoints.
 * Env:
 * - YEKPAY_MERCHANT_ID (required)
 * - YEKPAY_CALLBACK_URL (optional, defaults to https://cutup.shop/api/payment/callback)
 * - YEKPAY_EUR_TO_IRR (optional, fixed EUR->IRR rate for now)
 */

export function getYekpayConfig() {
  const callbackUrl = (
    process.env.YEKPAY_CALLBACK_URL ||
    'https://cutup.shop/api/payment/callback'
  ).trim();
  const merchantId = (process.env.YEKPAY_MERCHANT_ID || '').trim();
  const eurToIrrRate = Number(process.env.YEKPAY_EUR_TO_IRR || 900000);
  return {
    callbackUrl,
    merchantId,
    eurToIrrRate: Number.isFinite(eurToIrrRate) && eurToIrrRate > 0 ? eurToIrrRate : 900000,
    isConfigured: Boolean(merchantId)
  };
}

function buildJsonHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * @returns {{ ok: boolean, authority?: string, paymentUrl?: string, raw: object, error?: string }}
 */
export async function yekpayCreatePaymentRequest(payload) {
  const url = 'https://gate.ypsapi.com/api/payment/request';
  const body = payload && typeof payload === 'object' ? payload : {};

  let res;
  let json = {};
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify(body)
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, raw: {}, error: e.message || 'network_error' };
  }

  const d = json?.Result && typeof json.Result === 'object'
    ? json.Result
    : json?.data && typeof json.data === 'object'
      ? json.data
      : json;
  const code = d?.Code ?? d?.code ?? json?.Code ?? json?.code;
  const authority = d?.authority ?? d?.Authority ?? json?.authority ?? json?.Authority;
  const paymentUrl = authority
    ? `https://gate.ypsapi.com/api/payment/start/${encodeURIComponent(String(authority))}`
    : null;

  const codeNum = Number(code);
  const accepted = res.ok && authority && paymentUrl && codeNum === 100;

  if (accepted) {
    return { ok: true, authority: String(authority), paymentUrl: String(paymentUrl), raw: json };
  }

  const errMsg =
    d?.Description ?? d?.description ?? json?.Description ?? json?.message ?? `http_${res.status}`;
  return { ok: false, raw: json, error: String(errMsg) };
}

/**
 * @returns {{ ok: boolean, success?: boolean, amount?: number|null, raw: object, error?: string }}
 */
export async function yekpayVerifyPayment(authority) {
  const { merchantId } = getYekpayConfig();
  const url = 'https://gate.ypsapi.com/api/payment/verify';
  const body = { merchantId, authority: String(authority) };

  let res;
  let json = {};
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify(body)
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, raw: {}, error: e.message || 'network_error' };
  }

  const d = json?.Result && typeof json.Result === 'object'
    ? json.Result
    : json?.data && typeof json.data === 'object'
      ? json.data
      : json;
  const code = d?.Code ?? d?.code ?? json?.Code ?? json?.code;
  const codeNum = Number(code);
  const successByCode = codeNum === 100;
  const success = successByCode;

  let amount = d?.amount ?? json?.amount;
  if (amount != null) amount = Number(amount);

  if (!res.ok && !successByCode) {
    const errMsg =
      d?.Description ?? d?.description ?? json?.Description ?? json?.message ?? `http_${res.status}`;
    return { ok: true, success: false, amount: amount ?? null, raw: json, error: String(errMsg) };
  }

  return { ok: true, success, amount: amount ?? null, raw: json, code: codeNum };
}
