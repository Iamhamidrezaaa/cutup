/**
 * Aspect-ratio-aware ASS layout: placement, font scale, outline, per-cue margins.
 */
import { resolveSubtitlePlacement } from './placement.js';
import { buildCueLines } from './text-layout.js';
import { cuesAreMostlyRtl, resolveCaptionTypography } from './rtl-text.js';

function estimateMaxCueLines(cues, layout, uppercase) {
  let maxLines = 1;
  for (const cue of cues || []) {
    const lines = buildCueLines(cue, layout, uppercase);
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
  presetId
}) {
  const h = playResY || 1920;
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

  if (rtl) size = Math.round(size * 1.14);

  const cap = isVertical ? Math.round(120 * (h / 1920)) : Math.round(h * 0.074);
  return Math.min(cap, Math.max(32, size));
}

export function resolveOutlineShadow(fontSize, isVertical) {
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

  // Shared readability layer — independent from creator visual presets.
  const layout = {};
  if (isVertical) {
    layout.mode = 'stack';
    layout.wordsPerLineMin = 2;
    layout.wordsPerLineMax = 5;
    layout.maxCharsPerLine = 22;
    layout.maxLines = 2;
  } else if (isHorizontal) {
    layout.mode = 'wide';
    layout.wordsPerLineMin = 3;
    layout.wordsPerLineMax = 12;
    layout.maxCharsPerLine = 42;
    layout.maxLines = 3;
  } else {
    layout.mode = 'stack';
    layout.wordsPerLineMin = 3;
    layout.wordsPerLineMax = 10;
    layout.maxCharsPerLine = 36;
    layout.maxLines = 3;
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

  let marginV = placement.marginV;
  let alignment = 2;
  if (isVertical) {
    // One fixed band for every style: top-anchored so 1-line vs 2-line cues do not jump.
    const topRatio = Math.min(
      0.74,
      Math.max(0.66, Number(process.env.RENDER_SUBTITLE_FIXED_TOP_RATIO || 0.7))
    );
    marginV = Math.round(playResY * topRatio);
    alignment = 8;
  } else if (isHorizontal) {
    marginV = Math.round(playResY * Math.min(0.18, Math.max(0.12, placement.safeZone || 0.15)));
  }

  const fontSize = resolveDynamicFontSize({
    playResY,
    isVertical,
    isHorizontal,
    rtl,
    presetId: preset.id
  });

  const { outline, shadow, borderStyle } = resolveOutlineShadow(fontSize, isVertical);
  const typo = resolveCaptionTypography(
    { ...preset, fontSize, outline, shadow },
    playResY,
    rtl
  );

  const lineHeight = Math.round(fontSize * (isVertical ? 1.08 : rtl ? 1.25 : 1.2));
  const maxWidthRatio = isVertical ? 0.74 : 0.84;
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
    alignment,
    maxWidthRatio,
    fixedVerticalAnchor: isVertical
  };
}

/** Per-cue bottom margin (lift multi-line blocks). */
export function cueMarginV(baseMarginV, lineCount, lineHeight) {
  const lines = Math.max(1, lineCount);
  return baseMarginV + Math.max(0, lines - 1) * lineHeight;
}
