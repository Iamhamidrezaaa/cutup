import {
  AllProvidersFailedError,
  TranscriptionProviderError,
  isFailoverEligibleError,
  isNonFailoverClientFailure
} from './errors.js';
import {
  isProviderTemporarilyDisabled,
  recordProviderFailure,
  recordProviderSuccess,
  logProviderStart,
  logProviderSuccess,
  logProviderFailed,
  logProviderFallbackAttempt,
  logProviderFallbackFinal,
  logProviderHealth
} from './provider-health.js';
import { transcribeOpenAi, OPENAI_PROVIDER_ID } from './providers/openai-provider.js';
import { transcribeGroq, GROQ_PROVIDER_ID } from './providers/groq-provider.js';
import { transcribeDeepgram, DEEPGRAM_PROVIDER_ID } from './providers/deepgram-provider.js';
import { transcribeLocalWhisper, LOCAL_WHISPER_PROVIDER_ID } from './providers/local-whisper-provider.js';
import { assertGpuOrCpuFallback } from '../infrastructure/gpu-guard.js';
import { transcribeDebug } from '../infrastructure/observability.js';
import { ensureTranscriptionProvidersInit } from './init.js';
import {
  TRANSCRIPTION_PROVIDER_ORDER,
  getRuntimeTranscriptionCandidates,
  getRuntimeFallbackProviders,
  isTranscriptionProviderConfigured,
  refreshTranscriptionProviderRegistry
} from './registry.js';

export {
  TRANSCRIPTION_PROVIDER_ORDER,
  isTranscriptionProviderConfigured,
  getRuntimeFallbackProviders
};

export { listConfiguredTranscriptionProviders } from './registry.js';

/**
 * Invoke a provider by id — never throw ReferenceError (broken re-exports crash failover).
 * @returns {Promise<object|null>} null if id unknown
 */
async function invokeProviderById(id, ctx) {
  try {
    switch (id) {
      case OPENAI_PROVIDER_ID:
        return await transcribeOpenAi(ctx);
      case GROQ_PROVIDER_ID:
        return await transcribeGroq(ctx);
      case DEEPGRAM_PROVIDER_ID:
        return await transcribeDeepgram(ctx);
      case LOCAL_WHISPER_PROVIDER_ID: {
        const gpu = await assertGpuOrCpuFallback(ctx.traceId, { allowCpuFallback: true });
        if (gpu.forceCpu) {
          transcribeDebug(ctx.traceId, {
            phase: 'gpu_skip_local_whisper',
            reason: gpu.reason || 'gpu_busy',
            forceCpu: true
          });
          return null;
        }
        return await transcribeLocalWhisper(ctx);
      }
      default:
        console.warn('[transcription-router] unknown_provider', { id, traceId: ctx.traceId });
        return null;
    }
  } catch (err) {
    if (err instanceof ReferenceError || /is not defined/i.test(String(err?.message || ''))) {
      console.error('[transcription-router] provider_reference_error', {
        provider: id,
        message: err.message,
        traceId: ctx.traceId
      });
      throw new TranscriptionProviderError('PROVIDER_UNAVAILABLE', `Provider ${id} failed to load`, {
        providerId: id,
        failoverEligible: true,
        details: { cause: err.message }
      });
    }
    throw err;
  }
}

function summarizeFailureKind(err) {
  if (!err) return 'generic';
  if (/** @type {{ name?: string }} */ (err).name === 'QuotaError') return 'quota';
  if (/** @type {{ name?: string }} */ (err).name === 'OpenAiRateLimitError') return 'rate_limit';
  if (/timeout|timed out/i.test(String(/** @type {{ message?: string }} */ (err).message))) return 'timeout';
  return 'generic';
}

function wrapFatal(err, providerId) {
  const httpStatus = Number(
    /** @type {{ status?: number }} */ (err).status ??
      /** @type {{ httpStatus?: number }} */ (err).httpStatus ??
      NaN
  );
  const msg = String(/** @type {{ message?: string }} */ (err).message || '');
  if (err instanceof TranscriptionProviderError && err.failoverEligible === false) {
    return err;
  }
  const badMedia =
    Number.isFinite(httpStatus) && isNonFailoverClientFailure(httpStatus, msg);
  const code = badMedia ? 'INVALID_AUDIO' : 'TRANSCRIPTION_FAILED';
  return new TranscriptionProviderError(code, msg || code, {
    providerId,
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
    failoverEligible: false,
    details: { wrapped: String(err?.name || 'Error') }
  });
}

/**
 * Run transcription with automatic provider failover (server-side only).
 */
