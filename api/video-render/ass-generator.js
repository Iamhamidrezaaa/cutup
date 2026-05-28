/**
 * ASS subtitle file generator for FFmpeg burn-in.
 */
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { buildCueLines } from './text-layout.js';
import { analyzeTextWithEmphasis, shouldEmphasize } from './emphasis-engine.js';
import {
  buildCanonicalSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows,
  validateVisualVisibility,
  validateVisualContinuity,
  subtitleDensityMetrics,
  readabilityScore,
  assertCueIntegrity,
  continuitySummary
} from './subtitle-pipeline.js';
import { resolveRenderLayout, cueMarginV } from './layout-engine.js';
import { assRtlPrefix } from './rtl-text.js';

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\N');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolvePresetVisualSignature(presetId, isVertical) {
  const base = {
    fontOffset: 0,
    outlineScale: 1,
    shadowScale: 1,
    glow: 0,
    emphasisBoost: 1,
    inlineEmphasisBonus: 0,
    forceBold: null
  };
  const byPreset = {
    tiktokNeon: {
      fontOffset: isVertical ? 14 : 4,
      outlineScale: 1.34,
      shadowScale: 1.38,
      glow: 2.8,
      emphasisBoost: 1.22,
      inlineEmphasisBonus: 1,
      forceBold: true
    },
    mrBeast: {
      fontOffset: isVertical ? 10 : 3,
      outlineScale: 1.22,
      shadowScale: 1.24,
      glow: 1.2,
      emphasisBoost: 1.18,
      inlineEmphasisBonus: 1,
      forceBold: true
    },
    aliAbdaal: {
      fontOffset: isVertical ? -10 : -2,
      outlineScale: 0.62,
      shadowScale: 0.55,
      glow: 0.2,
      emphasisBoost: 0.92,
      inlineEmphasisBonus: -1,
      forceBold: false
    },
    podcast: {
      fontOffset: isVertical ? -8 : -2,
      outlineScale: 0.8,
      shadowScale: 0.75,
      glow: 0.35,
      emphasisBoost: 0.96,
      inlineEmphasisBonus: -1,
      forceBold: false
    },
    luxuryMinimal: {
      fontOffset: isVertical ? -4 : 0,
      outlineScale: 0.92,
      shadowScale: 0.86,
      glow: 0.55,
      emphasisBoost: 0.98,
      inlineEmphasisBonus: 0,
      forceBold: false
    },
    cleanSrt: {
      fontOffset: isVertical ? -12 : -3,
      outlineScale: 0.56,
      shadowScale: 0.5,
      glow: 0,
      emphasisBoost: 0.88,
      inlineEmphasisBonus: -2,
      forceBold: true
    },
    alexHormozi: {
      fontOffset: isVertical ? 8 : 2,
      outlineScale: 1.14,
      shadowScale: 1.12,
      glow: 0.75,
      emphasisBoost: 1.12,
      inlineEmphasisBonus: 1,
      forceBold: true
    }
  };
  return {
    ...base,
    ...(byPreset[presetId] || null)
  };
}

