/**
 * Transcription provider abstraction (primary = Groq Whisper Large V3).
 */

import { getRuntimeFallbackProviders } from './transcription/registry.js';
import { PRIMARY_TRANSCRIPTION_PROVIDER_ID } from './transcription/provider-ids.js';

export const TRANSCRIPTION_PROVIDER_OPENAI = 'openai-whisper';

/** Env override or frozen registry primary (Groq whisper-large-v3). */
export function getPrimaryTranscriptionProviderId() {
  const id = String(process.env.TRANSCRIPTION_PROVIDER || '').trim();
  return id || PRIMARY_TRANSCRIPTION_PROVIDER_ID;
}

const MIN_PROVIDER_KEY_LEN = 10;

/** Active backup providers — always from frozen registry / env rebuild (never legacy TRANSCRIPTION_FALLBACK_* flags). */
export function listConfiguredTranscriptionFallbacks() {
  return [...getRuntimeFallbackProviders(null)];
}

/**
 * Classify OpenAI /v1/audio/transcriptions HTTP failures.
 * @param {number} status HTTP status
 * @param {object|null} parsed JSON body or null
 */
export function classifyOpenAiTranscriptionFailure(status, parsed) {
  const errObj = parsed && typeof parsed === 'object' ? parsed.error || parsed : {};
  const code = String(errObj.code || '').toLowerCase();
  const msg = String(errObj.message || '').toLowerCase();

  const isBillingQuota =
    code === 'insufficient_quota' ||
    code === 'billing_hard_limit_reached' ||
    (status === 429 &&
      (msg.includes('insufficient_quota') ||
        msg.includes('billing_hard_limit') ||
        ((msg.includes('quota') || msg.includes('billing')) &&
          (msg.includes('exceeded') || msg.includes('limit') || msg.includes('deactivated')))));

  if (isBillingQuota) {
    return {
      category: 'quota',
      retryable: false,
      httpStatus: status || 429,
      openaiCode: errObj.code || null,
      rawMessage: String(errObj.message || '').trim()
    };
  }

  if (status === 429) {
    return {
      category: 'rate_limit',
      retryable: true,
      httpStatus: status,
      openaiCode: errObj.code || null,
      rawMessage: String(errObj.message || '').trim()
    };
  }

  return {
    category: 'other',
    retryable: status >= 500 || status === 408,
    httpStatus: status,
    openaiCode: errObj.code || null,
    rawMessage: String(errObj.message || '').trim()
  };
}

export function createQuotaError(rawMessage, httpStatus, openaiCode) {
  const e = new Error(rawMessage || 'OpenAI quota exceeded');
  e.name = 'QuotaError';
  e.status = httpStatus || 429;
  e.openaiCode = openaiCode || null;
  return e;
}
