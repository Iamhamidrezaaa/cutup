/**
 * RTL / Arabic / Persian detection and ASS font hints.
 */

const RTL_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function isRtlText(text) {
  return RTL_SCRIPT.test(String(text || ''));
}

export function cuesAreMostlyRtl(cues) {
  if (!cues?.length) return false;
  let rtl = 0;
  let total = 0;
  for (const c of cues) {
    const t = String(c.text || '');
    if (!t.trim()) continue;
    total += 1;
    if (isRtlText(t)) rtl += 1;
  }
  return total > 0 && rtl / total >= 0.35;
}

export function resolveRtlFontName() {
  return 'Noto Naskh Arabic';
}

export function resolveArabicFallbackFontName() {
  return 'Noto Sans Arabic';
}

/**
 * Ordered font fallback list for RTL scripts.
 * FFmpeg/libass uses the first font it can find on the system.
 */
export function resolveRtlFontFallbackChain() {
  return [
    'Noto Naskh Arabic',
    'Noto Sans Arabic',
    'Noto Kufi Arabic',
    'DejaVu Sans',
    'FreeSans',
    'Arial Unicode MS',
    'sans-serif'
  ];
}

/**
 * @param {{ fontName: string, fontSize: number }} preset
 * @param {number} playResY
 * @param {boolean} rtl
 */
export function resolveCaptionTypography(preset, playResY, rtl) {
  const baseSize = preset.fontSize || Math.max(28, Math.round(48 * (playResY / 1920)));
  if (!rtl) {
    return {
      fontName: preset.fontName || 'Arial',
      fontSize: baseSize,
      spacing: preset.useFixedTypography ? Number(preset.spacing) || 0 : 0,
      scaleY: preset.useFixedTypography ? Number(preset.scaleY) || 100 : 100,
      rtl: false
    };
  }
  const minRtl = Math.max(56, Math.round(72 * (playResY / 1920)));
  return {
    fontName: resolveRtlFontName(),
    fontSize: Math.max(baseSize, minRtl),
    spacing: 2,
    scaleY: 112,
    rtl: true
  };
}

/** ASS override prefix for a dialogue line. */
export function assRtlPrefix(typography) {
  if (!typography.rtl) return '';
  return `{\\fn${typography.fontName}\\fs${typography.fontSize}\\fsp${typography.spacing}}`;
}
