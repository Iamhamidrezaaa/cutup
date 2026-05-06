/**
 * Adaptive subtitle safe-zone / vertical placement (no frame ML).
 */

const POSITION_PRESETS = {
  bottom: 0.1,
  'lower-middle': 0.16,
  middle: 0.28,
  adaptive: null
};

/**
 * Estimate lower-third caption density from segment timing.
 */
function lowerThirdDensity(segments, durationSec) {
  if (!segments.length || durationSec <= 0) return 0;
  const windowStart = durationSec * 0.55;
  const inZone = segments.filter((s) => s.start >= windowStart);
  const shortCues = inZone.filter((s) => s.end - s.start < 2.2).length;
  return inZone.length ? shortCues / inZone.length : 0;
}

/**
 * @param {{ width: number, height: number, durationSec?: number }} probe
 * @param {{ start: number, end: number }[]} segments
 * @param {string} [positionMode]
 */
export function resolveSubtitlePlacement(probe, segments, positionMode = 'adaptive') {
  const w = probe.width || 1080;
  const h = probe.height || 1920;
  const isVertical = h > w * 1.05;
  const isHorizontal = w > h * 1.15;
  const density = lowerThirdDensity(segments, probe.durationSec || 0);

  let ratio = POSITION_PRESETS[positionMode] ?? null;

  if (ratio == null) {
    // Vertical (9:16): fixed lower-middle anchor (~62% viewport height).
    if (isVertical) ratio = 0.38;
    else if (isHorizontal) ratio = 0.18;
    else ratio = 0.16;

    // Keep horizontal adaptive; vertical stays locked.
    if (isHorizontal && density > 0.35) ratio += 0.03;
  }

  if (isVertical) ratio = Math.min(0.39, Math.max(0.38, ratio));
  else ratio = Math.min(0.28, Math.max(0.12, ratio));
  const marginV = Math.round(h * ratio);
  const alignment = 2;

  return {
    marginV,
    alignment,
    positionMode: positionMode === 'adaptive' ? 'adaptive' : positionMode,
    safeZone: ratio,
    isVertical,
    liftedForDensity: density > 0.45
  };
}
