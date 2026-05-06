/**
 * Standard transcript pipeline API responses (errors + trace IDs).
 */
import crypto from 'crypto';
import { setCORSHeaders } from './cors.js';

export function createTraceId() {
  return `tr_${crypto.randomBytes(6).toString('hex')}`;
}

export function resolveTraceId(req, fallback) {
  const raw =
    req?.headers?.['x-trace-id'] ||
    req?.headers?.['X-Trace-Id'] ||
    req?.headers?.['x-request-id'] ||
    req?.headers?.['X-Request-Id'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && String(v).trim()) return String(v).trim().slice(0, 64);
  return fallback || createTraceId();
}

/**
 * @param {import('express').Response} res
 */
export function sendTranscriptError(
  res,
  {
    statusCode = 500,
    errorCode = 'UNKNOWN_ERROR',
    message = 'Something went wrong.',
    retryable = false,
    traceId,
    stage,
    phase,
    providerDebug
  } = {}
) {
  const tid = traceId || createTraceId();
  const resolvedPhase = phase || stage || null;
  setCORSHeaders(res);
  const body = {
    success: false,
    errorCode,
    message,
    retryable: Boolean(retryable),
    traceId: tid,
    ...(resolvedPhase ? { phase: resolvedPhase, stage: resolvedPhase } : {})
  };
  if (process.env.ADMIN_DEBUG === 'true' && providerDebug != null && typeof providerDebug === 'object') {
    body.debug = { provider: providerDebug };
  }
  console.error(`[trace-failed][${tid}]`, {
    errorCode,
    phase: resolvedPhase,
    statusCode,
    message: String(message || '').slice(0, 200)
  });
  return res.status(statusCode).json(body);
}

export function sendTranscriptSuccess(res, traceId, payload = {}) {
  setCORSHeaders(res);
  const body = { success: true, traceId, ...payload };
  console.log(`[trace-success][${traceId}]`, summarizePayload(payload));
  return res.status(200).json(body);
}

function summarizePayload(payload) {
  const out = {};
  if (payload.text) out.textLength = String(payload.text).length;
  if (payload.segments) out.segments = Array.isArray(payload.segments) ? payload.segments.length : 0;
  if (payload.audioUrl) out.hasAudio = true;
  return out;
}

