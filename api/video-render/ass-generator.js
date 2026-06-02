/**
 * ASS subtitle file generator for FFmpeg burn-in.
 */
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { buildCueLines } from './text-layout.js';
import { analyzeTextWithEmphasis, shouldEmphasize, markSpokenWord } from './emphasis-engine.js';
import {
  buildPhraseBurnSubtitles,
  buildSourceAlignedSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows,
  validateVisualVisibility,
  validateVisualContinuity,
  subtitleDensityMetrics,
  readabilityScore,
  assertCueIntegrity,
  continuitySummary
} from './subtitle-pipeline.js';
import {
  resolveRenderLayout,
  resolveCueLineLayout,
  orderAssLinesBottomFirst,
  buildAssBottomAnchorTag
} from './layout-engine.js';
import { isRtlText, resolveRtlFontName } from './rtl-text.js';
import { isTimingForensicEnabled, logTimingForensics } from './timing-forensics.js';
import {
  isCaptionForensicEnabled,
  buildCaptionForensicRecords,
  logCaptionForensics
} from './caption-forensics.js';
import { auditSourceAlignedPipelineStages } from './subtitle-pipeline.js';
import {
  isSubtitleTextForensicEnabled,
  logSubtitleTextForensicStage,
  forensicMaxCues
} from './subtitle-text-forensics.js';

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

function resolvePresetVisualSignature(preset) {
  if (preset?.useFixedTypography) {
    return {
      fontOffset: 0,
      outlineScale: 1,
      shadowScale: 1,
      glow: Number(preset.glow) || 0,
      emphasisBoost: 1,
      inlineEmphasisBonus: 0,
      forceBold: preset.bold ? true : false
    };
  }
  return {
    fontOffset: 0,
    outlineScale: 1,
    shadowScale: 1,
    glow: 0,
    emphasisBoost: 1,
    inlineEmphasisBonus: 0,
    forceBold: null
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

function buildInlineEmphasis(token, preset, { wordIndex = 0, segmentIndex = 0 } = {}) {
  const handler = preset.emphasis?.handler || 'default';
  const text = escapeAssText(token.text);

  if (handler === 'mrbeast') {
    const colors = preset.emphasis?.wordColors || [
      '&H004444FF&',
      '&H0000E5FF&',
      '&H0088FF44&',
      '&H00FFAA44&'
    ];
    const color = colors[wordIndex % colors.length];
    return `{\\c${color}\\b1}${text}{\\r}`;
  }

  if (handler === 'hormozi' && token.spoken) {
    const color = preset.emphasis?.highlightColor || '&H0000E5FF&';
    return `{\\c${color}\\b1}${text}{\\r}`;
  }

  if (handler === 'neon' && token.spoken) {
    const palette = preset.emphasis?.neonColors || ['&H00FFFF00&', '&H00FF00FF&'];
    const color = palette[segmentIndex % palette.length];
    return `{\\c${color}\\b1\\blur3\\3c${color}}${text}{\\r}`;
  }

  if (handler === 'minimal' || handler === 'luxury') {
    return text;
  }

  const weight = handler === 'minimal' || handler === 'luxury' ? '\\b0' : '\\b1';
  return `{\\c${preset.secondaryColor}${weight}}${text}{\\r}`;
}

function linesToAssText(lines, preset, { disableEmphasis = false, renderProfile, cue, segmentIndex = 0 } = {}) {
  if (disableEmphasis) {
    return { text: lines.map((line) => escapeAssText(line)).join('\\N'), emphasisWords: [] };
  }

  const handler = preset.emphasis?.handler || 'default';
  const mode = preset.emphasis?.mode || 'score';
  const profileInline = Math.max(1, Math.min(2, renderProfile?.maxInlineEmphasisPerCue || 2));
  const presetInline = Number(preset.emphasis?.maxPerLine || 0);
  const maxInline =
    mode === 'spokenWord' ? 1 : mode === 'cycleWords' ? 99 : clamp(Math.max(profileInline, presetInline), 1, 2);
  let emphasized = 0;
  let wordIndex = 0;
  const parts = [];
  const emphasisWords = [];

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) parts.push('\\N');
    let tokens = analyzeTextWithEmphasis(lines[li], handler);
    if (mode === 'spokenWord' && cue) {
      tokens = markSpokenWord(tokens, cue.words, cue.start, cue.end);
    }

    for (const token of tokens) {
      if (token.isSpace) {
        parts.push(token.text);
        continue;
      }

      if (handler === 'mrbeast' && mode === 'cycleWords') {
        parts.push(buildInlineEmphasis(token, preset, { wordIndex, segmentIndex }));
        emphasisWords.push(String(token.clean || token.text || '').toLowerCase());
        wordIndex += 1;
        continue;
      }

      if (emphasized < maxInline && shouldEmphasize(token, handler)) {
        parts.push(buildInlineEmphasis(token, preset, { wordIndex, segmentIndex }));
        emphasisWords.push(String(token.clean || token.text || '').toLowerCase());
        emphasized += 1;
        wordIndex += 1;
      } else {
        parts.push(escapeAssText(token.text));
        wordIndex += 1;
      }
    }
  }
  return { text: parts.join(''), emphasisWords: [...new Set(emphasisWords)] };
}

