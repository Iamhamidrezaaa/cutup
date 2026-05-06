/**
 * Shared backend enforcement for processing APIs (sessions + billing DB).
 * Standard error shape: { error, code, message }
 */

import { sessions } from './auth.js';
import { setCORSHeaders } from './cors.js';
import { isBillingDbConfigured, applyUsageMinutesAtomic } from './billing-repository.js';
import { canUseFeature } from './subscription.js';
import {
  resolveTraceId,
  sendTranscriptError,
  userMessageForCode,
  retryableForCode
} from './transcript-errors.js';

export function getSessionIdFromRequest(req) {
  const raw = req.headers && (req.headers['x-session-id'] || req.headers['X-Session-Id']);
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  if (fromHeader) return String(fromHeader).trim();
  if (req.query?.session) return String(req.query.session).trim();
  if (req.body && typeof req.body === 'object' && req.body.session) {
    return String(req.body.session).trim();
  }
  return null;
}

export function getEmailForSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || !session.user || !session.user.email) return null;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }
  return session.user.email;
}

export function billingUnavailable(res, req) {
  const traceId = resolveTraceId(req);
  return sendTranscriptError(res, {
    statusCode: 503,
    errorCode: 'PROVIDER_ERROR',
    message: 'Service temporarily unavailable. Please try again shortly.',
    retryable: true,
    traceId,
    stage: 'billing'
  });
}

export function unauthorized(res, code, message, req) {
  const traceId = resolveTraceId(req);
  return sendTranscriptError(res, {
    statusCode: 401,
    errorCode: 'SESSION_EXPIRED',
    message: message || userMessageForCode('SESSION_EXPIRED'),
    retryable: false,
    traceId,
    stage: 'auth'
  });
}

export function planDenied(res, code, message, req) {
  const traceId = resolveTraceId(req);
  const c = String(code || '');
  let errorCode = 'QUOTA_EXCEEDED';
  if (c.includes('FEATURE_NOT_AVAILABLE') || c.includes('INVALID_PLAN')) {
    errorCode = 'PROVIDER_ERROR';
  } else if (c.includes('SUBSCRIPTION_INACTIVE')) {
    errorCode = 'SESSION_EXPIRED';
  }
  return sendTranscriptError(res, {
    statusCode: 403,
    errorCode,
    message: message || userMessageForCode(errorCode),
    retryable: retryableForCode(errorCode),
    traceId,
    stage: 'quota'
  });
}

/** If consumeResult is { ok: false }, sends 403 and returns true. */
export function respondConsumeFailure(res, consumeResult, req) {
  if (!consumeResult || consumeResult.ok) return false;
  const reason = consumeResult.reason || 'Quota exceeded.';
  planDenied(res, classifyDenial(reason), reason, req);
  return true;
}

function classifyDenial(reason) {
  if (!reason) return 'LIMIT_EXCEEDED';
  const r = String(reason);
  if (r.includes('not available on your current plan')) return 'FEATURE_NOT_AVAILABLE';
  if (r.includes('past due') || r.includes('has expired')) return 'SUBSCRIPTION_INACTIVE';
  if (r.includes('Invalid plan')) return 'INVALID_PLAN';
  return 'LIMIT_EXCEEDED';
}

/**
 * @returns {string|null} email or null (response already sent)
 */
export function requireSessionEmail(req, res) {
  if (!isBillingDbConfigured()) {
    billingUnavailable(res, req);
    return null;
  }
  const sid = getSessionIdFromRequest(req);
  if (!sid) {
    unauthorized(res, 'NO_SESSION', 'Sign in is required for this action.', req);
    return null;
  }
  const email = getEmailForSession(sid);
  if (!email) {
    unauthorized(res, 'INVALID_SESSION', 'Your session is invalid or expired. Please sign in again.', req);
    return null;
  }
  return email;
}

/**
 * @returns {Promise<boolean>} true if allowed; false if response already sent
 */
export async function enforceQuota(res, email, feature, minutes, req) {
  if (!isBillingDbConfigured()) {
    billingUnavailable(res, req);
    return false;
  }
  const check = await canUseFeature(email, feature, minutes);
  if (!check.allowed) {
    const reason = check.reason || 'Request denied.';
    if (reason.includes('Billing system unavailable') || reason.includes('DATABASE_URL')) {
      billingUnavailable(res, req);
      return false;
    }
    const code = classifyDenial(reason);
    planDenied(res, code, reason, req);
    return false;
  }
  return true;
}

export function estimateTranscriptionMinutesFromBytes(byteLength) {
  if (!byteLength || byteLength <= 0) return 1;
  const durationSec = (byteLength * 8) / 64000;
  const minutes = Math.ceil(durationSec / 60);
  return Math.max(1, Math.min(720, minutes));
}

/** Bills summarization against the same minute pool (soft proxy for OpenAI cost). */
export function estimateSummarizationBillMinutes(text) {
  const len = text && typeof text === 'string' ? text.length : 0;
  if (len <= 0) return 1;
  return Math.max(1, Math.min(120, Math.ceil(len / 3500)));
}

export function billingMinutesFromWhisperSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 1;
  let maxEnd = 0;
  for (const s of segments) {
    if (s && typeof s.end === 'number' && s.end > maxEnd) maxEnd = s.end;
  }
  const minutes = Math.ceil(maxEnd / 60);
  return Math.max(1, Math.min(720, minutes || 1));
}

export function billingMinutesFromSrtSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 1;
  let maxEnd = 0;
  for (const s of segments) {
    if (s && typeof s.end === 'number' && s.end > maxEnd) maxEnd = s.end;
  }
  const minutes = Math.ceil(maxEnd / 60);
  return Math.max(1, Math.min(720, minutes || 1));
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function consumeTranscriptionUsage(email, minutes, metadata = {}) {
  if (!email || !isBillingDbConfigured() || minutes <= 0) return { ok: true };
  return applyUsageMinutesAtomic(email, minutes, 'transcription', metadata);
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function consumeSummarizationUsage(email, minutes, metadata = {}) {
  if (!email || !isBillingDbConfigured() || minutes <= 0) return { ok: true };
  return applyUsageMinutesAtomic(email, minutes, 'summarization', metadata);
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function consumeSrtUsage(email, minutes, metadata = {}) {
  if (!email || !isBillingDbConfigured() || minutes <= 0) return { ok: true };
  return applyUsageMinutesAtomic(email, minutes, 'srt', metadata);
}
