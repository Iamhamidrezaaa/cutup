/**
 * Canonical URL keys for processing cache (YouTube shorts/watch, tracking stripped).
 */
import {
  detectPlatformFromUrl,
  normalizeYouTubeWatchUrl,
  normalizeInstagramUrl,
  parseYouTubeVideoId,
  stripTrackingQueryParams
} from '../media-url.js';

/**
 * @param {string} url
 * @returns {string|null}
 */
export function normalizeSourceUrl(url) {
  const raw = stripTrackingQueryParams(String(url || '').trim());
  if (!raw) return null;

  const platform = detectPlatformFromUrl(raw);
  if (platform === 'youtube') {
    const watch = normalizeYouTubeWatchUrl(raw);
    if (watch) return watch;
    const id = parseYouTubeVideoId(raw);
    return id ? `https://www.youtube.com/watch?v=${id}` : raw;
  }
  if (platform === 'instagram') {
    return normalizeInstagramUrl(raw) || raw;
  }

  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * @param {string} url
 * @param {string} [suffix]
 */
export function cacheKeyForUrl(url, suffix = '') {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;
  return suffix ? `${normalized}#${suffix}` : normalized;
}