/** ASS Style Encoding: 0 = Unicode (proven for Persian libass burn); 1 breaks BiDi on export cues. */
const ASS_STYLE_ENCODING_UNICODE = 0;

function styleLine(name, preset, encoding = ASS_STYLE_ENCODING_UNICODE) {
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
    encoding
  ].join(',');
}

/** ASS style name for RTL cues — separate from LTR Default (libass Encoding=0 + Vazirmatn). */
function resolveRtlPresetStyleName(presetId) {
  const safe = String(presetId || 'Default').replace(/[^a-zA-Z0-9_]/g, '_');
  return `RTL_${safe}`;
}

/**
 * RTL-safe style row: preset colors/outline/shadow/size; Vazirmatn + Encoding=0 + no stretch (proven burn).
 * Visual preset values come from `preset`; RTL-safe differs only in font + encoding + scaleY/spacing for libass.
 */
function buildRtlPresetStyleLine(styleName, preset, marginV) {
  const marginL = preset.marginL ?? Math.round((preset.playResX || 1080) * 0.08);
  const marginR = preset.marginR ?? marginL;
  return [
    `Style: ${styleName}`,
    resolveRtlFontName(),
    preset.fontSize,
    preset.primaryColor,
    preset.secondaryColor,
    preset.outlineColor,
    preset.backColor,
    preset.bold ? -1 : 0,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    preset.borderStyle ?? 1,
    preset.outline,
    preset.shadow,
    preset.alignment ?? 2,
    marginL,
    marginR,
    marginV,
    ASS_STYLE_ENCODING_UNICODE
  ].join(',');
}

/**
 * RTL Dialogue: plain escaped text only (no inline emphasis / pos overrides — style row handles look).
 * @param {string} assBodyText
 */
