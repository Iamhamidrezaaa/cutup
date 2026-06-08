/**
 * EUR→IRR rate for estimates, admin FX display, and tooling.
 *
 * Priority:
 * 1. EUR_TO_IRR / YEKPAY_EUR_TO_IRR env override (manual emergency)
 * 2. Cached Navasan snapshot (DB + memory, refreshed daily at 12:00 Iran)
 * 3. Live Navasan fetch when cache is empty
 * 4. Legacy default 550000
 *
 * YekPay checkout uses EUR-only 978→978; this rate is for admin/estimates only.
 */

import { fetchNavasanEurRate } from './navasan-fx.js';
import { getCachedEurIrrRateDb, upsertEurIrrRateDb } from './fx-rate-repository.js';

export const YEKPAY_MAX_IRR_RIAL = 999_000_000;

const MIN_SANE_RATE = 50_000;
const MAX_SANE_RATE = 5_000_000;
const MEMORY_TTL_MS = 60 * 60 * 1000;
const STALE_DB_MS = 26 * 60 * 60 * 1000;

/** @type {{ rate: number|null, source: string, updatedAt: number|null, meta: Record<string, unknown>|null, loadPromise: Promise<void>|null }} */
const memory = {
  rate: null,
  source: 'default_550000',
  updatedAt: null,
  meta: null,
  loadPromise: null
};

function readEnvOverride() {
  const raw = (process.env.EUR_TO_IRR || process.env.YEKPAY_EUR_TO_IRR || '').trim();
  if (!raw) return null;
  const source = process.env.EUR_TO_IRR ? 'EUR_TO_IRR' : 'YEKPAY_EUR_TO_IRR';
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_SANE_RATE || parsed > MAX_SANE_RATE) {
    return { ok: false, error: 'invalid_eur_to_irr', rate: null, source };
  }
  return { ok: true, rate: parsed, source };
}

function applyMemory(snapshot) {
  memory.rate = snapshot.rateIrr;
  memory.source = snapshot.source;
  memory.updatedAt = snapshot.fetchedAt ? new Date(snapshot.fetchedAt).getTime() : Date.now();
  memory.meta = {
    navasanItem: snapshot.navasanItem,
    rateRaw: snapshot.rateRaw,
    change24h: snapshot.change24h,
    fetchedAt: snapshot.fetchedAt,
    valueUnit: snapshot.meta?.valueUnit,
    navasanDate: snapshot.meta?.navasanDate
  };
}

function memoryFresh() {
  return memory.rate != null && memory.updatedAt != null && Date.now() - memory.updatedAt < MEMORY_TTL_MS;
}

function buildOk(rate, source, extra = {}) {
  return {
    ok: true,
    rate,
    source,
    updatedAt: extra.updatedAt || null,
    navasanItem: extra.navasanItem || null,
    rateRaw: extra.rateRaw || null,
    change24h: extra.change24h ?? null
  };
}

/**
 * Synchronous read — uses env override, warm memory cache, or legacy default.
 * Call `ensureEurIrrRateLoaded()` before admin/payment paths that need live Navasan data.
 */
export function getFixedEurToIrrRate() {
  const env = readEnvOverride();
  if (env?.ok) return buildOk(env.rate, env.source);
  if (env && !env.ok) {
    return { ok: false, error: env.error, rate: null, source: env.source };
  }

  if (memory.rate != null) {
    return buildOk(memory.rate, memory.source, {
      updatedAt: memory.updatedAt ? new Date(memory.updatedAt).toISOString() : null,
      navasanItem: memory.meta?.navasanItem,
      rateRaw: memory.meta?.rateRaw,
      change24h: memory.meta?.change24h
    });
  }

  return buildOk(550_000, 'default_550000');
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

async function refreshFromNavasan({ force = false } = {}) {
  if (!force && memoryFresh()) return { ok: true, skipped: true, source: memory.source };

  const live = await fetchNavasanEurRate();
  if (!live.ok) return live;

  const snapshot = {
    rateIrr: live.rateIrr,
    rateRaw: live.rawValue,
    source: 'navasan',
    navasanItem: live.item,
    change24h: live.change,
    meta: {
      valueUnit: live.valueUnit,
      navasanDate: live.date,
      navasanTimestamp: live.timestamp
    }
  };

  applyMemory({
    rateIrr: snapshot.rateIrr,
    source: snapshot.source,
    navasanItem: snapshot.navasanItem,
    rateRaw: snapshot.rateRaw,
    change24h: snapshot.change24h,
    fetchedAt: new Date().toISOString(),
    meta: snapshot.meta
  });

  try {
    await upsertEurIrrRateDb(snapshot);
  } catch (e) {
    console.warn('[eur-irr] db upsert failed', e?.message);
  }

  return { ok: true, rate: live.rateIrr, source: 'navasan', item: live.item };
}

async function loadFromDbIfNeeded() {
  const cached = await getCachedEurIrrRateDb();
  if (!cached?.rateIrr) return false;

  const age = cached.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  applyMemory(cached);

  if (age > STALE_DB_MS) return false;
  return true;
}

/**
 * Warm cache from DB, then Navasan if needed. Safe to call concurrently.
 */
export async function ensureEurIrrRateLoaded({ forceLive = false } = {}) {
  if (readEnvOverride()?.ok) return getFixedEurToIrrRate();
  if (!forceLive && memoryFresh()) return getFixedEurToIrrRate();

  if (memory.loadPromise) {
    await memory.loadPromise;
    return getFixedEurToIrrRate();
  }

  memory.loadPromise = (async () => {
    try {
      const dbOk = await loadFromDbIfNeeded();
      if (!dbOk || forceLive) {
        const live = await refreshFromNavasan({ force: true });
        if (!live.ok && !memory.rate) {
          console.warn('[eur-irr] navasan refresh failed', live.error);
        }
      }
    } finally {
      memory.loadPromise = null;
    }
  })();

  await memory.loadPromise;
  return getFixedEurToIrrRate();
}

/** Daily cron + manual refresh entry point. */
export async function refreshEurIrrRateDaily() {
  const env = readEnvOverride();
  if (env?.ok) {
    return { ok: true, skipped: true, reason: 'env_override', rate: env.rate, source: env.source };
  }
  return refreshFromNavasan({ force: true });
}
