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
  return 'Vazirmatn';
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
    'Vazirmatn',
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
<<<<<<< HEAD
  // Proven libass RTL burn profile (test-fa.ass): Vazirmatn, no stretch, no extra spacing.
  const minRtl = Math.max(56, Math.round(72 * (playResY / 1920)));
=======
  // RTL burn: Vazirmatn for shaping; keep preset spacing/scaleY (e.g. Hormozi).
>>>>>>> cfb9d342370269416d4bcda4cad00ef3f35679ed
  return {
    fontName: resolveRtlFontName(),
    fontSize: baseSize,
    spacing: preset.useFixedTypography ? Number(preset.spacing) || 0 : 0,
    scaleY: preset.useFixedTypography ? Number(preset.scaleY) || 100 : 100,
    rtl: true
  };
}

/** Trailing punctuation that should anchor to the RTL run (visual sentence end). */
const TRAILING_NEUTRAL_PUNCT = /([.!?؟…]+|[،؛:]+)\s*$/u;

/**
 * Insert RLM (U+200F) before trailing punctuation so libass places it at the visual end.
 * Logical order: …بعدی\u200F. — does not reshape letters or reorder words.
 * @param {string} text
 */
export function anchorRtlPunctuation(text) {
  const s = String(text || '');
  if (!s || !isRtlText(s)) return s;
  return s.replace(TRAILING_NEUTRAL_PUNCT, '\u200F$1');
}

export function rtlPunctuationTailSample(text) {
  const s = String(text || '');
  const tail = [...s].slice(-8);
  return tail.map((ch) => {
    const cp = ch.codePointAt(0);
    if (cp === 0x200f) return 'U+200F';
    if (ch === '.') return '.';
    if (ch === '؟') return '؟';
    return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  });
}

/** ASS override prefix for a dialogue line. */
export function assRtlPrefix(typography) {
  if (!typography.rtl) return '';
  return `{\\fn${typography.fontName}\\fs${typography.fontSize}\\fsp${typography.spacing}}`;
}
