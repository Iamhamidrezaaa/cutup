/**
 * ASR V2 — clean speech-to-text path.
 * Audio → Groq whisper-large-v3 → (fallback OpenAI whisper-1) → raw output → clean SRT.
 * No GPT correction, timing refinement, merge, or integrity mutation.
 */
import { transcribeGroq, GROQ_PROVIDER_ID } from './providers/groq-provider.js';
import { transcribeOpenAi, OPENAI_PROVIDER_ID } from './providers/openai-provider.js';
import {
  GROQ_WHISPER_MODEL,
  OPENAI_WHISPER_MODEL
} from './provider-ids.js';
import { transcribeLargeFile } from '../chunk-processor.js';
import { isFailoverEligibleError } from './errors.js';

const V2_PROVIDER_ORDER = [GROQ_PROVIDER_ID, OPENAI_PROVIDER_ID];

const V2_MODELS = Object.freeze({
  [GROQ_PROVIDER_ID]: GROQ_WHISPER_MODEL,
  [OPENAI_PROVIDER_ID]: OPENAI_WHISPER_MODEL
});

/** @returns {'v1'|'v2'} */
export function getAsrPipelineVersion() {
  const raw = String(process.env.ASR_PIPELINE || 'v2').trim().toLowerCase();
  return raw === 'v1' ? 'v1' : 'v2';
}

export function isAsrPipelineV2() {
  return getAsrPipelineVersion() === 'v2';
}

/**
 * Deep-copy provider payload without rewriting text or timestamps.
 * @param {object} providerResult
 * @param {string} providerId
 */
export function preserveProviderOutput(providerResult, providerId) {
  const raw = providerResult?.asrCapture?.rawResponse || providerResult || {};
  const segments = Array.isArray(raw.segments)
    ? JSON.parse(JSON.stringify(raw.segments))
    : Array.isArray(providerResult?.segments)
      ? JSON.parse(JSON.stringify(providerResult.segments))
      : [];

  let words = [];
  if (Array.isArray(raw.words) && raw.words.length) {
    words = JSON.parse(JSON.stringify(raw.words));
  } else {
    for (const seg of segments) {
      if (Array.isArray(seg?.words)) {
        words.push(...JSON.parse(JSON.stringify(seg.words)));
      }
    }
  }

  return {
    text: String(raw.text ?? providerResult?.text ?? ''),
    segments,
    words,
    language: String(raw.language ?? providerResult?.language ?? 'unknown'),
    provider: providerId,
    model: V2_MODELS[providerId] || null,
    durationSeconds: providerResult?.durationSeconds ?? null
  };
}

function padSrt(n) {
  return String(n).padStart(2, '0');
}

