/**
 * Tighten master cue on/off times for burn-in lip sync (word-level bounds when available).
 */
export const BURN_LIP_LEAD_SEC = 0.03;
export const BURN_TAIL_PAD_SEC = 0.02;
export const BURN_INTER_CUE_GAP_SEC = 0.03;
export const BURN_MIN_CUE_SEC = 0.06;

function roundSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function timedWordsFromCue(cue) {
  const raw = Array.isArray(cue?.words) ? cue.words : [];
  return raw.filter((w) => w && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)));
}

/**
 * Prefer first/last word timestamps over segment envelope (Whisper segment bounds are loose).
 * @param {{ start: number, end: number, words?: object[] }} cue
 */
export function speechBoundsFromCue(cue) {
  const timed = timedWordsFromCue(cue);
  if (timed.length) {
    return {
      speechStart: Number(timed[0].start),
      speechEnd: Number(timed[timed.length - 1].end)
    };
  }
  return {
    speechStart: Number(cue.start),
    speechEnd: Number(cue.end)
  };
}

/**
 * @param {{ start: number, end: number, text?: string, words?: object[] }[]} cues
 * @returns {typeof cues}
 */
export function polishMasterCueTimeline(cues) {
  const sorted = (Array.isArray(cues) ? cues : [])
    .filter((c) => c && Number(c.end) > Number(c.start))
    .map((c) => ({ ...c }))
    .sort((a, b) => Number(a.start) - Number(b.start));

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];
    const bounds = speechBoundsFromCue(cue);
    let start = Math.max(0, bounds.speechStart - BURN_LIP_LEAD_SEC);
    let end = bounds.speechEnd + BURN_TAIL_PAD_SEC;

    if (i + 1 < sorted.length) {
      const nextBounds = speechBoundsFromCue(sorted[i + 1]);
      const nextVisibleStart = Math.max(0, nextBounds.speechStart - BURN_LIP_LEAD_SEC);
      end = Math.min(end, nextVisibleStart - BURN_INTER_CUE_GAP_SEC);
    }

    if (end <= start) {
      end = start + BURN_MIN_CUE_SEC;
    }

    cue.start = roundSec(start);
    cue.end = roundSec(end);
  }

  return sorted;
}
