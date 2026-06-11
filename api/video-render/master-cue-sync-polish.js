/**
 * Tighten master cue on/off times for burn-in lip sync (small nudge, no re-segmentation).
 */
export const BURN_ONSET_DELAY_SEC = 0.09;
export const BURN_TAIL_PAD_SEC = 0.05;
export const BURN_INTER_CUE_GAP_SEC = 0.03;
export const BURN_MIN_CUE_SEC = 0.06;

function roundSec(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {{ start: number, end: number, text?: string }[]} cues
 * @returns {typeof cues}
 */
export function polishMasterCueTimeline(cues) {
  const sorted = (Array.isArray(cues) ? cues : [])
    .filter((c) => c && Number(c.end) > Number(c.start))
    .map((c) => ({ ...c }))
    .sort((a, b) => Number(a.start) - Number(b.start));

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i];
    const speechStart = Number(cue.start);
    const speechEnd = Number(cue.end);
    let start = speechStart + BURN_ONSET_DELAY_SEC;
    let end = speechEnd + BURN_TAIL_PAD_SEC;

    if (i + 1 < sorted.length) {
      const nextSpeechStart = Number(sorted[i + 1].start);
      const nextVisibleStart = nextSpeechStart + BURN_ONSET_DELAY_SEC;
      end = Math.min(end, nextVisibleStart - BURN_INTER_CUE_GAP_SEC);
    }

    if (end <= start) {
      end = start + BURN_MIN_CUE_SEC;
    }

    cue.start = roundSec(Math.max(0, start));
    cue.end = roundSec(end);
  }

  return sorted;
}