export async function transcribeWithRouter(ctx) {
  ensureTranscriptionProvidersInit();
  const { fetch: fetchFn, traceId, audioBuffer, mimeType, extension, languageHint } = ctx;

  const candidates = getRuntimeTranscriptionCandidates(traceId);
  const fallbackProviders = getRuntimeFallbackProviders(traceId);

  logProviderHealth({
    traceId,
    event: 'router_begin',
    candidates,
    fallbackProviders,
    order: [...TRANSCRIPTION_PROVIDER_ORDER]
  });

  if (candidates.length === 0) {
    refreshTranscriptionProviderRegistry('router_empty_candidates');
    const retryCandidates = getRuntimeTranscriptionCandidates(traceId);
    if (retryCandidates.length === 0) {
      throw new TranscriptionProviderError(
        'PROVIDER_UNAVAILABLE',
        'No transcription providers configured (set OPENAI_API_KEY, GROQ_API_KEY, and/or DEEPGRAM_API_KEY)',
        { failoverEligible: false, details: { traceId } }
      );
    }
  }

  const runtimeCandidates = candidates.length > 0 ? candidates : getRuntimeTranscriptionCandidates(traceId);

  /** @type {Error|null} */
  let lastError = null;
  let lastProviderId = null;
  /** @type {string[]} */
  const attemptedProviders = [];

  for (let i = 0; i < runtimeCandidates.length; i++) {
    const id = runtimeCandidates[i];

    if (isProviderTemporarilyDisabled(id)) {
      console.log('[provider-disabled]', JSON.stringify({ traceId, provider: id, reason: 'cooldown' }));
      lastError = lastError || new Error(`${id}_cooldown`);
      continue;
    }

    const t0 = Date.now();
    logProviderStart({ traceId, provider: id });
    attemptedProviders.push(id);

    try {
      const result = await invokeProviderById(id, {
        fetch: fetchFn,
        audioBuffer,
        mimeType,
        extension,
        languageHint: languageHint || null,
        traceId
      });
      if (result == null) continue;

      recordProviderSuccess(id);
      logProviderSuccess({
        traceId,
        provider: id,
        durationMs: Date.now() - t0,
        segmentCount: Array.isArray(result.segments) ? result.segments.length : 0,
        textChars: result.text ? String(result.text).length : 0
      });
      return result;
    } catch (err) {
      recordProviderFailure(id, summarizeFailureKind(err));
      const msg = String(/** @type {{ message?: string }} */ (err).message || err);
      const httpStatus = Number(
        /** @type {{ status?: number }} */ (err).status ??
          /** @type {{ response?: { status?: number } }} */ (err).response?.status ??
          /** @type {{ httpStatus?: number }} */ (err).httpStatus ??
          NaN
      );

      logProviderFailed({
        traceId,
        provider: id,
        durationMs: Date.now() - t0,
        errorCode: /** @type {{ name?: string }} */ (err).name || /** @type {{ code?: string }} */ (err).code || 'ERROR',
        httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined,
        message: msg.slice(0, 280)
      });

      lastError = /** @type {Error} */ (err);
      lastProviderId = id;

      const eligible =
        isFailoverEligibleError(err) &&
        !(Number.isFinite(httpStatus) && isNonFailoverClientFailure(httpStatus, msg));

      if (!eligible) {
        throw wrapFatal(err, id);
      }

      const nextIdx = runtimeCandidates.findIndex((c, idx) => idx > i && !isProviderTemporarilyDisabled(c));
      const nextProvider = nextIdx !== -1 ? runtimeCandidates[nextIdx] : null;
      const runtimeFallback = getRuntimeFallbackProviders(traceId);

      logProviderFallbackAttempt({
        traceId,
        from: id,
        to: nextProvider,
        reason: /** @type {{ name?: string }} */ (err).name || 'failover',
        candidates: [...runtimeCandidates],
        fallbackProviders: runtimeFallback
      });

      if (nextIdx === -1) {
        break;
      }
    }
  }

  const finalFallback = getRuntimeFallbackProviders(traceId);
  logProviderFallbackFinal({
    traceId,
    lastProvider: lastProviderId,
    candidates: [...runtimeCandidates],
    fallbackProviders: finalFallback,
    lastError: String(lastError?.message || '').slice(0, 280)
  });

  throw new AllProvidersFailedError(lastError, traceId, {
    attemptedProviders,
    lastProviderId
  });
}

/**
 * User-facing message when every provider failed (OpenAI-first policy).
 */
export function messageForAllProvidersFailed(err, registry = null) {
  const last = err?.lastError;
  const lastMsg = String(last?.message || '');
  const attempted = err?.attemptedProviders || [];
  const active = registry?.activeProviders ? [...registry.activeProviders] : [];
  const fallbacks = registry?.fallbackProviders ? [...registry.fallbackProviders] : [];
  const quotaLike =
    last?.name === 'QuotaError' || /insufficient_quota|quota exceeded|billing/i.test(lastMsg);

  if (quotaLike && attempted.length === 1 && attempted[0] === OPENAI_PROVIDER_ID && fallbacks.length > 0) {
    return 'High demand detected. We switched transcription engines — please try again in a moment.';
  }
  if (quotaLike && fallbacks.length === 0) {
    return (
      'High demand on our primary engine. Add a backup API key (GROQ_API_KEY or DEEPGRAM_API_KEY) on the server for automatic failover.'
    );
  }
  if (quotaLike && attempted.length > 1) {
    return 'We tried alternative transcription engines but could not finish this clip. Please retry shortly.';
  }
  if (/GROQ_PROVIDER_ID|DEEPGRAM_PROVIDER_ID|is not defined/i.test(lastMsg)) {
    return 'A transcription provider was misconfigured on the server. The failover chain has been repaired — please retry.';
  }
  if (active.length === 0) {
    return 'No transcription providers are configured. Set OPENAI_API_KEY on the server.';
  }
  if (attempted.length > 1) {
    return 'Still working through backup transcription engines. If this persists, try again in a few minutes.';
  }
  return 'We could not finish transcription right now. Please try again — your link is saved.';
}

/**
 * Same as router but returns the legacy shape used by /api/transcribe and /api/upload.
 */
export async function transcribeAudioPayload(ctx) {
  const r = await transcribeWithRouter(ctx);
  return {
    text: r.text,
    segments: Array.isArray(r.segments) ? r.segments : [],
    language: r.language || 'unknown',
    languageConfidence: r.languageConfidence,
    confidence: r.languageConfidence ?? r.confidence,
    provider: r.provider || null
  };
}
