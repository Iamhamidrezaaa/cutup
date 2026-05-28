/**
 * Per-IP / per-user rate limiting with burst cooldown for extraction routes.
 */
import { setCORSHeaders } from '../cors.js';
import { getSessionIdFromRequest, getEmailForSession } from '../processing-enforcement.js';
import { resolveTraceId } from '../transcript-errors.js';
import { rateLimitDebug } from './observability.js';

const WINDOW_MS = Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000));
const MAX_REQUESTS = Math.max(1, Number(process.env.RATE_LIMIT_MAX_REQUESTS || 5));
const BURST_WINDOW_MS = Math.max(2000, Number(process.env.RATE_LIMIT_BURST_WINDOW_MS || 10000));
const BURST_THRESHOLD = Math.max(MAX_REQUESTS + 1, Number(process.env.RATE_LIMIT_BURST_THRESHOLD || 8));
const COOLDOWN_MIN_SEC = Math.max(30, Number(process.env.RATE_LIMIT_COOLDOWN_MIN_SEC || 30));
const COOLDOWN_MAX_SEC = Math.max(COOLDOWN_MIN_SEC, Number(process.env.RATE_LIMIT_COOLDOWN_MAX_SEC || 120));

/** @type {Map<string, { hits: number[], burstHits: number[], cooldownUntil: number, abuseScore: number }>} */
const buckets = new Map();

const PROTECTED_ROUTE_PREFIXES = [
  '/api/youtube',
  '/api/youtube-download',
  '/api/youtube-formats',
  '/api/transcribe',
  '/api/upload',
  '/api/export-video'
];

export function isExtractionRoute(pathname, method = 'POST') {
  const p = String(pathname || '').split('?')[0];
  if (p === '/api/export-video' && String(method).toUpperCase() === 'GET') {
    return false;
  }
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => p === prefix);
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  if (raw) return String(raw).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

function limitKey(req) {
  const sessionId = getSessionIdFromRequest(req);
  const email = getEmailForSession(sessionId);
  if (email) return `user:${email}`;
  return `ip:${clientIp(req)}`;
}

function getBucket(key) {
  let b = buckets.get(key);
  if (!b) {
    b = { hits: [], burstHits: [], cooldownUntil: 0, abuseScore: 0 };
    buckets.set(key, b);
  }
  return b;
}

function pruneTimestamps(arr, windowMs, t) {
  return arr.filter((ts) => t - ts < windowMs);
}

function cooldownSecondsForAbuse(score) {
  const span = COOLDOWN_MAX_SEC - COOLDOWN_MIN_SEC;
  const factor = Math.min(1, Math.max(0, score / 5));
  return Math.round(COOLDOWN_MIN_SEC + span * factor);
}

/**
 * @returns {Promise<boolean>} true if request was blocked (response sent)
 */
export async function enforceRateLimit(req, res, opts = {}) {
  const route = opts.route || req.path || req.url?.split('?')[0] || 'unknown';
  const traceId = resolveTraceId(req, opts.requestId);
  const key = limitKey(req);
  const ip = clientIp(req);
  const userId = key.startsWith('user:') ? key.slice(5) : null;
  const t = Date.now();
  const bucket = getBucket(key);

  if (bucket.cooldownUntil > t) {
    const retryAfter = Math.ceil((bucket.cooldownUntil - t) / 1000);
    rateLimitDebug(traceId, {
      ip,
      userId,
      route,
      requestCount: bucket.hits.length,
      cooldown: retryAfter,
      blocked: true,
      reason: 'cooldown'
    });
    sendRateLimited(res, retryAfter);
    return true;
  }

  bucket.hits = pruneTimestamps(bucket.hits, WINDOW_MS, t);
  bucket.burstHits = pruneTimestamps(bucket.burstHits, BURST_WINDOW_MS, t);
  bucket.hits.push(t);
  bucket.burstHits.push(t);

  const requestCount = bucket.hits.length;
  const burstCount = bucket.burstHits.length;
  let blocked = false;
  let retryAfter = 0;

  if (burstCount >= BURST_THRESHOLD) {
    bucket.abuseScore = Math.min(10, bucket.abuseScore + 1);
    retryAfter = cooldownSecondsForAbuse(bucket.abuseScore);
    bucket.cooldownUntil = t + retryAfter * 1000;
    blocked = true;
  } else if (requestCount > MAX_REQUESTS) {
    bucket.abuseScore = Math.min(10, bucket.abuseScore + 1);
    retryAfter = cooldownSecondsForAbuse(bucket.abuseScore);
    bucket.cooldownUntil = t + retryAfter * 1000;
    blocked = true;
  } else if (bucket.abuseScore > 0 && burstCount < 2) {
    bucket.abuseScore = Math.max(0, bucket.abuseScore - 1);
  }

  rateLimitDebug(traceId, {
    ip,
    userId,
    route,
    requestCount,
    burstCount,
    cooldown: blocked ? retryAfter : 0,
    blocked
  });

  if (blocked) {
    sendRateLimited(res, retryAfter);
    return true;
  }
  return false;
}

function sendRateLimited(res, retryAfterSec) {
  setCORSHeaders(res);
  res.setHeader('Retry-After', String(retryAfterSec));
  res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    retryAfter: retryAfterSec,
    message: 'Too many requests. Please wait.'
  });
}