function formatSrtTimestamp(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '00:00:00,000';
  const totalMs = Math.round(n * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${padSrt(h)}:${padSrt(m)}:${padSrt(s)},${String(ms).padStart(3, '0')}`;
}

/**
 * Format-only SRT from raw provider segments (no text or timing mutation).
 * @param {Array<{ start?: number, end?: number, text?: string }>} segments
 */
export function segmentsToCleanSrt(segments) {
  const list = Array.isArray(segments) ? segments : [];
  return list
    .map((seg, i) => {
      const text = String(seg?.text ?? '');
      const start = formatSrtTimestamp(seg?.start ?? 0);
      const end = formatSrtTimestamp(seg?.end ?? 0);
      return `${i + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

function summarizeProviderFailure(err) {
  return {
    name: err?.name || 'Error',
    message: String(err?.message || err).slice(0, 300),
    status: err?.status ?? err?.httpStatus ?? null
  };
}

/**
 * V2 transcription: Groq primary, OpenAI fallback only.
 */
export async function transcribeAsrV2(ctx) {
  const { fetch, audioBuffer, mimeType, extension, languageHint, traceId } = ctx;
  const failures = [];

  for (const providerId of V2_PROVIDER_ORDER) {
    try {
      const invoke =
        providerId === GROQ_PROVIDER_ID
          ? transcribeGroq
          : providerId === OPENAI_PROVIDER_ID
            ? transcribeOpenAi
            : null;
      if (!invoke) continue;

      console.log('[asr-v2]', { traceId, phase: 'provider_start', providerId });
      const result = await invoke({
        fetch,
        audioBuffer,
        mimeType,
        extension,
        languageHint,
        traceId
      });
      const preserved = preserveProviderOutput(result, providerId);
      console.log('[asr-v2]', {
        traceId,
        phase: 'provider_ok',
        providerId,
        segmentCount: preserved.segments.length,
        wordCount: preserved.words.length
      });
      return {
        ...preserved,
        success: true,
        asrPipeline: 'v2',
        cleanSrt: segmentsToCleanSrt(preserved.segments)
      };
    } catch (err) {
      const summary = summarizeProviderFailure(err);
      failures.push({ providerId, ...summary });
      console.warn('[asr-v2]', { traceId, phase: 'provider_failed', providerId, ...summary });
      if (!isFailoverEligibleError(err)) {
        const fatal = new Error(summary.message || 'ASR V2 failed');
        fatal.name = err?.name || 'TranscriptionProviderError';
        fatal.status = summary.status;
        fatal.attemptedProviders = failures.map((f) => f.providerId);
        fatal.lastProviderId = providerId;
        throw fatal;
      }
    }
  }

  const e = new Error('ASR V2: all providers failed (Groq, OpenAI)');
  e.name = 'AllProvidersFailedError';
  e.attemptedProviders = failures.map((f) => f.providerId);
  e.lastProviderId = failures.length ? failures[failures.length - 1].providerId : null;
  e.lastError = failures.length ? new Error(failures[failures.length - 1].message) : null;
  throw e;
}

/**
 * Route transcription step to V2 or legacy V1 router callback.
 * @param {object} ctx
 * @param {(buf: Buffer, mt: string, ext: string, hint?: string|null) => Promise<object>} v1TranscribeOne
 */
export async function transcribeForPipeline(ctx, v1TranscribeOne) {
  if (!isAsrPipelineV2()) {
    return v1TranscribeOne(ctx.audioBuffer, ctx.mimeType, ctx.extension, ctx.languageHint);
  }

  const transcribeOne = (buf, mt, ext, hint) =>
    transcribeAsrV2({
      ...ctx,
      audioBuffer: buf,
      mimeType: mt,
      extension: ext,
      languageHint: hint !== undefined ? hint : ctx.languageHint
    });

  if (ctx.audioBuffer.length > 25 * 1024 * 1024) {
    const chunkResult = await transcribeLargeFile(ctx.audioBuffer, ctx.mimeType, ctx.extension, transcribeOne);
    const preserved = preserveProviderOutput(chunkResult, chunkResult.provider || GROQ_PROVIDER_ID);
    return {
      ...preserved,
      success: true,
      asrPipeline: 'v2',
      cleanSrt: segmentsToCleanSrt(preserved.segments),
      chunking: chunkResult.chunking || null
    };
  }

  return transcribeAsrV2(ctx);
}

/**
 * Finalize V2 transcript for API response — pass-through only.
 */
export function finalizeV2Transcript(transcript) {
  const preserved = transcript?.asrPipeline === 'v2'
    ? {
        text: transcript.text,
        segments: transcript.segments,
        words: transcript.words || [],
        language: transcript.language,
        provider: transcript.provider,
        model: transcript.model
      }
    : preserveProviderOutput(transcript, transcript?.provider || GROQ_PROVIDER_ID);

  return {
    text: preserved.text,
    segments: preserved.segments,
    words: preserved.words,
    language: preserved.language,
    provider: preserved.provider,
    model: preserved.model,
    cleanSrt: segmentsToCleanSrt(preserved.segments),
    asrPipeline: 'v2'
  };
}

/**
 * First 50 segments exactly as provider returned (for debug endpoint).
 */
export function formatRawAsrDebugPayload(transcript) {
  const segs = Array.isArray(transcript?.segments) ? transcript.segments : [];
  return {
    provider: transcript?.provider || null,
    model: transcript?.model || null,
    language: transcript?.language || null,
    segment_count: segs.length,
    first_50_segments: segs.slice(0, 50).map((s) => ({
      start: s?.start ?? null,
      end: s?.end ?? null,
      text: String(s?.text ?? '')
    }))
  };
}
