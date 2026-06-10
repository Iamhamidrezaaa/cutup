/**
 * Lightweight runtime metadata returned with completed transcriptions.
 */
import {
  TRANSCRIPTION_PROVIDER_MODELS,
  OPENAI_PROVIDER_ID,
  GROQ_PROVIDER_ID,
  DEEPGRAM_PROVIDER_ID,
  LOCAL_WHISPER_PROVIDER_ID
} from './provider-ids.js';

const PROVIDER_LABELS = Object.freeze({
  [GROQ_PROVIDER_ID]: 'Groq',
  [OPENAI_PROVIDER_ID]: 'OpenAI',
  [DEEPGRAM_PROVIDER_ID]: 'Deepgram',
  [LOCAL_WHISPER_PROVIDER_ID]: 'Local Whisper',
  youtube: 'YouTube captions',
  cache: 'Cached transcript'
});

export function resolveTranscriptionProviderLabel(providerId) {
  const id = String(providerId || '').trim();
  return PROVIDER_LABELS[id] || (id ? id : null);
}

export function resolveTranscriptionModel(providerId) {
  const id = String(providerId || '').trim();
  if (!id) return null;
  if (id === 'youtube') return 'manual';
  if (id === 'cache') return null;
  return TRANSCRIPTION_PROVIDER_MODELS[id] || null;
}

export function audioDurationFromSegments(segments, fallbackSec = null) {
  const list = Array.isArray(segments) ? segments : [];
  const ends = list
    .map((s) => Number(s?.end))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ends.length) {
    return Number(Math.max(...ends).toFixed(3));
  }
  const fb = Number(fallbackSec);
  return Number.isFinite(fb) && fb > 0 ? Number(fb.toFixed(3)) : null;
}

/**
 * @param {{ providerId?: string|null, transcriptionDurationMs?: number|null, audioDurationSec?: number|null, fromCache?: boolean }} opts
 */
export function buildTranscriptionRuntime(opts = {}) {
  const fromCache = Boolean(opts.fromCache);
  const providerId = fromCache ? 'cache' : opts.providerId || null;
  const model = fromCache ? null : resolveTranscriptionModel(providerId);
  const transcriptionDurationMs = Number.isFinite(Number(opts.transcriptionDurationMs))
    ? Math.max(0, Math.round(Number(opts.transcriptionDurationMs)))
    : null;
  const audioDurationSec = Number.isFinite(Number(opts.audioDurationSec))
    ? Number(Number(opts.audioDurationSec).toFixed(3))
    : null;

  return {
    provider: providerId,
    providerLabel: resolveTranscriptionProviderLabel(providerId),
    model,
    transcriptionDurationMs,
    audioDurationSec,
    fromCache
  };
}
