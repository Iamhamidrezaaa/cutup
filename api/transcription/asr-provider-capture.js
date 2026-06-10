/**
 * ASR provider request metadata + raw response capture (diagnostics only).
 */
import {
  OPENAI_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
} from './provider-ids.js';

export const ASR_BACKEND_LABELS = Object.freeze({
  [OPENAI_PROVIDER_ID]: 'OpenAI Whisper API',
  [GROQ_PROVIDER_ID]: 'Groq Whisper API (OpenAI-compatible)',
  [DEEPGRAM_PROVIDER_ID]: 'Deepgram API',
  [LOCAL_WHISPER_PROVIDER_ID]: 'Local Whisper (whisper.cpp)'
});

export const ASR_ENGINE_FAMILY = Object.freeze({
  [OPENAI_PROVIDER_ID]: 'whisper-api',
  [GROQ_PROVIDER_ID]: 'faster-whisper-compatible',
  [DEEPGRAM_PROVIDER_ID]: 'deepgram',
  [LOCAL_WHISPER_PROVIDER_ID]: 'whisper-cpp'
});

const DEFAULT_TIMEOUT_MS = 180000;

export function resolveBackendLabel(providerId) {
  return ASR_BACKEND_LABELS[providerId] || 'Other';
}

export function buildWhisperCompatibleRequestParams({ model, languageHint, providerId }) {
  return {
    backend: resolveBackendLabel(providerId),
    providerId,
    engineFamily: ASR_ENGINE_FAMILY[providerId] || 'other',
    model,
    language: languageHint || null,
    prompt: null,
    temperature: null,
    beamSize: null,
    vadEnabled: false,
    chunkSizeBytes: null,
    wordTimestampsEnabled: true,
    segmentTimestampsEnabled: true,
    responseFormat: 'verbose_json',
    timestampGranularities: ['word', 'segment'],
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
}

export function buildDeepgramRequestParams({ languageHint }) {
  return {
    backend: resolveBackendLabel(DEEPGRAM_PROVIDER_ID),
    providerId: DEEPGRAM_PROVIDER_ID,
    engineFamily: ASR_ENGINE_FAMILY[DEEPGRAM_PROVIDER_ID],
    model: 'nova-3',
    language: languageHint || null,
    prompt: null,
    temperature: null,
    beamSize: null,
    vadEnabled: false,
    chunkSizeBytes: null,
    wordTimestampsEnabled: true,
    segmentTimestampsEnabled: true,
    smartFormat: true,
    utterances: true,
    punctuate: true,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
}

export function buildLocalWhisperRequestParams() {
  return {
    backend: resolveBackendLabel(LOCAL_WHISPER_PROVIDER_ID),
    providerId: LOCAL_WHISPER_PROVIDER_ID,
    engineFamily: ASR_ENGINE_FAMILY[LOCAL_WHISPER_PROVIDER_ID],
    model: process.env.WHISPER_LOCAL_MODEL || 'not-configured',
    language: null,
    prompt: null,
    temperature: null,
    beamSize: null,
    vadEnabled: process.env.WHISPER_LOCAL_VAD === 'true',
    chunkSizeBytes: null,
    wordTimestampsEnabled: true,
    segmentTimestampsEnabled: true,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };
}

/**
 * Clone raw provider JSON for artifact storage (full body before Cutup processing).
 */
export function cloneRawProviderResponse(raw) {
  try {
    return JSON.parse(JSON.stringify(raw ?? null));
  } catch {
    return { _captureError: 'failed_to_clone_raw_response' };
  }
}

export function buildAsrCapture({ providerId, requestParams, rawResponse, durationMs, httpStatus = 200 }) {
  return {
    providerId,
    backend: resolveBackendLabel(providerId),
    engineFamily: ASR_ENGINE_FAMILY[providerId] || 'other',
    model: requestParams?.model || null,
    requestParams,
    rawResponse: cloneRawProviderResponse(rawResponse),
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    httpStatus,
    capturedAt: new Date().toISOString()
  };
}
