/**
 * Tight speech-sync for transcript/SRT cues — word-anchored start/end, ms precision.
 */
import { refineCueTimingsFromWords } from './subtitle-translation-pipeline.js';

export const TIGHT_TAIL_PAD_SEC = 0.06;
export const MIN_CUE_DURATION_SEC = 0.08;
export const MIN_CUE_GAP_SEC = 0.02;

/** Round to millisecond precision for SRT/export stability. */
export function roundTimelineSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/** @param {object[]} segments */
export function segmentsHaveWordTimestamps(segments) {
  return (segments || []).some(
    (s) => Array.isArray(s?.words) && s.words.some((w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
  );
}

/** @param {object[]} segments */
export function segmentsHaveAudioAnchors(segments) {
  return (segments || []).some(
    (s) => Number.isFinite(Number(s?._audioStart)) && Number.isFinite(Number(s?._audioEnd))
  );
}

/**
 * Snap cue boundaries to first/last spoken word; minimal tail pad for readability.
 * @param {object[]} segments
 * @param {{ tailPadSec?: number, minGapSec?: number }} [opts]
 */
export function applyTightSpeechSync(segments, opts = {}) {
  const tailPad = Number(opts.tailPadSec ?? TIGHT_TAIL_PAD_SEC);
  const minGap = Number(opts.minGapSec ?? MIN_CUE_GAP_SEC);

  const list = (segments || []).map((seg) => {
    const startRaw = Number(seg.start);
    const endRaw = Number(seg.end);
    let start = roundTimelineSec(startRaw);
    let end = roundTimelineSec(endRaw);

    const audioStart = Number.isFinite(Number(seg?._audioStart)) ? Number(seg._audioStart) : null;
    const audioEnd = Number.isFinite(Number(seg?._audioEnd)) ? Number(seg._audioEnd) : null;
    if (audioStart != null && audioEnd != null) {
      start = roundTimelineSec(Math.max(0, audioStart));
      end = roundTimelineSec(Math.max(start + MIN_CUE_DURATION_SEC, audioEnd + tailPad));
    } else {
      const words = seg?.words;
      if (Array.isArray(words) && words.length) {
        const timed = words.filter(
          (w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end))
        );
        if (timed.length) {
          const ws = Number(timed[0].start);
          const we = Number(timed[timed.length - 1].end);
          start = roundTimelineSec(Math.max(0, ws));
          end = roundTimelineSec(Math.max(start + MIN_CUE_DURATION_SEC, we + tailPad));
        }
      }
    }

    if (end <= start) {
      end = roundTimelineSec(start + MIN_CUE_DURATION_SEC);
    }

    return { ...seg, start, end };
  });

  return eliminateCueOverlaps(list, minGap);
}

/**
 * Prevent stacked cues; preserve lip-sync by trimming ends not starts.
 * @param {object[]} segments
 * @param {number} [minGapSec]
 */
export function eliminateCueOverlaps(segments, minGapSec = MIN_CUE_GAP_SEC) {
  const sorted = [...(segments || [])].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const maxEnd = roundTimelineSec(next.start - minGapSec);
    if (cur.end > maxEnd) {
      cur.end = roundTimelineSec(Math.max(cur.start + MIN_CUE_DURATION_SEC, maxEnd));
    }
  }
  return sorted;
}

/**
 * Full transcript timing pass: word anchors → tight sync → ms rounding.
 * @param {object[]} segments
 * @param {{ tailPadSec?: number, minGapSec?: number }} [opts]
 */
export function refineTranscriptTimings(segments, opts = {}) {
  const valid = (segments || []).filter(
    (s) =>
      s &&
      typeof s.start === 'number' &&
      typeof s.end === 'number' &&
      s.end > s.start &&
      s.text &&
      String(s.text).trim().length > 0
  );
  if (!valid.length) return [];

  let list = refineCueTimingsFromWords(valid);
  list = applyTightSpeechSync(list, opts);
  return list.map((s) => ({
    ...s,
    start: roundTimelineSec(s.start),
    end: roundTimelineSec(s.end),
    text: String(s.text || '').replace(/\s+/g, ' ').trim()
  }));
}
