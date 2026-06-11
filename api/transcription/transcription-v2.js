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
import { fillTimelineGapsWithRetranscription } from './asr-gap-fill.js';
import { sanitizeTranscriptSegments } from '../video-render/non-speech-tags.js';

const V2_PROVIDER_ORDER = [GROQ_PROVIDER_ID, OPENAI_PROVIDER_ID];

const V2_MODELS = Object.freeze({
  [GROQ_PROVIDER_ID]: GROQ_WHISPER_MODEL,
  [OPENAI_PROVIDER_ID]: OPENAI_WHISPER_MODEL
});

const WORD_GAP_MIN_SEC = 0.45;
const WORD_GROUP_PAUSE_SEC = 0.42;

function wordText(w) {
  return String(w?.word ?? w?.text ?? '').trim();
}

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
    words = collectProviderWords([], segments);
  }

  const timeline = resolveV2SegmentTimeline(segments, words);

  return {
    text: String(raw.text ?? providerResult?.text ?? ''),
    segments: timeline.segments,
    words,
    language: String(raw.language ?? providerResult?.language ?? 'unknown'),
    provider: providerId,
    model: V2_MODELS[providerId] || null,
    durationSeconds: providerResult?.durationSeconds ?? null,
    segmentSource: timeline.segmentSource,
    wordGapFill: timeline.wordGapFill
  };
}

