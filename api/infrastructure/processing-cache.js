/**
 * In-memory URL-based processing cache (no Redis).
 */
import { existsSync } from 'fs';
import { cacheKeyForUrl } from './url-cache-key.js';
import { cacheDebug } from './observability.js';

const TTL_MS = Math.max(60000, Number(process.env.CACHE_TTL_HOURS || 24) * 3600 * 1000);
const store = new Map();

function now() {
  return Date.now();
}

function isExpired(entry) {
  return !entry || entry.expiresAt <= now();
}

function prune(key, entry) {
  if (isExpired(entry)) {
    store.delete(key);
    return null;
  }
  return entry;
}

/**
 * @param {string} url
 * @param {string} traceId
 */
export function getCachedExtraction(url, traceId) {
  const key = cacheKeyForUrl(url);
  if (!key) return null;
  const entry = prune(key, store.get(key));
  if (!entry) {
    cacheDebug(traceId, { normalizedUrl: key, cacheHit: false, cacheStage: 'miss' });
    return null;
  }
  cacheDebug(traceId, {
    normalizedUrl: key,
    cacheHit: true,
    cacheStage: entry.stage || 'full',
    reusedAssets: entry.reusedAssets || []
  });
  return { key, ...entry };
}

/**
 * Partial hit: audio on disk still valid.
 */
export function getCachedAudioPath(url, traceId) {
  const hit = getCachedExtraction(url, traceId);
  if (!hit?.audioPath || !existsSync(hit.audioPath)) return null;
  if (hit.stage === 'full' && hit.transcript) {
    return { audioPath: hit.audioPath, full: hit };
  }
  cacheDebug(traceId, {
    normalizedUrl: hit.key || cacheKeyForUrl(url),
    cacheHit: true,
    cacheStage: 'audio_only',
    reusedAssets: ['audioPath']
  });
  return { audioPath: hit.audioPath, full: null };
}

/**
 * @param {object} payload
 */
export function setCachedExtraction(url, payload, traceId) {
  const key = cacheKeyForUrl(url);
  if (!key) return;
  const entry = {
    key,
    stage: payload.stage || 'full',
    transcript: payload.transcript ?? null,
    subtitleBlocks: payload.subtitleBlocks ?? null,
    metadata: payload.metadata ?? null,
    audioPath: payload.audioPath ?? null,
    videoPath: payload.videoPath ?? null,
    jobDir: payload.jobDir ?? null,
    routePayload: payload.routePayload ?? null,
    reusedAssets: payload.reusedAssets || [],
    cachedAt: now(),
    expiresAt: now() + TTL_MS
  };
  store.set(key, entry);
  cacheDebug(traceId, {
    normalizedUrl: key,
    cacheHit: false,
    cacheStage: entry.stage,
    reusedAssets: entry.reusedAssets
  });
}

export function invalidateCache(url) {
  const key = cacheKeyForUrl(url);
  if (key) store.delete(key);
}

export function getCacheStats() {
  let active = 0;
  for (const [, v] of store) {
    if (!isExpired(v)) active += 1;
  }
  return { entries: active, ttlHours: TTL_MS / 3600000 };
}
