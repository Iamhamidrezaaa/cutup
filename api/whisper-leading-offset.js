/**
 * Whisper often returns the first segment 0.5–2.5s late vs speech at t≈0.
 * Shift the full segment timeline earlier when that uniform lead is detected.
 */

export const WHISPER_LEADING_OFFSET_ENABLED =
  String(process.env.RENDER_WHISPER_LEADING_OFFSET ?? '1') !== '0';

const DEFAULT_MIN_LEAD_SEC = 0.45;
const DEFAULT_MAX_LEAD_SEC = 2.8;
const MIN_WORD_DURATION_SEC = 0.05;

/**
 * @param {{ start: number, end: number, text?: string, words?: { start?: number, end?: number }[] }[]} segments
 * @param {{ minLeadingSec?: number, maxLeadingSec?: number, firstSpeechSec?: number|null }} [opts]
 * @returns {number} seconds to subtract from all cue times (0 = no change)
 */
function segmentHasWordTimestamps(seg) {
  return (
    Array.isArray(seg?.words) &&
    seg.words.some((w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)))
  );
}

export function detectWhisperLeadingOffsetSec(segments, opts = {}) {
  if (!WHISPER_LEADING_OFFSET_ENABLED) return 0;

  const segs = Array.isArray(segments) ? segments : [];
  if (!segs.length) return 0;

  if (opts.skipWhenWordTimestamps !== false && segs.some(segmentHasWordTimestamps)) {
    return 0;
  }

  const minLead = Number(opts.minLeadingSec ?? DEFAULT_MIN_LEAD_SEC);
  const maxLead = Number(opts.maxLeadingSec ?? DEFAULT_MAX_LEAD_SEC);
  const segStart = Number(segs[0].start);
  if (!Number.isFinite(segStart) || segStart < minLead || segStart > maxLead) return 0;

  const wordStarts = (Array.isArray(segs[0].words) ? segs[0].words : [])
    .map((w) => Number(w?.start))
    .filter((t) => Number.isFinite(t));
  const firstWordStart = wordStarts.length ? Math.min(...wordStarts) : segStart;
  let anchor = Math.min(segStart, firstWordStart);

  const speechSec = Number(opts.firstSpeechSec);
  if (Number.isFinite(speechSec) && speechSec >= 0 && speechSec <= 0.25 && anchor > minLead) {
    anchor = Math.max(0, speechSec);
  }

  if (anchor < minLead) return 0;

  if (segs.length > 1) {
    const nextStart = Number(segs[1].start);
    if (Number.isFinite(nextStart) && nextStart < anchor * 0.4) return 0;
  }

  return Number(anchor.toFixed(4));
}

/**
 * @param {object[]} segments
 * @param {number} offsetSec
 */
export function applyWhisperLeadingOffset(segments, offsetSec) {
  const shift = Number(offsetSec);
  if (!Number.isFinite(shift) || shift < 0.05) return segments;

  return (Array.isArray(segments) ? segments : []).map((seg) => {
    const start = Math.max(0, Number(seg.start) - shift);
    const end = Math.max(start + MIN_WORD_DURATION_SEC, Number(seg.end) - shift);
    const words = Array.isArray(seg.words)
      ? seg.words.map((w) => {
          const ws = Math.max(0, Number(w.start) - shift);
          const we = Math.max(ws + MIN_WORD_DURATION_SEC, Number(w.end) - shift);
          return { ...w, start: ws, end: we };
        })
      : seg.words;
    return { ...seg, start, end, words };
  });
}

/**
 * @param {object[]} segments
 * @param {object} [opts]
 * @returns {{ segments: object[], offsetSec: number }}
 */
export function applyWhisperLeadingOffsetIfNeeded(segments, opts = {}) {
  const offsetSec = detectWhisperLeadingOffsetSec(segments, opts);
  if (offsetSec < 0.05) {
    return { segments: Array.isArray(segments) ? segments : [], offsetSec: 0 };
  }
  return {
    segments: applyWhisperLeadingOffset(segments, offsetSec),
    offsetSec
  };
}