function buildRtlDialogueText(assBodyText) {
  return String(assBodyText || '');
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

  const forensicCtx = dims.forensicCtx && typeof dims.forensicCtx === 'object' ? dims.forensicCtx : {};
  const rawSegments = Array.isArray(segments) ? segments : [];
  const forensicSample = rawSegments.map((s) => s?.text).find(Boolean) || '';
  if (isSubtitleTextForensicEnabled(forensicSample)) {
    logSubtitleTextForensicStage(
      'render_input_segments',
      rawSegments.map((seg, i) => ({
        id: seg?.id ?? `seg-${i}`,
        text: String(seg?.text || '')
      })),
      forensicCtx
    );
  }
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

  const captionModeNorm = String(captionMode || 'viral').toLowerCase();
  const useSourceAlignedTimings = captionModeNorm === 'accurate';
  const inputSegmentCount = finalOnlySegments.length;
  const canonicalSubtitles = useSourceAlignedTimings
    ? buildSourceAlignedSubtitles(finalOnlySegments)
    : buildPhraseBurnSubtitles(finalOnlySegments);
  const exportPhraseCueCount = canonicalSubtitles.length;
  console.log('[burn-caption-export]', {
    path: useSourceAlignedTimings ? 'source-aligned-segment' : 'phrase-rhythm',
    captionMode: captionModeNorm,
    inputSegmentCount,
    exportPhraseCueCount,
    assDialogueCount: exportPhraseCueCount,
    coalesceSkipped: !useSourceAlignedTimings
  });
  if (isSubtitleTextForensicEnabled(forensicSample)) {
    logSubtitleTextForensicStage(
      'after_subtitle_pipeline_normalization',
      canonicalSubtitles.map((cue, i) => ({
        id: cue?.id ?? `cue-${i}`,
        text: String(cue?.text || '')
      })),
      forensicCtx
    );
  }
  if (!canonicalSubtitles.length) {
    throw new Error('SUBTITLE_CANONICAL_EMPTY');
  }
  console.log('[ass-timing-path]', {
    useSourceAlignedTimings,
    captionMode,
    cueCount: canonicalSubtitles.length,
    note: useSourceAlignedTimings
      ? 'ASS Dialogue times match input segments (SRT/preview)'
      : 'ASS uses rhythm blocks from composeRhythmBlocks'
  });
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
  const visibleCues = useSourceAlignedTimings
    ? cues.map((cue) => ({
        ...cue,
        renderStart: Number(cue.sourceStart ?? cue.start),
        renderEnd: Number(cue.sourceEnd ?? cue.end)
      }))
    : applyVisualReadabilityWindows(cues, {
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
  const signature = resolvePresetVisualSignature(basePreset);
  const tunedFontSize = layout.fontSize;
  const tunedOutline = layout.outline > 0 ? layout.outline : 0;
  const tunedShadow = layout.shadow > 0 ? layout.shadow : 0;
  const tunedOutlineByPreset = basePreset.useFixedTypography
    ? tunedOutline
    : tunedOutline > 0
      ? Math.max(1, Math.round(tunedOutline * renderProfile.outlineScale * signature.outlineScale))
      : 0;
  const tunedShadowByPreset = basePreset.useFixedTypography
    ? tunedShadow
    : tunedShadow > 0
      ? Math.max(1, Math.round(tunedShadow * renderProfile.shadowScale * signature.shadowScale))
      : 0;
  const emphasisScalePercent = clamp(
    Math.round((basePreset.emphasis?.scalePercent || 112) * signature.emphasisBoost),
    100,
    140
  );
  const glow = Number((basePreset.glow ?? signature.glow).toFixed(2));

  const hasRtlCues = visibleCues.some((c) => isRtlText(c.text));
  const rtlPresetStyleName = resolveRtlPresetStyleName(selectedPresetId);
  const rtlBurnFont = layout.rtl ? resolveRtlFontName() : null;
  const burnFontName = rtlBurnFont || layout.fontName || basePreset.fontName || 'Arial';

  Object.assign(preset, {
    fontName: burnFontName,
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
    bold: signature.forceBold == null ? Boolean(basePreset.bold) : Boolean(signature.forceBold),
    glow,
    emphasis: {
      ...(basePreset.emphasis || {}),
      maxPerLine: clamp((renderProfile.maxInlineEmphasisPerCue || 2) + signature.inlineEmphasisBonus, 1, 6),
      scalePercent: emphasisScalePercent
    }
  });

  console.log('[preset-style-debug]', {
    requestedPreset: selectedPresetId,
    resolvedPreset: preset.id || selectedPresetId,
    ltrStyleName: 'Default',
    rtlStyleName: hasRtlCues ? rtlPresetStyleName : null,
    fontName: preset.fontName,
    fontSize: preset.fontSize,
    outline: preset.outline,
    shadow: preset.shadow,
    alignment: preset.alignment,
    spacing: preset.spacing,
    scaleY: preset.scaleY,
    primaryColor: preset.primaryColor,
    bold: preset.bold,
    hasRtlCues,
    note: 'RTL cues use RTL_* style (Encoding=0, Vazirmatn); LTR cues use Default'
  });

  const header = layout.rtl
    ? [
        '[Script Info]',
        'Title: Cutup Viral Export',
        'ScriptType: v4.00+',
        `PlayResX: ${playResX}`,
        `PlayResY: ${playResY}`,
        'ScaledBorderAndShadow: yes',
        'WrapStyle: 0',
        ''
      ]
    : [
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
      ];
  const headerWithRtlNote = layout.rtl
    ? [...header, `; RtlFont: ${burnFontName}`, '']
    : header;

  const assHeader = headerWithRtlNote.concat(
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine('Default', preset, layout.rtl ? ASS_STYLE_ENCODING_UNICODE : 1),
    styleLine(
      'Emphasis',
      { ...preset, fontSize: Math.round(preset.fontSize * 1.08), bold: true },
      layout.rtl ? ASS_STYLE_ENCODING_UNICODE : 1
    ),
    ...(hasRtlCues ? [buildRtlPresetStyleLine(rtlPresetStyleName, preset, layout.marginV)] : []),
    '',
    '[Events]',
    ASS_EVENTS_FORMAT
  );
  const disableEmphasis = layout.rtl || captionMode === 'accurate';
  let totalLines = 0;
  let wrappedCount = 0;
  let maxLineCount = 1;
  let totalChars = 0;

  const forensicOn = isSubtitleTextForensicEnabled(forensicSample);
  const forensicCueCap = forensicMaxCues();
  if (forensicOn) {
    logSubtitleTextForensicStage(
      'before_buildCueLines',
      visibleCues.slice(0, forensicCueCap).map((cue, i) => ({
        id: cue?.id ?? `cue-${i}`,
        text: String(cue?.text || '')
      })),
      forensicCtx
    );
  }

  const forensicAfterBuildCueLines = [];
  const forensicAfterLinesToAssText = [];
  const forensicBeforeRtlDialogue = [];
  const forensicFinalDialogue = [];
  const forensicExportSegmentedLines = [];
  let rtlMultilineLineOrderLogs = 0;
  const RTL_MULTILINE_FORENSIC_MAX = 5;
  let rtlLayoutDebugLogged = false;
  const timingAuditRows = [];

  const dialogues = visibleCues.map((cue, segmentIndex) => {
    const enrichedCue = applyFutureVisualExtensions(cue, {
      renderProfile,
      visualFeatureFlags
    });
    const cueText = String(enrichedCue.text || '');
    const cueRtl = isRtlText(cueText);
    const layoutModeBefore = layout.layout?.mode;
    const cueLineLayout = resolveCueLineLayout(layout.layout, cueText);
    const lines = buildCueLines(
      enrichedCue,
      cueLineLayout,
      layout.useUppercase && !cueRtl
    );
    if (cueRtl && !rtlLayoutDebugLogged) {
      rtlLayoutDebugLogged = true;
      console.log('[rtl-layout-debug]', {
        text: cueText,
        isRtlText: true,
        layoutModeBefore,
        layoutModeAfter: cueLineLayout.mode,
        generatedLines: [...lines]
      });
    }
    const cueKey = enrichedCue?.id ?? `cue-${segmentIndex}`;
    if (forensicOn && segmentIndex < forensicCueCap) {
      forensicAfterBuildCueLines.push({
        id: cueKey,
        text: (Array.isArray(lines) ? lines : []).join('\n')
      });
    }
    if (isCaptionForensicEnabled() && segmentIndex < 10) {
      forensicExportSegmentedLines[segmentIndex] = Array.isArray(lines) ? [...lines] : [];
    }
    const lineCount = Math.max(1, lines.length);
    totalLines += lineCount;
    maxLineCount = Math.max(maxLineCount, lineCount);
    if (lineCount > 1) wrappedCount += 1;
    totalChars += String(enrichedCue.text || '').length;

    const assLines = cueRtl ? lines : orderAssLinesBottomFirst(lines);
    if (
      cueRtl &&
      lines.length > 1 &&
      rtlMultilineLineOrderLogs < RTL_MULTILINE_FORENSIC_MAX
    ) {
      rtlMultilineLineOrderLogs += 1;
      console.log(
        JSON.stringify({
          tag: 'rtl-multiline-line-order',
          cueId: cueKey,
          cueRtl: true,
          originalLines: [...lines],
          finalAssLines: [...assLines]
        })
      );
    }
    const bodyResult = linesToAssText(assLines, preset, {
      disableEmphasis: disableEmphasis || cueRtl,
      renderProfile,
      cue: enrichedCue,
      segmentIndex
    });
    if (forensicOn && segmentIndex < forensicCueCap) {
      forensicAfterLinesToAssText.push({ id: cueKey, text: bodyResult.text });
    }

    let text;
    let styleName = 'Default';
    let dialogueMarginV = layout.marginV;

    if (cueRtl) {
      if (forensicOn && segmentIndex < forensicCueCap) {
        forensicBeforeRtlDialogue.push({ id: cueKey, text: bodyResult.text });
      }
      text = buildRtlDialogueText(bodyResult.text);
      styleName = rtlPresetStyleName;
      dialogueMarginV = 0;
    } else {
      const bottomAnchor = buildAssBottomAnchorTag(playResX, playResY, layout.marginV);
      const glowPrefix = preset.glow > 0 ? `{\\blur${Number(preset.glow).toFixed(2)}}` : '';
      text = `${bottomAnchor}${glowPrefix}${bodyResult.text}`;
    }

    if (forensicOn && segmentIndex < forensicCueCap) {
      forensicFinalDialogue.push({ id: cueKey, text, styleName });
    }
    console.log('[caption-emphasis-debug]', {
      originalText: enrichedCue.text,
      cueRtl,
      emphasisWords: Array.isArray(cue.emphasisWords) ? cue.emphasisWords : bodyResult.emphasisWords,
      finalStyledAssText: text
    });
    const syncStart = Number(
      useSourceAlignedTimings
        ? enrichedCue.sourceStart ?? enrichedCue.start
        : enrichedCue.sourceStart ?? enrichedCue.start ?? enrichedCue.renderStart
    );
    const syncEnd = Number(
      useSourceAlignedTimings
        ? enrichedCue.sourceEnd ?? enrichedCue.end
        : Math.max(
            Number(enrichedCue.sourceEnd ?? enrichedCue.end),
            Number(enrichedCue.renderEnd ?? enrichedCue.end)
          )
    );
    timingAuditRows.push({
      id: cueKey,
      text: String(enrichedCue.text || ''),
      assStart: syncStart,
      assEnd: syncEnd,
      styleName
    });

    return `Dialogue: 0,${toAssTime(syncStart)},${toAssTime(syncEnd)},${styleName},,0,0,${dialogueMarginV},,${text}`;
  });

  if (forensicOn) {
    logSubtitleTextForensicStage('after_buildCueLines', forensicAfterBuildCueLines, forensicCtx);
    logSubtitleTextForensicStage('after_linesToAssText', forensicAfterLinesToAssText, forensicCtx);
    logSubtitleTextForensicStage('before_buildRtlDialogueText', forensicBeforeRtlDialogue, forensicCtx);
    logSubtitleTextForensicStage('final_ass_dialogue_text', forensicFinalDialogue, forensicCtx);
  }

  const cueCount = dialogues.length;
  const avgLines = cueCount > 0 ? totalLines / cueCount : 1;
  const avgCharsPerCue = cueCount > 0 ? totalChars / cueCount : 0;
  const maxWidthRatio = layout.maxWidthRatio || (playResX - (layout.marginL + layout.marginR)) / playResX;
  const yAnchor = 1 - layout.marginV / playResY;

  // Keep internal metrics for diagnostics payload without verbose logs.
  const assContent = [...assHeader, ...dialogues].join('\n').replace(/\r\n/g, '\n');

  const timingAudit = {
    rawInputSegments: finalOnlySegments.map((s, i) => ({
      id: s?.id ?? `in-${i}`,
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text || '')
    })),
    normalizedCues: canonicalSubtitles.map((c, i) => ({
      id: c?.id ?? `norm-${i}`,
      start: Number(c.start),
      end: Number(c.end),
      sourceStart: Number(c.sourceStart ?? c.start),
      sourceEnd: Number(c.sourceEnd ?? c.end),
      text: String(c.text || '')
    })),
    assDialogues: timingAuditRows
  };

  if (isTimingForensicEnabled(forensicSample)) {
    logTimingForensics({
      ...timingAudit,
      timelinePlan: dims.timelinePlan || null,
      jobDir: forensicCtx?.jobDir || null,
      jobId: forensicCtx?.jobId || null
    });
  }

  const forensicBundle = isCaptionForensicEnabled()
    ? {
        traceId: forensicCtx?.traceId || forensicCtx?.jobId || null,
        jobId: forensicCtx?.jobId || null,
        selectedPresetFromUI: forensicCtx?.selectedPresetFromUI || null,
        presetReceivedByAPI: forensicCtx?.presetReceivedByAPI || null,
        presetReceivedByRenderQueue: forensicCtx?.presetReceivedByRenderQueue || selectedPresetId,
        presetUsedByASSGenerator: selectedPresetId,
        previewPresetId: forensicCtx?.previewPresetId || selectedPresetId,
        exportPresetId: selectedPresetId,
        whisperSegments: forensicCtx?.transcriptSegments || finalOnlySegments,
        translatedSegments: forensicCtx?.translatedSegments || [],
        exportInputSegments: finalOnlySegments,
        canonicalCues: canonicalSubtitles,
        assDialogues: timingAuditRows,
        exportSegmentedLines: forensicExportSegmentedLines,
        previewRows: forensicCtx?.previewRows || [],
        previewStyleObject: forensicCtx?.previewStyleObject || null,
        pipelineAudit: auditSourceAlignedPipelineStages(finalOnlySegments),
        jobDir: forensicCtx?.jobDir || null
      }
    : null;

  if (forensicBundle) {
    const records = buildCaptionForensicRecords(forensicBundle);
    for (const record of records) {
      console.log('[caption-forensics]', JSON.stringify(record));
    }
  }

  return {
    content: assContent,
    timingAudit,
    forensicBundle,
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
