/**
 * Export root-cause forensics (read-only). Evidence for RTL emphasis loss + timing drift attribution.
 * Enable: EXPORT_ROOT_CAUSE_FORENSIC=1
 * Writes: {jobDir}/EXPORT-ROOT-CAUSE-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { isDebugExportEnabled } from './export-debug.js';
import { isRtlText } from './rtl-text.js';
import {
  buildPhraseBurnSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows
} from './subtitle-pipeline.js';
import { resolveRenderLayout } from './layout-engine.js';
import { buildCueLines } from './text-layout.js';

const MAX_CUES = 12;

export function isExportRootCauseForensicEnabled() {
  return isDebugExportEnabled() && String(process.env.EXPORT_ROOT_CAUSE_FORENSIC ?? '1') !== '0';
}

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : null;
}

function driftMs(fromSec, toSec) {
  if (fromSec == null || toSec == null) return null;
  return Math.round((Number(toSec) - Number(fromSec)) * 1000);
}

function findSourceSegmentForPhrase(phrase, segments) {
  const anchor = Number(phrase.firstWordStart ?? phrase.start);
  if (!Number.isFinite(anchor)) return null;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!s) continue;
    const ss = Number(s.start);
    const se = Number(s.end);
    if (anchor >= ss - 0.08 && anchor <= se + 0.08) return { index: i, segment: s, match: 'time_overlap' };
    const dist = anchor < ss ? ss - anchor : anchor - se;
    if (dist < bestDist) {
      bestDist = dist;
      best = { index: i, segment: s, match: 'nearest' };
    }
  }
  return bestDist < 2.5 ? best : null;
}

/**
 * RTL / MrBeast emphasis attribution (no behavior changes).
 */
export function buildRtlEmphasisAttributionReport(opts = {}) {
  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const cues = Array.isArray(opts.canonicalCues) ? opts.canonicalCues : [];
  const layout = opts.layout || { rtl: cues.some((c) => isRtlText(c?.text)) };

  const disableEmphasisGlobal = Boolean(layout.rtl) || captionMode === 'accurate';
  const globalReason = layout.rtl
    ? 'ass-generator.js disableEmphasis = layout.rtl || captionMode===accurate (line ~586)'
    : captionMode === 'accurate'
      ? 'captionMode accurate disables inline emphasis'
      : null;

  const perCue = [];
  for (let i = 0; i < Math.min(MAX_CUES, cues.length); i++) {
    const cue = cues[i];
    const cueText = String(cue?.text || '');
    const cueRtl = isRtlText(cueText);
    const disableEffective = disableEmphasisGlobal || cueRtl;
    const lines = buildCueLines(cue, preset.layout || {}, Boolean(preset.uppercase) && !cueRtl);

    perCue.push({
      cueIndex: i,
      textPreview: cueText.slice(0, 80),
      cueRtl,
      layoutRtl: Boolean(layout.rtl),
      disableEmphasisGlobal,
      disableEmphasisPerCue: cueRtl,
      disableEmphasisEffective: disableEffective,
      presetEmphasisHandler: preset.emphasis?.handler || null,
      presetEmphasisMode: preset.emphasis?.mode || null,
      buildCueLinesLineCount: lines.length,
      linesToAssTextWouldRun: !disableEffective,
      linesToAssTextOutcome: disableEffective
        ? 'returns escapeAssText only; emphasisWords: []'
        : 'would run analyzeTextWithEmphasis + buildInlineEmphasis (mrbeast cycleWords)',
      buildRtlDialogueTextApplied: cueRtl,
      buildRtlDialogueTextOutcome: cueRtl
        ? 'passthrough plain text — strips/no inline {\\c...} tags'
        : 'not called (LTR uses bottom anchor + bodyResult.text)',
      emphasisWordsExpected: disableEffective ? [] : 'non-empty for mrbeast cycleWords',
      rtlStyleName: cueRtl ? `RTL_${String(presetId).replace(/[^a-zA-Z0-9_]/g, '_')}` : 'Default'
    });
  }

  const rtlCues = perCue.filter((c) => c.cueRtl);
  return {
    presetId,
    resolvedPresetId: preset.id,
    emphasisConfig: preset.emphasis || null,
    layoutRtl: Boolean(layout.rtl),
    captionMode,
    disableEmphasisGlobal,
    globalDisableReason: globalReason,
    rtlCueCount: rtlCues.length,
    perCueSamples: perCue,
    attributionChain: [
      {
        step: 1,
        function: 'resolveRenderLayout / cuesAreMostlyRtl',
        effect: layout.rtl ? 'layout.rtl=true for RTL-heavy export' : 'layout.rtl=false'
      },
      {
        step: 2,
        function: 'ass-generator generateAssContent',
        line: '~586',
        effect: `disableEmphasis=${disableEmphasisGlobal} — linesToAssText skips mrbeast handler`
      },
      {
        step: 3,
        function: 'linesToAssText',
        line: '~187-189',
        effect: 'if disableEmphasis: emphasisWords=[] and no {\\c} inline tags'
      },
      {
        step: 4,
        function: 'visibleCues.map → linesToAssText',
        line: '~672-673',
        effect: 'per-cue: disableEmphasis || cueRtl — RTL cues always disable'
      },
      {
        step: 5,
        function: 'buildRtlDialogueText',
        line: '~314-315',
        effect: 'RTL Dialogue: plain string only; preset colors via RTL_* style row, not per-word cycle'
      }
    ],
    rootCause:
      disableEmphasisGlobal || rtlCues.length
        ? 'MrBeast cycleWords inline emphasis is intentionally disabled when layout.rtl or cueRtl; buildRtlDialogueText does not add inline ASS tags. Style row RTL_mrBeast applies font/outline/colors only — not per-word highlight cadence.'
        : 'Emphasis path active for LTR cues'
  };
}

