/**
 * YekPay REST integration (configurable base URL).
 * Env: YEKPAY_API_KEY, YEKPAY_CALLBACK_URL, YEKPAY_BASE_URL (default https://api.yekpay.com)
 * Optional: YEKPAY_MERCHANT_ID — sent in JSON body when set (some gateways expect it).
 */

export function getYekpayConfig() {
  const apiKey = (process.env.YEKPAY_API_KEY || '').trim();
  const callbackUrl = (process.env.YEKPAY_CALLBACK_URL || '').trim();
  const baseUrl = (process.env.YEKPAY_BASE_URL || 'https://api.yekpay.com').replace(/\/$/, '');
  const merchantId = (process.env.YEKPAY_MERCHANT_ID || '').trim();
  return {
    apiKey,
    callbackUrl,
    baseUrl,
    merchantId,
    isConfigured: Boolean(apiKey && callbackUrl)
  };
}

function buildAuthHeaders(apiKey) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * @returns {{ ok: boolean, authority?: string, paymentUrl?: string, raw: object, error?: string }}
 */
export async function yekpayCreatePaymentRequest({ amount, currency, callbackUrl, description }) {
  const { apiKey, baseUrl, merchantId } = getYekpayConfig();
  const url = `${baseUrl}/payment/request`;
  const body = {
    amount,
    currency: currency || 'USD',
    callbackUrl,
    description
  };
  if (merchantId) body.merchantId = merchantId;

  let res;
  let json = {};
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify(body)
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, raw: {}, error: e.message || 'network_error' };
  }

  const d = json?.data && typeof json.data === 'object' ? json.data : json;
  const code = d?.Code ?? d?.code ?? json?.Code ?? json?.code;
  const authority = d?.authority ?? d?.Authority ?? json?.authority ?? json?.Authority;
  const paymentUrl =
    d?.paymentUrl ?? d?.payment_url ?? d?.url ?? json?.paymentUrl ?? json?.payment_url;

  const codeNum = Number(code);
  const statusOk = String(d?.status ?? json?.status ?? '').toLowerCase() === 'success';
  const accepted = res.ok && authority && paymentUrl && (codeNum === 100 || statusOk || Number.isNaN(codeNum));

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
  const { apiKey, baseUrl, merchantId } = getYekpayConfig();
  const url = `${baseUrl}/payment/verify`;
  const body = { authority: String(authority) };
  if (merchantId) body.merchantId = merchantId;

  let res;
  let json = {};
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify(body)
    });
    json = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, raw: {}, error: e.message || 'network_error' };
  }

  const d = json?.data && typeof json.data === 'object' ? json.data : json;
  const code = d?.Code ?? d?.code ?? json?.Code ?? json?.code;
  const codeNum = Number(code);
  const statusStr = String(d?.status ?? json?.status ?? '').toLowerCase();
  const successByCode = codeNum === 100;
  const successByStatus = statusStr === 'success';
  const success = successByCode || successByStatus;

  let amount = d?.amount ?? json?.amount;
  if (amount != null) amount = Number(amount);

  if (!res.ok && !successByCode && !successByStatus) {
    const errMsg =
      d?.Description ?? d?.description ?? json?.Description ?? json?.message ?? `http_${res.status}`;
    return { ok: true, success: false, amount: amount ?? null, raw: json, error: String(errMsg) };
  }

  return { ok: true, success, amount: amount ?? null, raw: json };
}
