/**
 * Optional fixed EUR→IRR rate (for estimates, tooling, or non-YekPay paths).
 * Env (server only):
 * - EUR_TO_IRR — preferred
 * - YEKPAY_EUR_TO_IRR — legacy alias
 *
 * YekPay checkout uses `fromCurrencyCode=978` + `toCurrencyCode=978` (EUR-only account):
 * the gateway expects `amount` in **full EUR major units** (e.g. 19.99), not cents.
 * Do not use this module for that request payload.
 *
 * `YEKPAY_MAX_IRR_RIAL` is a sanity ceiling for any code that still converts locally.
 */

export const YEKPAY_MAX_IRR_RIAL = 999_000_000;

const MIN_SANE_RATE = 5_000;
const MAX_SANE_RATE = 2_000_000;

/**
 * @returns {{ ok: true, rate: number, source: string } | { ok: false, error: string, rate: null, source: string }}
 */
export function getFixedEurToIrrRate() {
  const raw = (process.env.EUR_TO_IRR || process.env.YEKPAY_EUR_TO_IRR || '').trim();
  const source = process.env.EUR_TO_IRR ? 'EUR_TO_IRR' : process.env.YEKPAY_EUR_TO_IRR ? 'YEKPAY_EUR_TO_IRR' : 'default';
  const parsed = raw ? Number(raw) : NaN;
  const fallback = 550_000;
  const rate = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  if (!Number.isFinite(rate) || rate < MIN_SANE_RATE || rate > MAX_SANE_RATE) {
    return {
      ok: false,
      error: 'invalid_eur_to_irr',
      rate: null,
      source: raw ? source : 'default'
    };
  }
  return { ok: true, rate, source: raw ? source : 'default_550000' };
}

/**
 * @returns {{ ok: true, irr: number, rate: number, source: string } | { ok: false, irr: null, rate: number|null, source: string, error?: string }}
 */
export function convertEurToIrr(eur) {
  const value = Number(eur);
  const rateInfo = getFixedEurToIrrRate();
  if (!rateInfo.ok) {
    return { ok: false, irr: null, rate: null, source: rateInfo.source, error: rateInfo.error };
  }
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, irr: null, rate: rateInfo.rate, source: rateInfo.source, error: 'invalid_eur' };
  }
  const irr = Math.round(value * rateInfo.rate);
  if (irr > YEKPAY_MAX_IRR_RIAL) {
    return {
      ok: false,
      irr: null,
      rate: rateInfo.rate,
      source: rateInfo.source,
      error: 'irr_exceeds_gateway_limit'
    };
  }
  return { ok: true, irr, rate: rateInfo.rate, source: rateInfo.source };
}