/**
 * Phrase timing attribution with word-aligned comparison (not index-aligned).
 */
export function buildPhraseTimingAttributionReport(rawSegments, opts = {}) {
  const segments = (Array.isArray(rawSegments) ? rawSegments : []).filter(
    (s) => s && typeof s.start === 'number' && typeof s.end === 'number'
  );
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const useSourceAligned = captionMode === 'accurate';

  const phraseCues = useSourceAligned
    ? []
    : buildPhraseBurnSubtitles(segments);
  const visualCues = buildVisualCueView(phraseCues, captionMode);
  const visibleCues = useSourceAligned
    ? visualCues
    : applyVisualReadabilityWindows(visualCues, {
        minCueDurationSec: Number(opts.minCueDurationSec ?? 0.74),
        minGapSec: 0.035,
        maxTailExtensionSec: 0.48,
        maxLeadExtensionSec: 0.16,
        videoDurationSec: Number(opts.durationSec ?? 0)
      });

  const assDialogues = Array.isArray(opts.assDialogues) ? opts.assDialogues : [];
  const indexMiscompareRows = [];
  const wordAlignedRows = [];
  const stageDeltas = [];

  for (let i = 0; i < Math.min(MAX_CUES, Math.max(segments.length, phraseCues.length)); i++) {
    const seg = segments[i];
    const phrase = phraseCues[i];
    const vis = visibleCues[i];
    const ass = assDialogues[i];

    const originalStart = roundSec(seg?.start);
    const exportByIndex = roundSec(phrase?.start ?? ass?.assStart);
    const indexDriftMs = driftMs(originalStart, exportByIndex);

    indexMiscompareRows.push({
      index: i,
      originalStart,
      originalEnd: roundSec(seg?.end),
      exportStartByIndex: exportByIndex,
      assStartByIndex: roundSec(ass?.assStart),
      indexAlignedStartDriftMs: indexDriftMs,
      note:
        seg && phrase && indexDriftMs != null && Math.abs(indexDriftMs) > 500
          ? 'LIKELY ARTIFACT: input segment[i] compared to phrase cue[i] — different entities after composeRhythmBlocks'
          : undefined
    });
  }

  for (let i = 0; i < Math.min(MAX_CUES, phraseCues.length); i++) {
    const phrase = phraseCues[i];
    const vis = visibleCues[i];
    const ass = assDialogues[i];
    const src = findSourceSegmentForPhrase(phrase, segments);
    const sourceStart = roundSec(src?.segment?.start);
    const sourceEnd = roundSec(src?.segment?.end);

    const stages = {
      sourceSegmentStart: sourceStart,
      sourceSegmentEnd: sourceEnd,
      composeRhythm_firstWordStart: roundSec(phrase.firstWordStart),
      composeRhythm_lastWordEnd: roundSec(phrase.lastWordEnd),
      composeRhythm_start: roundSec(phrase.start),
      composeRhythm_end: roundSec(phrase.end),
      composeRhythm_adjustedStart: roundSec(phrase.adjustedStart),
      composeRhythm_adjustedEnd: roundSec(phrase.adjustedEnd),
      composeRhythm_driftCorrectionApplied: phrase.driftCorrectionApplied ?? 0,
      buildVisualCueView_start: roundSec(vis?.sourceStart ?? vis?.start),
      applyVisualReadability_renderStart: roundSec(vis?.renderStart),
      applyVisualReadability_renderEnd: roundSec(vis?.renderEnd),
      assDialogueStart: roundSec(ass?.assStart),
      assDialogueEnd: roundSec(ass?.assEnd)
    };

    const deltas = [
      {
        stage: 'composeRhythmBlocks → reanchorBlockTiming',
        function: 'reanchorBlockTiming / speechAnchorStart',
        deltaMs: driftMs(sourceStart, stages.composeRhythm_start),
        note: 'start = firstWordStart - adaptive preroll (SYNC_PREROLL_MAX 25ms)'
      },
      {
        stage: 'firstWordStart vs source segment start',
        function: 'normalizeWordTimeline word anchors',
        deltaMs: driftMs(sourceStart, stages.composeRhythm_firstWordStart),
        note: 'Word-level anchor may differ from SRT segment boundary'
      },
      {
        stage: 'detectAndCorrectDrift',
        function: 'detectAndCorrectDrift',
        deltaMs: stages.composeRhythm_driftCorrectionApplied
          ? Math.round(Number(stages.composeRhythm_driftCorrectionApplied) * 1000)
          : 0,
        note: 'rolling correction applied to block start/end'
      },
      {
        stage: 'applyVisualReadabilityWindows',
        function: 'applyVisualReadabilityWindows',
        deltaMs: driftMs(stages.composeRhythm_start, stages.applyVisualReadability_renderStart),
        note: 'extends renderStart earlier up to maxLeadExtensionSec'
      },
      {
        stage: 'ASS Dialogue syncStart',
        function: 'generateAssContent visibleCues.map',
        deltaMs: driftMs(stages.composeRhythm_start, stages.assDialogueStart),
        note: 'phrase path: sourceStart ?? start ?? renderStart'
      },
      {
        stage: 'WORD-ALIGNED: source segment → ass dialogue',
        function: 'end-to-end (matched segment)',
        deltaMs: driftMs(sourceStart, stages.assDialogueStart),
        note: 'True drift vs owning input segment (not index i)'
      }
    ];

    wordAlignedRows.push({
      phraseIndex: i,
      sourceSegmentIndex: src?.index ?? null,
      sourceMatch: src?.match ?? null,
      textPreview: String(phrase.text || '').slice(0, 80),
      stages,
      deltas
    });

    for (const d of deltas) {
      if (d.deltaMs != null) stageDeltas.push({ phraseIndex: i, ...d });
    }
  }

  const indexDrifts = indexMiscompareRows
    .map((r) => r.indexAlignedStartDriftMs)
    .filter((v) => v != null)
    .map((v) => Math.abs(v));
  const wordDrifts = wordAlignedRows
    .map((r) => r.deltas.find((d) => d.stage === 'WORD-ALIGNED: source segment → ass dialogue')?.deltaMs)
    .filter((v) => v != null)
    .map((v) => Math.abs(v));

  return {
    pipelinePath: useSourceAligned ? 'source-aligned-accurate' : 'phrase-rhythm',
    inputSegmentCount: segments.length,
    phraseCueCount: phraseCues.length,
    assDialogueCount: assDialogues.length,
    misleadingIndexComparison: {
      description:
        'caption-forensics / timing-forensics compare exportInput[i] to canonicalCues[i] by index. After composeRhythmBlocks, cue count and order differ from input segments — produces multi-second fake drift.',
      averageIndexAlignedDriftMs: indexDrifts.length
        ? Math.round(indexDrifts.reduce((a, b) => a + b, 0) / indexDrifts.length)
        : 0,
      maximumIndexAlignedDriftMs: indexDrifts.length ? Math.max(...indexDrifts) : 0,
      examples: indexMiscompareRows.filter((r) => r.indexAlignedStartDriftMs != null && Math.abs(r.indexAlignedStartDriftMs) > 2000).slice(0, 5)
    },
    wordAlignedTiming: {
      averageWordAlignedDriftMs: wordDrifts.length
        ? Math.round(wordDrifts.reduce((a, b) => a + b, 0) / wordDrifts.length)
        : 0,
      maximumWordAlignedDriftMs: wordDrifts.length ? Math.max(...wordDrifts) : 0,
      perPhraseSamples: wordAlignedRows
    },
    functionsThatChangeStartTime: [
      {
        function: 'normalizeWordTimeline',
        module: 'subtitle-pipeline.js',
        changes: 'Builds per-word start/end from seg.words or linear split within segment bounds'
      },
      {
        function: 'composeRhythmBlocks → reanchorBlockTiming',
        module: 'subtitle-pipeline.js',
        changes: 'phrase.start = speechAnchorStart(wordTimeline) - preroll; NOT equal to input segment.start'
      },
      {
        function: 'composeRhythmBlocks → detectAndCorrectDrift',
        module: 'subtitle-pipeline.js',
        changes: 'Rolling start/end correction on blocks (driftCorrectionApplied)'
      },
      {
        function: 'composeRhythmBlocks → eliminateCaptionOverlaps',
        module: 'subtitle-pipeline.js',
        changes: 'May shorten end of previous block'
      },
      {
        function: 'validateAndFixCaptionTimingForExport',
        module: 'subtitle-pipeline.js',
        changes: 'Clamps duration / overlap gaps only (typically small)'
      },
      {
        function: 'applyVisualReadabilityWindows',
        module: 'subtitle-pipeline.js',
        changes: 'renderStart can move earlier (maxLeadExtensionSec); ASS uses renderStart in phrase path'
      },
      {
        function: 'generateAssContent syncStart',
        module: 'ass-generator.js',
        changes: 'assStart = sourceStart ?? start ?? renderStart'
      }
    ],
    whySixSecondDriftAppears:
      indexMiscompareRows.some((r) => Math.abs(r.indexAlignedStartDriftMs || 0) > 5000)
        ? 'Primary: index-misaligned forensic compares segment N start (~10.5s) with phrase cue N start (~4.0s). Phrase cue 5 is NOT translation of segment 5. Secondary: word-level reanchorBlockTiming shifts within hundreds of ms of true speech.'
        : 'Drift driven by word-level reanchor + readability window; verify word-aligned rows.',
    indexMiscompareRows
  };
}