function resolveAssRenderProfile({ quality, durationSec, cueCount, rtl, isVertical, renderHints = {} }) {
  const styleMode =
    renderHints.styleMode === 'safe' || renderHints.styleMode === 'aggressive' || renderHints.styleMode === 'cinematic'
      ? renderHints.styleMode
      : 'cinematic';

  if (quality !== 'hq') {
    const fastMode = styleMode === 'aggressive' ? 'aggressive' : 'cinematic';
    return {
      id: 'fast',
      styleMode: fastMode,
      simplifyTags: true,
      allowKinetic: fastMode === 'aggressive',
      maxInlineEmphasisPerCue: fastMode === 'aggressive' ? 2 : 1,
      outlineScale: 0.88,
      shadowScale: 0.72,
      emphasisScalePercent: fastMode === 'aggressive' ? 112 : 108,
      animationIntensity: fastMode === 'aggressive' ? 1 : 0.65,
      safeguardsActive: true,
      reasons: ['fast_profile']
    };
  }

  const reasons = [];
  if (durationSec > 120) reasons.push('duration_gt_120');
  if (cueCount > 220) reasons.push('high_subtitle_count');
  if (rtl) reasons.push('rtl_script');
  if (isVertical) reasons.push('vertical_video');
  if (renderHints.forceSafeguards) reasons.push('forced_safeguards');

  const safeguardsActive = reasons.length > 0;
  const effectiveStyleMode = safeguardsActive && styleMode === 'aggressive' ? 'cinematic' : styleMode;
  const cinematic = effectiveStyleMode === 'cinematic';
  const safe = effectiveStyleMode === 'safe';
  const aggressive = effectiveStyleMode === 'aggressive';

  return {
    id: safeguardsActive ? 'hq_adaptive' : 'hq_full',
    styleMode: effectiveStyleMode,
    simplifyTags: safeguardsActive,
    allowKinetic: !safeguardsActive && (cinematic || aggressive),
    maxInlineEmphasisPerCue: safe ? 1 : safeguardsActive ? 2 : aggressive ? 3 : 2,
    outlineScale: safeguardsActive ? 0.92 : 1,
    shadowScale: safeguardsActive ? 0.78 : safe ? 0.88 : 1,
    emphasisScalePercent: safeguardsActive ? 112 : aggressive ? 120 : safe ? 106 : null,
    animationIntensity: safe ? 0.35 : cinematic ? 0.75 : 1,
    safeguardsActive,
    reasons
  };
}

function resolveVisualFeatureFlags(renderHints = {}) {
  return {
    animatedWordHighlighting: Boolean(renderHints.animatedWordHighlighting),
    karaokeMode: Boolean(renderHints.karaokeMode),
    waveformSync: Boolean(renderHints.waveformSync),
    dualSubtitles: Boolean(renderHints.dualSubtitles)
  };
}

// Future extension point for upcoming visual render modes.
function applyFutureVisualExtensions(cue, _context) {
  return cue;
}

const ASS_EVENTS_FORMAT =
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text';


