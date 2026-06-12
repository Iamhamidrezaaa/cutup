/**
 * Unified entry points: rate limit, queue, cache helpers for extraction APIs.
 */
import { enforceRateLimit } from './rate-limit.js';
import { enqueueJob, dedupeKeyForUrl, resolveQueuePriority, getQueueMetrics } from './extraction-queue.js';
import {
  getCachedExtraction,
  getCachedAudioPath,
  setCachedExtraction
} from './processing-cache.js';
import { extractionDebug, transcribeDebug } from './observability.js';
import { assertGpuOrCpuFallback } from './gpu-guard.js';

export { enforceRateLimit, getQueueMetrics };
export { getCachedExtraction, getCachedAudioPath, setCachedExtraction };
export { enqueueJob, dedupeKeyForUrl, resolveQueuePriority };
export { assertGpuOrCpuFallback };

/**
 * @returns {Promise<boolean>} true if blocked
 */
export async function guardExtractionRequest(req, res, route) {
  return enforceRateLimit(req, res, { route });
}

/**
 * Run yt-dlp / download work through queue with URL dedupe.
 */
export async function runQueuedDownload(opts) {
  const { url, userEmail, traceId, durationSec, fn } = opts;
  const priority = await resolveQueuePriority(userEmail);
  const dedupeKey = url ? dedupeKeyForUrl(url) : null;
  extractionDebug(traceId, { phase: 'queue_enqueue', dedupeKey, priority, route: 'download' });
  return enqueueJob({
    type: 'download',
    dedupeKey,
    traceId,
    priority,
    durationSec,
    fn
  });
}

/**
 * Run transcription through queue (limits parallel Whisper/API load).
 */
export async function runQueuedTranscribe(opts) {
  const { userEmail, traceId, durationSec, fn, dedupeKey = null } = opts;
  const priority = await resolveQueuePriority(userEmail);
  transcribeDebug(traceId, { phase: 'queue_enqueue', priority, dedupeKey });
  return enqueueJob({
    type: 'transcribe',
    dedupeKey,
    traceId,
    priority,
    durationSec,
    fn
  });
}

/**
 * Express middleware for extraction/render POST routes.
 */
export function extractionRateLimitMiddleware(routeName) {
  return async (req, res, next) => {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') return next();
    if (method === 'GET' && String(routeName).includes('export-video')) return next();
    // Upload job status polling — do not count against extraction burst limits.
    if (method === 'GET' && String(routeName).includes('upload')) return next();
    const blocked = await enforceRateLimit(req, res, { route: routeName || req.path });
    if (blocked) return;
    return next();
  };
}
