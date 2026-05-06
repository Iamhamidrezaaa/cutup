/**
 * Transcription provider health: cooldowns, structured logs, lightweight counters.
 * In-memory only (resets on cold start).
 */

const LEGACY_TALLIES = {
  openai: { quota: 0, timeout: 0, rate_limit: 0, outage: 0 },
  groq: { quota: 0, timeout: 0, rate_limit: 0, outage: 0 },
  deepgram: { quota: 0, timeout: 0, rate_limit: 0, outage: 0 },
  'local-whisper': { quota: 0, timeout: 0, rate_limit: 0, outage: 0 }
};

/** @type {Record<string, { failuresAt: number[], consecutiveFailures: number, lastSuccessAt: number|null, cooldownUntil: number|null }>} */
const PROVIDER_STATE = Object.create(null);

const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 10 * 60 * 1000;

function providerBucket(providerId) {
  const id = String(providerId || 'unknown');
  if (!PROVIDER_STATE[id]) {
    PROVIDER_STATE[id] = {
      failuresAt: [],
      consecutiveFailures: 0,
      lastSuccessAt: null,
      cooldownUntil: null
    };
  }
  return PROVIDER_STATE[id];
}

function pruneFailures(bucket) {
  const now = Date.now();
  bucket.failuresAt = bucket.failuresAt.filter((t) => now - t <= FAILURE_WINDOW_MS);
}

/** Skip provider until cooldown expires */
export function isProviderTemporarilyDisabled(providerId) {
  const b = PROVIDER_STATE[String(providerId)];
  if (!b || !b.cooldownUntil) return false;
  if (Date.now() >= b.cooldownUntil) {
    b.cooldownUntil = null;
    return false;
  }
  return true;
}

export function recordProviderSuccess(providerId) {
  const bucket = providerBucket(providerId);
  bucket.consecutiveFailures = 0;
  bucket.lastSuccessAt = Date.now();
  pruneFailures(bucket);
}

export function recordProviderFailure(providerId, kind = 'generic') {
  const bucket = providerBucket(providerId);
  const now = Date.now();
  bucket.consecutiveFailures += 1;
  bucket.failuresAt.push(now);
  pruneFailures(bucket);

  const recentCount = bucket.failuresAt.length;
  const consecBad = bucket.consecutiveFailures >= FAILURE_THRESHOLD;
  const windowBad = recentCount >= FAILURE_THRESHOLD;
  if ((consecBad || windowBad) && !bucket.cooldownUntil) {
    bucket.cooldownUntil = now + COOLDOWN_MS;
    console.log(
      '[provider-disabled]',
      JSON.stringify({
        provider: providerId,
        reason: 'failure_threshold',
        failuresInWindow: recentCount,
        consecutiveFailures: bucket.consecutiveFailures,
        cooldownUntilMs: bucket.cooldownUntil,
        kind
      })
    );
    bumpLegacyMetric(providerId, 'outage');
  }
}

export function bumpLegacyMetric(providerId, metric, delta = 1) {
  const p = LEGACY_TALLIES[providerId] || (LEGACY_TALLIES[providerId] = {});
  p[metric] = (p[metric] || 0) + delta;
}

/** @deprecated tallies — kept for dashboards / backwards compat */
export function bumpProviderMetric(provider, metric, delta = 1) {
  bumpLegacyMetric(provider, metric, delta);
}

export function logProviderQuota(provider, meta = {}) {
  bumpLegacyMetric(provider, 'quota');
  console.log('[provider-quota]', { provider, ...meta });
}

export function logProviderTimeout(provider, meta = {}) {
  bumpLegacyMetric(provider, 'timeout');
  console.log('[provider-timeout]', { provider, ...meta });
}

export function logProviderRateLimit(provider, meta = {}) {
  bumpLegacyMetric(provider, 'rate_limit');
  console.log('[provider-rate-limit]', { provider, ...meta });
}

export function logProviderOpenAi(meta = {}) {
  console.log('[provider-openai]', meta);
}

export function logProviderStart(meta = {}) {
  console.log('[provider-start]', JSON.stringify(meta));
}

export function logProviderSuccess(meta = {}) {
  console.log('[provider-success]', JSON.stringify(meta));
}

export function logProviderFailed(meta = {}) {
  console.log('[provider-failed]', JSON.stringify(meta));
}

/** @deprecated use logProviderFallbackAttempt — kept so old imports do not break */
export function logProviderFallback(meta = {}) {
  logProviderFallbackAttempt(meta);
}

export function logProviderFallbackAttempt(meta = {}) {
  const fallbackProviders = Array.isArray(meta.fallbackProviders) ? meta.fallbackProviders : [];
  const candidates = Array.isArray(meta.candidates) ? meta.candidates : [];
  if (fallbackProviders.length === 0 && candidates.length <= 1) {
    console.warn('[provider-fallback-attempt]', JSON.stringify({
      ...meta,
      warning: 'no_backup_providers_in_registry'
    }));
  } else {
    console.log('[provider-fallback-attempt]', JSON.stringify(meta));
  }
}

export function logProviderFallbackFinal(meta = {}) {
  console.log('[provider-fallback-final]', JSON.stringify(meta));
}

export function logProviderHealth(meta = {}) {
  console.log('[provider-health]', JSON.stringify(meta));
}

export function getProviderHealthSnapshot() {
  const transcription = {};
  for (const [id, b] of Object.entries(PROVIDER_STATE)) {
    transcription[id] = {
      failuresInWindow: b.failuresAt.length,
      consecutiveFailures: b.consecutiveFailures,
      lastSuccessAt: b.lastSuccessAt,
      cooldownUntil: b.cooldownUntil,
      disabledNow: Boolean(b.cooldownUntil && Date.now() < b.cooldownUntil)
    };
  }
  return {
    legacyTallies: JSON.parse(JSON.stringify(LEGACY_TALLIES)),
    transcription: JSON.parse(JSON.stringify(transcription))
  };
}