export function toAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const cs = Math.min(99, Math.floor((sec % 1) * 100));
  const wholeSec = Math.floor(sec);
  return `${h}:${String(m).padStart(2, '0')}:${String(wholeSec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildInlineEmphasis(token, preset, renderProfile) {
  const handler = preset.emphasis?.handler || 'default';
  const weight = handler === 'minimal' || handler === 'luxury' ? '\\b0' : '\\b1';
  return `{\\c${preset.secondaryColor}${weight}}${escapeAssText(token.text)}{\\r}`;
}

function linesToAssText(lines, preset, { disableEmphasis = false, renderProfile } = {}) {
  if (disableEmphasis) {
    return { text: lines.map((line) => escapeAssText(line)).join('\\N'), emphasisWords: [] };
  }

  const handler = preset.emphasis?.handler || 'default';
  const profileInline = Math.max(1, Math.min(2, renderProfile?.maxInlineEmphasisPerCue || 2));
  const presetInline = Number(preset.emphasis?.maxPerLine || 0);
  const maxInline = clamp(Math.max(profileInline, presetInline), 1, 2);
  let emphasized = 0;
  const parts = [];
  const emphasisWords = [];

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) parts.push('\\N');
    const tokens = analyzeTextWithEmphasis(lines[li], handler);
    for (const token of tokens) {
      if (token.isSpace) {
        parts.push(token.text);
        continue;
      }
      if (emphasized < maxInline && shouldEmphasize(token, handler)) {
        parts.push(buildInlineEmphasis(token, preset, renderProfile));
        emphasisWords.push(String(token.clean || token.text || '').toLowerCase());
        emphasized += 1;
      } else {
        parts.push(escapeAssText(token.text));
      }
    }
  }
  return { text: parts.join(''), emphasisWords: [...new Set(emphasisWords)] };
}

function styleLine(name, preset) {
  const borderStyle = preset.borderStyle ?? 1;
  const scaleY = preset.scaleY ?? 100;
  return [
    `Style: ${name}`,
    preset.fontName,
    preset.fontSize,
    preset.primaryColor,
    preset.secondaryColor,
    preset.outlineColor,
    preset.backColor,
    preset.bold ? -1 : 0,
    preset.italic ? -1 : 0,
    0,
    0,
    100,
    scaleY,
    preset.spacing ?? 0,
    0,
    borderStyle,
    preset.outline,
    preset.shadow,
    preset.alignment,
    preset.marginL ?? Math.round(preset.playResX * 0.06),
    preset.marginR ?? Math.round(preset.playResX * 0.06),
    preset.marginV,
    1
  ].join(',');
}

/**
 * @param {{ start: number, end: number, text: string }[]} segments
 * @param {string} presetId
 * @param {{ playResX?: number, playResY?: number, durationSec?: number, positionMode?: string, captionMode?: string, qualityMode?: string, quality?: 'fast'|'hq', renderHints?: { forceSafeguards?: boolean } }} [dims]
 */
export function generateAssContent(segments, presetId, dims = {}) {
  const selectedPresetId = resolvePresetIdOrThrow(presetId);
  const basePreset = getStylePreset(selectedPresetId);
  const requestedPlayResX = Number(dims.playResX || basePreset.playResX || 1080);
  const requestedPlayResY = Number(dims.playResY || basePreset.playResY || 1920);
  const requestedIsVertical = requestedPlayResY > requestedPlayResX * 1.05;
  const playResX = requestedIsVertical ? 1080 : requestedPlayResX;
  const playResY = requestedIsVertical ? 1920 : requestedPlayResY;
  const durationSec = dims.durationSec || 0;
  const quality = dims.quality === 'hq' ? 'hq' : 'fast';
  const captionMode = dims.captionMode || dims.qualityMode || 'viral';
  const visualFeatureFlags = resolveVisualFeatureFlags(dims.renderHints || {});

  const preset = {
    ...basePreset,
    playResX,
    playResY
  };

  const rawSegments = Array.isArray(segments) ? segments : [];
  const finalOnlySegments = rawSegments.filter((seg) => {
    if (!seg || typeof seg !== 'object') return false;
    if (seg.isFinal === false) return false;
    return true;
  });
  console.log(
    '[caption-final-blocks]',
    finalOnlySegments.map((seg, index) => ({
      index,
      start: Number(seg.start) || 0,
      end: Number(seg.end) || 0,
      text: String(seg.text || '').trim()
    }))
  );

  const canonicalSubtitles = buildCanonicalSubtitles(finalOnlySegments);
  if (!canonicalSubtitles.length) {
    throw new Error('SUBTITLE_CANONICAL_EMPTY');
  }
  console.log(
    '[canonical-caption-blocks]',
    canonicalSubtitles.map((b) => ({
      text: b.text,
      wordCount: Array.isArray(b.words) ? b.words.length : String(b.text || '').split(/\s+/).filter(Boolean).length,
      start: Number(b.start) || 0,
      end: Number(b.end) || 0,
      duration: Number(b.duration != null ? b.duration : (Number(b.end) - Number(b.start)).toFixed(3))
    }))
  );
  const cues = buildVisualCueView(canonicalSubtitles, captionMode);
  const integrityReport = assertCueIntegrity(canonicalSubtitles, cues, {
    maxTimingDriftMs: 0,
    maxExtraGapSec: 0.05
  });
  const continuity = continuitySummary(canonicalSubtitles);

  const layout = resolveRenderLayout(
    {
      playResX,
      playResY,
      durationSec,
      positionMode: dims.positionMode || preset.positionMode || 'adaptive'
    },
    cues,
    preset
  );

  const renderProfile = resolveAssRenderProfile({
    quality,
    durationSec,
    cueCount: cues.length,
    rtl: layout.rtl,
    isVertical: layout.isVertical,
    renderHints: dims.renderHints || {}
  });
  const minReadableCueSec =
    renderProfile.styleMode === 'safe'
      ? 0.95
      : renderProfile.styleMode === 'cinematic'
        ? 0.84
        : 0.74;
  const visibleCues = applyVisualReadabilityWindows(cues, {
    minCueDurationSec: minReadableCueSec,
    minGapSec: 0.035,
    maxTailExtensionSec: renderProfile.styleMode === 'safe' ? 0.62 : 0.48,
    maxLeadExtensionSec: renderProfile.styleMode === 'safe' ? 0.22 : 0.16,
    videoDurationSec: durationSec || 0
  });
  const visibility = validateVisualVisibility(visibleCues, {
    fps: 30,
    minFrames: renderProfile.styleMode === 'safe' ? 5 : 4
  });
  const visualContinuity = validateVisualContinuity(canonicalSubtitles, visibleCues, {
    maxTimingDriftMs: 350,
    maxExtraGapSec: 0.6
  });
  if (visibility.invisibleCount > 0) {
    const err = new Error(`SUBTITLE_VISIBILITY_LOSS: ${visibility.warnings.join(',')}`);
    err.code = 'SUBTITLE_VISIBILITY_LOSS';
    throw err;
  }

  const density = subtitleDensityMetrics(canonicalSubtitles, durationSec || continuity.cueCount || 1);
  const readability = readabilityScore(density, continuity, visibility);
  const tunedOutline = layout.outline > 0 ? Math.max(1, Math.round(layout.outline * renderProfile.outlineScale)) : 0;
  const tunedShadow = layout.shadow > 0 ? Math.max(1, Math.round(layout.shadow * renderProfile.shadowScale)) : 0;
  const signature = resolvePresetVisualSignature(basePreset.id, layout.isVertical);
  const tunedFontSize = layout.fontSize;
  const tunedOutlineByPreset = Math.max(1, Math.round(tunedOutline * signature.outlineScale));
  const tunedShadowByPreset = Math.max(1, Math.round(tunedShadow * signature.shadowScale));
  const emphasisScalePercent = clamp(
    Math.round((basePreset.emphasis?.scalePercent || 112) * signature.emphasisBoost),
    100,
    140
  );
  const glow = Number((basePreset.glow ?? signature.glow).toFixed(2));

  Object.assign(preset, {
    fontSize: tunedFontSize,
    spacing: layout.spacing,
    scaleY: layout.scaleY,
    outline: tunedOutlineByPreset,
    shadow: tunedShadowByPreset,
    borderStyle: layout.borderStyle,
    marginV: layout.marginV,
    marginL: layout.marginL,
    marginR: layout.marginR,
    alignment: layout.alignment,
    layout: layout.layout,
    bold: layout.isVertical ? true : signature.forceBold == null ? Boolean(basePreset.bold) : Boolean(signature.forceBold),
    glow,
    emphasis: {
      ...(basePreset.emphasis || {}),
      maxPerLine: clamp((renderProfile.maxInlineEmphasisPerCue || 2) + signature.inlineEmphasisBonus, 1, 6),
      scalePercent: emphasisScalePercent
    }
  });

  const header = [
    '[Script Info]',
    'Title: Cutup Viral Export',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    `; RenderQuality: ${quality}`,
    `; RenderProfile: ${renderProfile.id}`,
    `; StyleMode: ${renderProfile.styleMode}`,
    `; AdaptiveSafeguards: ${renderProfile.safeguardsActive ? 'on' : 'off'}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine('Default', preset),
    styleLine('Emphasis', { ...preset, fontSize: Math.round(preset.fontSize * 1.08), bold: true }),
    '',
    '[Events]',
    ASS_EVENTS_FORMAT
  ];
  const disableEmphasis = layout.rtl || captionMode === 'accurate';
  const typoPrefix = { fontName: preset.fontName, fontSize: preset.fontSize, spacing: layout.spacing, rtl: layout.rtl };
  let totalLines = 0;
  let wrappedCount = 0;
  let maxLineCount = 1;
  let totalChars = 0;

  const dialogues = visibleCues.map((cue) => {
    const enrichedCue = applyFutureVisualExtensions(cue, {
      renderProfile,
      visualFeatureFlags
    });
    const lines = buildCueLines(enrichedCue, layout.layout, layout.useUppercase);
    const lineCount = Math.max(1, lines.length);
    totalLines += lineCount;
    maxLineCount = Math.max(maxLineCount, lineCount);
    if (lineCount > 1) wrappedCount += 1;
    totalChars += String(enrichedCue.text || '').length;

    const mV = layout.isVertical ? layout.marginV : cueMarginV(layout.marginV, lineCount, layout.lineHeight);
    const bodyResult = linesToAssText(lines, preset, { disableEmphasis, renderProfile });
    const glowPrefix = preset.glow > 0 ? `{\\blur${Number(preset.glow).toFixed(2)}}` : '';
    const text = `${assRtlPrefix(typoPrefix)}${glowPrefix}${bodyResult.text}`;
    console.log('[caption-emphasis-debug]', {
      originalText: enrichedCue.text,
      emphasisWords: Array.isArray(cue.emphasisWords) ? cue.emphasisWords : bodyResult.emphasisWords,
      finalStyledAssText: text
    });
    return `Dialogue: 0,${toAssTime(enrichedCue.renderStart)},${toAssTime(enrichedCue.renderEnd)},Default,,0,0,${mV},,${text}`;
  });

  const cueCount = dialogues.length;
  const avgLines = cueCount > 0 ? totalLines / cueCount : 1;
  const avgCharsPerCue = cueCount > 0 ? totalChars / cueCount : 0;
  const maxWidthRatio = layout.maxWidthRatio || (playResX - (layout.marginL + layout.marginR)) / playResX;
  const yAnchor = 1 - layout.marginV / playResY;

  // Keep internal metrics for diagnostics payload without verbose logs.
  const assContent = [...header, ...dialogues].join('\n').replace(/\r\n/g, '\n');

  return {
    content: assContent,
    cueCount,
    playResX,
    playResY,
    presetId: preset.id,
    placement: layout.placement,
    captionMode,
    rtl: layout.rtl,
    cueIntegrity: integrityReport,
    continuity,
    visualContinuity,
    visibility,
    density,
    readabilityScore: readability,
    renderProfile: {
      id: renderProfile.id,
      styleMode: renderProfile.styleMode,
      safeguardsActive: renderProfile.safeguardsActive,
      reasons: renderProfile.reasons
    },
    visualFeatures: visualFeatureFlags,
    layoutMeta: {
      fontSize: layout.fontSize,
      marginV: layout.marginV,
      isVertical: layout.isVertical,
      yAnchor: Number(yAnchor.toFixed(3)),
      maxWidth: Number(maxWidthRatio.toFixed(3)),
      avgLines: Number(avgLines.toFixed(2)),
      wrapped: wrappedCount > 0
    }
  };
}

export function generateAssFromExportDoc(exportDoc, dims = {}) {
  if (!exportDoc || exportDoc.format !== 'cutup-style-v1') {
    throw new Error('Invalid export document: expected cutup-style-v1');
  }
  const presetId = dims.presetIdOverride || exportDoc.preset?.id || exportDoc.cues?.[0]?.stylePresetId;
  if (!presetId) {
    const err = new Error('PRESET_NOT_APPLIED: missing_export_preset');
    err.code = 'PRESET_NOT_APPLIED';
    throw err;
  }
  const segments = (exportDoc.cues || []).map((c) => ({
    start: c.start,
    end: c.end,
    text: c.text || (c.lines || []).join(' ')
  }));
  return generateAssContent(segments, presetId, dims);
}
