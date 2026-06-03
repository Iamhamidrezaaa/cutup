/**
 * Aspect-ratio-aware ASS layout: placement, font scale, outline, per-cue margins.
 */
import { resolveSubtitlePlacement } from './placement.js';
import { buildCueLines } from './text-layout.js';
import { cuesAreMostlyRtl, isRtlText, resolveCaptionTypography } from './rtl-text.js';

/** Hard cap for burned MP4 subtitles (never 3+ stacked lines). */
export const BURN_SUBTITLE_MAX_LINES = 2;

/**
 * Per-cue ASS line layout — stack mode, max two \\N lines (avoids libass soft-wrap to 3–4 rows).
 * @param {object} baseLayout from resolveRenderLayout().layout
 * @param {string} cueText
 */
export function resolveCueLineLayout(baseLayout, cueText) {
  const layout = { ...(baseLayout || {}) };
  const cap = Math.min(BURN_SUBTITLE_MAX_LINES, Math.max(1, Number(baseLayout.maxLines) || BURN_SUBTITLE_MAX_LINES));
  layout.mode = 'stack';
  layout.maxLines = cap;
  layout.wordsPerLineMin = Math.min(Number(layout.wordsPerLineMin) || 2, 2);
  layout.wordsPerLineMax = Math.min(Number(layout.wordsPerLineMax) || 4, 4);
  layout.maxCharsPerLine = Math.min(Number(layout.maxCharsPerLine) || 22, isRtlText(cueText) ? 36 : 20);

  if (isRtlText(cueText)) {
    layout.maxCharsPerLine = Math.max(layout.maxCharsPerLine, 32);
  }
  return layout;
}

function estimateMaxCueLines(cues, layout, uppercase) {
  let maxLines = 1;
  for (const cue of cues || []) {
    const cueLayout = resolveCueLineLayout(layout, cue?.text);
    const cueUppercase = uppercase && !isRtlText(cue?.text);
    const lines = buildCueLines(cue, cueLayout, cueUppercase);
    maxLines = Math.max(maxLines, lines.length || 1);
  }
  return maxLines;
}