export function buildExportRootCauseForensicsReport(opts = {}) {
  const rawSegments = opts.rawSegments || opts.segments || [];
  const assResult = opts.assResult || {};
  const presetId = opts.presetId || 'mrBeast';
  const canonicalCues = assResult.timingAudit?.normalizedCues || [];
  const assDialogues = assResult.timingAudit?.assDialogues || [];

  let layout = opts.layout || null;
  if (!layout && canonicalCues.length) {
    try {
      const preset = getStylePreset(resolvePresetIdOrThrow(presetId));
      layout = resolveRenderLayout(
        {
          playResX: opts.playResX || preset.playResX || 1080,
          playResY: opts.playResY || preset.playResY || 1920,
          durationSec: opts.durationSec || 0,
          positionMode: opts.positionMode || preset.positionMode || 'adaptive'
        },
        buildVisualCueView(canonicalCues, opts.captionMode || 'viral'),
        preset
      );
    } catch {
      layout = { rtl: canonicalCues.some((c) => isRtlText(c?.text)) };
    }
  }

  const rtlEmphasis = buildRtlEmphasisAttributionReport({
    presetId,
    captionMode: opts.captionMode,
    canonicalCues,
    layout: layout || { rtl: false }
  });

  const phraseTiming = buildPhraseTimingAttributionReport(rawSegments, {
    captionMode: opts.captionMode,
    durationSec: opts.durationSec,
    assDialogues,
    minCueDurationSec: opts.minCueDurationSec
  });

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    presetLineage: {
      requestedPreset: presetId,
      resolvedPreset: rtlEmphasis.resolvedPresetId,
      rtlStyleName: rtlEmphasis.perCueSamples[0]?.rtlStyleName || null
    },
    rtlEmphasisAttribution: rtlEmphasis,
    phraseTimingAttribution: phraseTiming,
    executiveSummary: {
      presetSelectionLost: false,
      mrBeastInlineEmphasisOnRtl: false,
      mrBeastEmphasisRootCause: rtlEmphasis.rootCause,
      timingDriftSixSecondsExplained: phraseTiming.whySixSecondDriftAppears,
      realTimingDriftUseMetric: 'phraseTimingAttribution.wordAlignedTiming.averageWordAlignedDriftMs'
    }
  };
}

export function logExportRootCauseForensics(opts = {}) {
  if (!isExportRootCauseForensicEnabled()) return null;

  const report = buildExportRootCauseForensicsReport(opts);

  console.log('[export-root-cause-forensics-summary]', JSON.stringify(report.executiveSummary));
  console.log('[export-root-cause-rtl-emphasis]', JSON.stringify(report.rtlEmphasisAttribution.rootCause));
  console.log(
    '[export-root-cause-timing-index-vs-word]',
    JSON.stringify({
      misleadingAverageMs: report.phraseTimingAttribution.misleadingIndexComparison.averageIndexAlignedDriftMs,
      wordAlignedAverageMs: report.phraseTimingAttribution.wordAlignedTiming.averageWordAlignedDriftMs,
      why: report.phraseTimingAttribution.whySixSecondDriftAppears
    })
  );

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'EXPORT-ROOT-CAUSE-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[export-root-cause-forensics] write failed:', err?.message);
    }
  }

  return report;
}