/** Map billing / legacy codes → canonical errorCode */
export function mapToTranscriptErrorCode(raw, context = {}) {
  const c = String(raw || '').toUpperCase();
  const msg = String(context.message || '').toLowerCase();

  if (c === 'OPENAI_QUOTA_EXCEEDED') return 'OPENAI_QUOTA_EXCEEDED';
  if (c === 'TRANSCRIPTION_FAILED') return 'TRANSCRIPTION_FAILED';
  if (c === 'INVALID_AUDIO') return 'INVALID_AUDIO';

  if (c.includes('LIMIT_EXCEEDED') || (c.includes('QUOTA_EXCEEDED') && !c.includes('OPENAI')) || /included generations|monthly limit/i.test(msg)) {
    return 'QUOTA_EXCEEDED';
  }
  if (c.includes('NO_SESSION') || c.includes('INVALID_SESSION') || c.includes('SESSION_EXPIRED') || c === 'UNAUTHORIZED') {
    return 'SESSION_EXPIRED';
  }
  if (c.includes('SHORTS_PARSE')) {
    return 'SHORTS_PARSE_ERROR';
  }
  if (
    c.includes('UNSUPPORTED') ||
    c.includes('MALFORMED_URL') ||
    c.includes('INVALID_URL') ||
    c.includes('URL_REQUIRED')
  ) {
    return 'INVALID_URL';
  }
  if (c.includes('INSTAGRAM') || c.includes('TIKTOK') || c === 'PLATFORM_ERROR') {
    return 'PLATFORM_ERROR';
  }
  if (c.includes('VIDEO_UNAVAILABLE') || c.includes('MEDIA_UNAVAILABLE')) {
    return 'VIDEO_UNAVAILABLE';
  }
  if (
    c.includes('YOUTUBE') ||
    c.includes('YTDLP') ||
    c.includes('SOCIAL_DOWNLOAD') ||
    c.includes('DOWNLOAD_FAILED') ||
    c.includes('FILE_TOO_LARGE')
  ) {
    if (c.includes('TIMEOUT') || msg.includes('timeout')) return 'TRANSCRIPTION_TIMEOUT';
    return c.includes('FILE_TOO_LARGE') ? 'VIDEO_UNAVAILABLE' : 'DOWNLOAD_FAILED';
  }
  if (c.includes('TIMEOUT') || c.includes('ABORT') || msg.includes('timed out')) {
    return 'TRANSCRIPTION_TIMEOUT';
  }
  if (
    c.includes('ECONNRESET') ||
    c.includes('NETWORK') ||
    c.includes('FETCH') ||
    c.includes('CONNECTION')
  ) {
    return 'NETWORK_ERROR';
  }
  if (
    c.includes('OPENAI') ||
    c.includes('WHISPER') ||
    c.includes('PROVIDER') ||
    c.includes('TRANSCRIBE') ||
    c.includes('UPLOAD_ERROR') ||
    c.includes('INIT_ERROR')
  ) {
    return 'PROVIDER_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

export function retryableForCode(errorCode) {
  switch (errorCode) {
    case 'QUOTA_EXCEEDED':
    case 'OPENAI_QUOTA_EXCEEDED':
    case 'VIDEO_UNAVAILABLE':
    case 'INVALID_URL':
    case 'SHORTS_PARSE_ERROR':
    case 'SESSION_EXPIRED':
    case 'INVALID_AUDIO':
      return false;
    case 'TRANSCRIPTION_FAILED':
      return true;
    case 'DOWNLOAD_FAILED':
    case 'TRANSCRIPTION_TIMEOUT':
    case 'PROVIDER_ERROR':
    case 'NETWORK_ERROR':
    case 'UNKNOWN_ERROR':
    default:
      return true;
  }
}

export function userMessageForCode(errorCode, fallback) {
  switch (errorCode) {
    case 'OPENAI_QUOTA_EXCEEDED':
      return 'Transcription provider is temporarily busy. Trying backup provider…';
    case 'TRANSCRIPTION_FAILED':
      return 'We could not process this video right now. Please try again later.';
    case 'INVALID_AUDIO':
      return 'We could not read this audio. Try another format or a shorter clip.';
    case 'QUOTA_EXCEEDED':
      return "You've reached your monthly limit.";
    case 'VIDEO_UNAVAILABLE':
      return 'This video could not be processed.';
    case 'DOWNLOAD_FAILED':
      return 'The platform temporarily rejected the request.';
    case 'TRANSCRIPTION_TIMEOUT':
    case 'PROVIDER_ERROR':
    case 'UNKNOWN_ERROR':
      return 'We hit a temporary processing issue. Please try again in a few seconds.';
    case 'NETWORK_ERROR':
      return 'Connection issue detected. Please try again.';
    case 'SESSION_EXPIRED':
      return 'Your session expired. Please sign in again and retry.';
    case 'INVALID_URL':
      return 'This link format is not supported yet.';
    case 'SHORTS_PARSE_ERROR':
      return "We couldn't recognize this Shorts link.";
    case 'PLATFORM_ERROR':
      return "We couldn't access this video.";
    case 'TRANSLATION_UNAVAILABLE':
      return 'Translation is temporarily unavailable. Please try again in a few minutes.';
    case 'TRANSLATION_TIMEOUT':
      return 'Translation timed out. Please try again.';
    case 'TRANSLATION_PROVIDER_UNAVAILABLE':
      return 'Translation service is not configured. Please contact support.';
    default:
      return fallback || 'We hit a temporary processing issue. Please try again in a few seconds.';
  }
}

/** Map legacy / platform-specific codes to canonical errorCode + user message */
export function mapLegacyDownloadError(legacyCode, { message, platform } = {}) {
  const c = String(legacyCode || '').toUpperCase();
  const msg = String(message || '').toLowerCase();
  if (c === 'SHORTS_PARSE_ERROR' || c === 'UNSUPPORTED_YOUTUBE_URL' && /shorts/.test(msg)) {
    return { errorCode: 'SHORTS_PARSE_ERROR', message: userMessageForCode('SHORTS_PARSE_ERROR') };
  }
  if (
    c.includes('UNSUPPORTED') ||
    c.includes('MALFORMED') ||
    c.includes('INVALID_URL') ||
    c === 'URL_REQUIRED'
  ) {
    return { errorCode: 'INVALID_URL', message: userMessageForCode('INVALID_URL') };
  }
  if (c.includes('TIMEOUT') || c === 'YTDLP_TIMEOUT') {
    return { errorCode: 'TRANSCRIPTION_TIMEOUT', message: userMessageForCode('TRANSCRIPTION_TIMEOUT'), retryable: true };
  }
  if (c.includes('PRIVATE') || c.includes('UNAVAILABLE') || c === 'MEDIA_UNAVAILABLE') {
    return { errorCode: 'VIDEO_UNAVAILABLE', message: userMessageForCode('VIDEO_UNAVAILABLE') };
  }
  if (c.includes('LOGIN') || c.includes('COOKIE') || c === 'SOCIAL_LOGIN_REQUIRED') {
    return {
      errorCode: 'PLATFORM_ERROR',
      message:
        platform === 'instagram'
          ? 'Instagram Stories are not publicly downloadable. Please use a Reel or Post URL.'
          : userMessageForCode('PLATFORM_ERROR')
    };
  }
  if (c.includes('INSTAGRAM') || c.includes('TIKTOK') || c.includes('YTDLP') || c.includes('DOWNLOAD')) {
    return { errorCode: 'DOWNLOAD_FAILED', message: userMessageForCode('DOWNLOAD_FAILED'), retryable: true };
  }
  return { errorCode: 'DOWNLOAD_FAILED', message: userMessageForCode('DOWNLOAD_FAILED'), retryable: true };
}

export function sendTranscriptErrorFromLegacy(
  res,
  { statusCode = 500, legacyCode, message, traceId, stage, phase, retryable }
) {
  const errorCode = mapToTranscriptErrorCode(legacyCode, { message });
  return sendTranscriptError(res, {
    statusCode,
    errorCode,
    message: message || userMessageForCode(errorCode),
    retryable: retryable != null ? retryable : retryableForCode(errorCode),
    traceId,
    stage,
    phase: phase || stage
  });
}