function estimateWordDensity(cues) {
  const list = Array.isArray(cues) ? cues : [];
  if (!list.length) return { avgWordsPerCue: 0, dense: false };
  let totalWords = 0;
  for (const cue of list) {
    totalWords += String(cue.text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }
  const avgWordsPerCue = totalWords / list.length;
  return {
    avgWordsPerCue,
    dense: avgWordsPerCue >= 6.2
  };
}

/**
 * Mobile-first subtitle size from resolution, line count, RTL.
 */
export function resolveDynamicFontSize({
  playResY,
  isVertical,
  isHorizontal,
  rtl,
  presetId,
  preset
}) {
  const h = playResY || 1920;
  if (preset?.useFixedTypography && Number(preset.fontSize) > 0) {
    let size = Math.round(preset.fontSize * (h / 1920));
    return Math.max(28, size);
  }
  let size;

  const verticalPresetRanges = {
    mrBeast: [95, 115],
    alexHormozi: [85, 105],
    aliAbdaal: [72, 88],
    podcast: [68, 82],
    luxuryMinimal: [80, 96],
    tiktokNeon: [88, 108],
    cleanSrt: [74, 90]
  };

  if (isVertical) {
    const [baseMin, baseMax] = verticalPresetRanges[presetId] || [82, 100];
    const minVertical = Math.round(baseMin * (h / 1920));
    const maxVertical = Math.round(baseMax * (h / 1920));
    size = Math.round(((baseMin + baseMax) / 2) * (h / 1920));
    size = Math.max(minVertical, Math.min(maxVertical, size));
  } else if (isHorizontal) {
    size = Math.round(h * 0.056);
    size = Math.max(size, Math.round(56 * (h / 1080)));
  } else {
    size = Math.round(h * 0.062);
    size = Math.max(size, Math.round(64 * (h / 1920)));
  }

  const cap = isVertical ? Math.round(120 * (h / 1920)) : Math.round(h * 0.074);
  return Math.min(cap, Math.max(32, size));
}

export function resolveOutlineShadow(fontSize, isVertical, preset) {
  if (preset?.useFixedTypography) {
    return {
      outline: Math.max(0, Number(preset.outline) || 0),
      shadow: Math.max(0, Number(preset.shadow) || 0),
      borderStyle: preset.borderStyle ?? 1
    };
  }
  if (isVertical) {
    return {
      outline: Math.max(8, Math.round(fontSize * 0.13)),
      shadow: Math.max(6, Math.round(fontSize * 0.1)),
      borderStyle: 1
    };
  }
  return {
    outline: Math.max(3, Math.round(fontSize * 0.08)),
    shadow: Math.max(2, Math.round(fontSize * 0.05)),
    borderStyle: 1
  };
}

/**
 * Full render layout for ASS generation.
 * @param {{ playResX: number, playResY: number, durationSec?: number, positionMode?: string }} dims
 * @param {{ start, end, text }[]} cues
 * @param {object} preset
 */
export function resolveRenderLayout(dims, cues, preset) {
  const playResX = dims.playResX || 1080;
  const playResY = dims.playResY || 1920;
  const isVertical = playResY > playResX * 1.05;
  const isHorizontal = playResX > playResY * 1.15;

  const layout = {};
  if (isVertical) {
    layout.mode = 'stack';
    layout.wordsPerLineMin = 2;
    layout.wordsPerLineMax = 5;
    layout.maxCharsPerLine = 22;
    layout.maxLines = 2;
  } else if (isHorizontal) {
    layout.mode = 'stack';
    layout.wordsPerLineMin = 2;
    layout.wordsPerLineMax = 5;
    layout.maxCharsPerLine = 28;
    layout.maxLines = BURN_SUBTITLE_MAX_LINES;
  } else {
    layout.mode = 'stack';
    layout.wordsPerLineMin = 3;
    layout.wordsPerLineMax = 8;
    layout.maxCharsPerLine = 32;
    layout.maxLines = BURN_SUBTITLE_MAX_LINES;
  }

  const presetLayout = preset.layout || {};
  if (presetLayout.mode) layout.mode = presetLayout.mode;
  if (presetLayout.wordsPerLineMin != null) layout.wordsPerLineMin = presetLayout.wordsPerLineMin;
  if (presetLayout.wordsPerLineMax != null) layout.wordsPerLineMax = presetLayout.wordsPerLineMax;
  if (presetLayout.maxCharsPerLine != null) layout.maxCharsPerLine = presetLayout.maxCharsPerLine;
  if (presetLayout.maxLines != null) {
    layout.maxLines = Math.min(BURN_SUBTITLE_MAX_LINES, Number(presetLayout.maxLines) || BURN_SUBTITLE_MAX_LINES);
  }
  layout.maxLines = Math.min(BURN_SUBTITLE_MAX_LINES, Math.max(1, Number(layout.maxLines) || BURN_SUBTITLE_MAX_LINES));

  const rtlEarly = cuesAreMostlyRtl(cues);
  if (rtlEarly) {
    layout.mode = 'stack';
    layout.maxLines = BURN_SUBTITLE_MAX_LINES;
    layout.maxCharsPerLine = Math.max(layout.maxCharsPerLine || 32, 36);
  }

  const placement = resolveSubtitlePlacement(
    { width: playResX, height: playResY, durationSec: dims.durationSec || 0 },
    cues,
    dims.positionMode || preset.positionMode || 'adaptive'
  );

  const rtl = cuesAreMostlyRtl(cues);
  const useUppercase = Boolean(preset.uppercase) && !rtl;
  const maxLines = estimateMaxCueLines(cues, layout, useUppercase);
  const density = estimateWordDensity(cues);

  const marginV = resolveBurnBottomMarginV(playResY, isVertical);

  const fontSize = resolveDynamicFontSize({
    playResY,
    isVertical,
    isHorizontal,
    rtl,
    presetId: preset.id,
    preset
  });

  const { outline, shadow, borderStyle } = resolveOutlineShadow(fontSize, isVertical, preset);
  const typo = resolveCaptionTypography(
    { ...preset, fontSize, outline, shadow },
    playResY,
    rtl
  );

  const lineHeightRatio = rtl
    ? 1
    : preset.useFixedTypography && preset.scaleY
      ? Number(preset.scaleY) / 100
      : isVertical
        ? 1.08
        : 1.2;
  const lineHeight = Math.round(fontSize * lineHeightRatio);
  const maxWidthRatio =
    presetLayout.maxWidthRatio != null
      ? presetLayout.maxWidthRatio
      : isVertical
        ? 0.74
        : 0.84;
  const sideRatio = (1 - maxWidthRatio) / 2;
  const marginL = Math.round(playResX * sideRatio);
  const marginR = marginL;

  return {
    playResX,
    playResY,
    isVertical,
    isHorizontal,
    placement,
    layout,
    marginV,
    marginL,
    marginR,
    fontSize: typo.fontSize,
    fontName: typo.fontName,
    spacing: typo.spacing,
    scaleY: typo.scaleY,
    rtl: typo.rtl,
    outline,
    shadow,
    borderStyle,
    useUppercase,
    maxLines,
    wordDensity: Number(density.avgWordsPerCue.toFixed(2)),
    lineHeight,
    alignment: 2,
    maxWidthRatio
  };
}

/**
 * Bottom-center anchor (Alignment=2): MarginV is distance from the bottom edge.
 * Must stay constant per resolution — never increase for multi-line cues.
 */
export function resolveBurnBottomMarginV(playResY, isVertical) {
  const h = Math.max(2, Number(playResY) || 1920);
  const ratio = Number(
    process.env.RENDER_SUBTITLE_BOTTOM_MARGIN_RATIO ||
      (isVertical ? 0.152 : 0.15)
  );
  return Math.round(h * Math.min(0.22, Math.max(0.08, ratio)));
}

/** @deprecated use resolveBurnBottomMarginV — kept for callers; ignores line count. */
export function cueMarginV(baseMarginV, _lineCount, _lineHeight) {
  return baseMarginV;
}

/**
 * ASS stacks lines from the alignment edge outward. For bottom alignment the first
 * line in the event sits on the bottom — reverse so reading order is top → bottom.
 */
export function orderAssLinesBottomFirst(lines) {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (list.length <= 1) return list;
  return [...list].reverse();
}

/** Pin bottom-center of the cue block to a fixed pixel Y (libass). */
export function buildAssBottomAnchorTag(playResX, playResY, marginV) {
  const x = Math.round((Number(playResX) || 1080) / 2);
  const y = Math.round((Number(playResY) || 1920) - (Number(marginV) || 0));
  return `{\\an2\\pos(${x},${y})}`;
}
