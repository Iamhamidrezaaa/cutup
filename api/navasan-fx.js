/**
 * Navasan.tech FX API — EUR→IRR for admin display and local estimates.
 * Docs: http://api.navasan.tech/latest/?api_key=...&item=eur
 */

const DEFAULT_BASE = 'http://api.navasan.tech';
const DEFAULT_EUR_ITEM = 'eur';
const FETCH_TIMEOUT_MS = 15000;

const MIN_SANE_RATE = 50_000;
const MAX_SANE_RATE = 5_000_000;

function readApiKey() {
  return String(process.env.NAVASAN_API_KEY || '').trim();
}

function readEurItem() {
  return String(process.env.NAVASAN_EUR_ITEM || DEFAULT_EUR_ITEM).trim() || DEFAULT_EUR_ITEM;
}

function readValueUnit() {
  const u = String(process.env.NAVASAN_VALUE_UNIT || 'toman').trim().toLowerCase();
  return u === 'rial' ? 'rial' : 'toman';
}

function parseRateValue(raw) {
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toIrrRate(rawValue, unit = readValueUnit()) {
  const v = parseRateValue(rawValue);
  if (v == null) return null;
  return unit === 'toman' ? Math.round(v * 10) : Math.round(v);
}

function pickItemPayload(json, item) {
  if (!json || typeof json !== 'object') return null;
  if (json[item] && typeof json[item] === 'object') return json[item];
  const keys = Object.keys(json).filter((k) => !['message', 'error'].includes(k));
  if (keys.length === 1 && typeof json[keys[0]] === 'object') return json[keys[0]];
  return null;
}

/**
 * @returns {Promise<{
 *   ok: true,
 *   rateIrr: number,
 *   rawValue: string,
 *   change: number|null,
 *   timestamp: number|null,
 *   date: string|null,
 *   item: string,
 *   valueUnit: string,
 *   source: string
 * } | { ok: false, error: string, status?: number, detail?: string }>}
 */
export async function fetchNavasanEurRate(opts = {}) {
  const apiKey = opts.apiKey || readApiKey();
  if (!apiKey) return { ok: false, error: 'missing_api_key' };

  const item = opts.item || readEurItem();
  const base = String(process.env.NAVASAN_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const url = `${base}/latest/?api_key=${encodeURIComponent(apiKey)}&item=${encodeURIComponent(item)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: 'invalid_json', status: res.status, detail: text.slice(0, 200) };
    }

    if (!res.ok) {
      return {
        ok: false,
        error: json?.message || 'navasan_http_error',
        status: res.status,
        detail: text.slice(0, 200)
      };
    }

    const row = pickItemPayload(json, item);
    if (!row?.value) {
      return { ok: false, error: 'missing_eur_item', status: res.status, detail: item };
    }

    const valueUnit = readValueUnit();
    const rateIrr = toIrrRate(row.value, valueUnit);
    if (rateIrr == null || rateIrr < MIN_SANE_RATE || rateIrr > MAX_SANE_RATE) {
      return { ok: false, error: 'rate_out_of_range', detail: String(row.value) };
    }

    const changeRaw = row.change;
    const change = changeRaw === '' || changeRaw == null ? null : Number(changeRaw);

    return {
      ok: true,
      rateIrr,
      rawValue: String(row.value),
      change: Number.isFinite(change) ? change : null,
      timestamp: row.timestamp != null ? Number(row.timestamp) : null,
      date: row.date || null,
      item,
      valueUnit,
      source: 'navasan'
    };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'navasan_timeout' : e?.message || 'navasan_fetch_failed';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