/** Collect provider words from top-level or nested segment.words (deduped). */
export function collectProviderWords(topLevelWords, segments) {
  const seen = new Set();
  const out = [];
  const push = (w) => {
    const text = wordText(w);
    const ws = Number(w?.start);
    const we = Number(w?.end);
    if (!text || !Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) return;
    const key = `${ws.toFixed(3)}|${we.toFixed(3)}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(JSON.parse(JSON.stringify(w)));
  };
  if (Array.isArray(topLevelWords)) {
    for (const w of topLevelWords) push(w);
  }
  for (const seg of segments || []) {
    if (Array.isArray(seg?.words)) {
      for (const w of seg.words) push(w);
    }
  }
  return out.sort((a, b) => Number(a.start) - Number(b.start));
}

function countTokensInSegments(segments) {
  return (segments || []).reduce((n, s) => {
    const t = String(s?.text || '').trim();
    if (!t) return n;
    return n + t.split(/\s+/).filter(Boolean).length;
  }, 0);
}

function largestSegmentGapSec(segments) {
  const sorted = [...(segments || [])].sort((a, b) => Number(a.start) - Number(b.start));
  let max = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = Number(sorted[i + 1].start) - Number(sorted[i].end);
    if (gap > max) max = gap;
  }
  return max;
}

/**
 * V2 segment timeline: prefer provider word timestamps when segment stream has holes.
 */
export function resolveV2SegmentTimeline(rawSegments, words) {
  const segments = Array.isArray(rawSegments) ? JSON.parse(JSON.stringify(rawSegments)) : [];
  const wordList = Array.isArray(words) && words.length
    ? words
    : collectProviderWords([], segments);

  if (!wordList.length) {
    return {
      segments,
      segmentSource: 'provider_segments_only',
      wordGapFill: { mode: 'none', inserted: 0, wordCount: 0, maxSegmentGapSec: largestSegmentGapSec(segments) }
    };
  }

  const maxGap = largestSegmentGapSec(segments);
  const wordSegments = groupProviderWordsByPause(wordList);
  const wordTokens = wordList.length;
  const segTokens = countTokensInSegments(segments);

  const useWordPrimary =
    maxGap >= WORD_GAP_MIN_SEC ||
    wordSegments.length > segments.length + 1 ||
    wordTokens > segTokens + 2;

  if (useWordPrimary) {
    return {
      segments: wordSegments,
      segmentSource: 'provider_words',
      wordGapFill: {
        mode: 'word_primary',
        inserted: wordSegments.length,
        providerSegmentCount: segments.length,
        maxSegmentGapSec: Number(maxGap.toFixed(3)),
        wordCount: wordList.length
      }
    };
  }

  const reconciled = reconcileSegmentsWithProviderWords(segments, wordList);
  return {
    segments: reconciled.segments,
    segmentSource: 'provider_segments_plus_gap_fill',
    wordGapFill: reconciled.wordGapFill
  };
}

export function findUncoveredProviderWords(segments, words) {
  const segs = Array.isArray(segments) ? segments : [];
  const list = Array.isArray(words) ? words : [];
  return list.filter((w) => {
    const text = wordText(w);
    const ws = Number(w?.start);
    const we = Number(w?.end);
    if (!text || !Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) return false;
    const mid = (ws + we) / 2;
    return !segs.some((seg) => {
      const ss = Number(seg?.start);
      const se = Number(seg?.end);
      return Number.isFinite(ss) && Number.isFinite(se) && mid >= ss && mid <= se;
    });
  });
}

/** Group provider words by natural pause gaps — uses provider timestamps only. */
export function groupProviderWordsByPause(words, pauseSec = WORD_GROUP_PAUSE_SEC) {
  const sorted = [...(words || [])]
    .filter((w) => wordText(w) && Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
    .sort((a, b) => Number(a.start) - Number(b.start));

  const groups = [];
  let bucket = [];

  function flush() {
    if (!bucket.length) return;
    const text = bucket.map(wordText).join(' ').trim();
    if (!text) {
      bucket = [];
      return;
    }
    groups.push({
      start: Number(bucket[0].start),
      end: Number(bucket[bucket.length - 1].end),
      text,
      words: bucket.map((w) => ({ ...w })),
      fromProviderWords: true
    });
    bucket = [];
  }

  for (const w of sorted) {
    if (!bucket.length) {
      bucket.push(w);
      continue;
    }
    const prev = bucket[bucket.length - 1];
    const gap = Number(w.start) - Number(prev.end);
    if (gap > pauseSec) {
      flush();
    }
    bucket.push(w);
  }
  flush();
  return groups;
}

/**
 * When Whisper segments skip audio but word timestamps exist, insert word-only cues.
 * Does not modify existing segment text or boundaries.
 */
export function reconcileSegmentsWithProviderWords(segments, words) {
  const base = Array.isArray(segments) ? JSON.parse(JSON.stringify(segments)) : [];
  const uncovered = findUncoveredProviderWords(base, words);
  if (!uncovered.length) {
    return { segments: base, wordGapFill: { inserted: 0, gaps: [] } };
  }

  const wordGroups = groupProviderWordsByPause(uncovered);
  const merged = [...base, ...wordGroups].sort((a, b) => Number(a.start) - Number(b.start));

  const gaps = [];
  const sortedBase = [...base].sort((a, b) => Number(a.start) - Number(b.start));
  for (let i = 0; i < sortedBase.length - 1; i++) {
    const gapStart = Number(sortedBase[i].end);
    const gapEnd = Number(sortedBase[i + 1].start);
    if (gapEnd - gapStart >= WORD_GAP_MIN_SEC) {
      const filled = wordGroups.filter(
        (g) => Number(g.start) >= gapStart - 0.05 && Number(g.end) <= gapEnd + 0.05
      );
      if (filled.length) {
        gaps.push({ start: gapStart, end: gapEnd, insertedCues: filled.length });
      }
    }
  }

  return {
    segments: merged,
    wordGapFill: {
      inserted: wordGroups.length,
      uncoveredWordCount: uncovered.length,
      gaps
    }
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
      const gapFilled = await fillTimelineGapsWithRetranscription(
        { fetch, audioBuffer, mimeType, extension, languageHint, traceId },
        preserved.segments
      );
      const finalSegments = sanitizeTranscriptSegments(gapFilled.segments);
      console.log('[asr-v2]', {
        traceId,
        phase: 'provider_ok',
        providerId,
        segmentCount: finalSegments.length,
        wordCount: preserved.words.length,
        segmentSource: preserved.segmentSource,
        wordGapFill: preserved.wordGapFill,
        gapRetranscribe: gapFilled.gapRetranscribe
      });
      const text = finalSegments.map((s) => String(s.text || '').trim()).filter(Boolean).join(' ');
      return {
        ...preserved,
        text,
        segments: finalSegments,
        success: true,
        asrPipeline: 'v2',
        gapRetranscribe: gapFilled.gapRetranscribe,
        cleanSrt: segmentsToCleanSrt(finalSegments)
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
        model: transcript.model,
        wordGapFill: transcript.wordGapFill || null,
        segmentSource: transcript.segmentSource || null,
        gapRetranscribe: transcript.gapRetranscribe || null
      }
    : preserveProviderOutput(transcript, transcript?.provider || GROQ_PROVIDER_ID);

  const reconciled =
    preserved.wordGapFill != null
      ? { segments: preserved.segments, wordGapFill: preserved.wordGapFill }
      : reconcileSegmentsWithProviderWords(preserved.segments, preserved.words);

  const segments = sanitizeTranscriptSegments(reconciled.segments);
  const text = segments.map((s) => String(s.text || '').trim()).filter(Boolean).join(' ');

  return {
    text,
    segments,
    words: preserved.words,
    language: preserved.language,
    provider: preserved.provider,
    model: preserved.model,
    gapRetranscribe: reconciled.gapRetranscribe || preserved.gapRetranscribe || null,
    wordGapFill: reconciled.wordGapFill,
    segmentSource: preserved.segmentSource || reconciled.segmentSource || null,
    cleanSrt: segmentsToCleanSrt(segments),
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
