/**
 * Line-count forensic for viral export captions (read-only).
 * Enable: LINE_LAYOUT_FORENSIC=1
 * Writes: {jobDir}/LINE-LAYOUT-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { isRtlText } from './rtl-text.js';
import {
  buildPhraseBurnSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows
} from './subtitle-pipeline.js';
import { resolveRenderLayout, resolveCueLineLayout } from './layout-engine.js';
import {
  buildCueLines,
  layoutLines,
  layoutLinesLegacyStack,
  words
} from './text-layout.js';
import { isSemanticSegmentationProductionEnabled } from '../segmentation-quality-score.js';

const MAX_CUES = 50;

export function isLineLayoutForensicEnabled() {
  return String(process.env.LINE_LAYOUT_FORENSIC ?? '1') !== '0';
}

function lineFields(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  return {
    line1: arr[0] || null,
    line2: arr[1] || null,
    line3: arr[2] || null,
    line4: arr[3] || null,
    line5: arr[4] || null
  };
}

function traceLegacyStack(text, layout) {
  const w = words(text);
  const min = Math.max(1, layout.wordsPerLineMin || 2);
  const max = Math.max(min, layout.wordsPerLineMax || 6);
  const maxChars = Math.max(8, layout.maxCharsPerLine || 22);
  const maxLines = Number(layout.maxLines || 0);

  const afterSplit = [];
  let line = [];
  for (let i = 0; i < w.length; i++) {
    line.push(w[i]);
    const previewLen = line.join(' ').length;
    const hitWordCap = line.length >= max;
    const hitCharCap = previewLen >= maxChars && line.length >= min;
    if (hitWordCap || hitCharCap) {
      afterSplit.push([...line]);
      line = [];
    }
  }
  if (line.length) afterSplit.push(line);
  const afterSplitLines = afterSplit.map((parts) => parts.join(' ').trim()).filter(Boolean);

  const legacyLines = layoutLinesLegacyStack(text, layout);
  const productionLines = layoutLines(text, layout);

  return {
    wordCount: w.length,
    layoutMaxLines: maxLines,
    afterSplitSemanticStackLineCount: afterSplitLines.length,
    afterSplitSemanticStackLines: afterSplitLines,
    layoutLinesLegacyStackLineCount: legacyLines.length,
    layoutLinesLegacyStackLines: legacyLines,
    layoutLinesProductionLineCount: productionLines.length,
    layoutLinesProductionLines: productionLines,
    semanticProductionEnabled: isSemanticSegmentationProductionEnabled()
  };
}

/**
 * @param {object} opts
 */
export function buildLineLayoutForensicsReport(opts = {}) {
  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const playResX = Number(opts.playResX || preset.playResX || 1080);
  const playResY = Number(opts.playResY || preset.playResY || 1920);
  const segments = Array.isArray(opts.segments) ? opts.segments : [];

  const phraseCues = buildPhraseBurnSubtitles(segments);
  const visualCues = buildVisualCueView(phraseCues, captionMode);
  const visibleCues =
    captionMode === 'accurate'
      ? visualCues
      : applyVisualReadabilityWindows(visualCues, {
          minCueDurationSec: Number(opts.minCueDurationSec ?? 0.74),
          minGapSec: 0.035,
          maxTailExtensionSec: 0.48,
          maxLeadExtensionSec: 0.16,
          videoDurationSec: Number(opts.durationSec ?? 0)
        });

  const layout = resolveRenderLayout(
    {
      playResX,
      playResY,
      durationSec: opts.durationSec || 0,
      positionMode: opts.positionMode || preset.positionMode || 'adaptive'
    },
    visibleCues,
    preset
  );

  const assDialogues = opts.assResult?.timingAudit?.assDialogues || [];
  const cues = [];
  let firstOverTwo = null;
  let maxLineCount = 0;

  for (let i = 0; i < Math.min(MAX_CUES, visibleCues.length); i++) {
    const cue = visibleCues[i] || {};
    const phraseText = String(cue.text || '');
    const cueRtl = isRtlText(phraseText);
    const cueLineLayout = resolveCueLineLayout(layout.layout, phraseText);
    const trace = traceLegacyStack(phraseText, cueLineLayout);
    const productionLines = buildCueLines(
      cue,
      cueLineLayout,
      layout.useUppercase && !cueRtl
    );
    const assPlain = String(assDialogues[i]?.text || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n');
    const assLineCount = assPlain.trim() ? assPlain.split(/\n/).filter(Boolean).length : 0;

    const lineCount = productionLines.length;
    maxLineCount = Math.max(maxLineCount, lineCount, assLineCount);

    const entry = {
      cueIndex: i,
      phraseText: phraseText.slice(0, 200),
      phraseWordCount: trace.wordCount,
      lineCount,
      assDialogueLineCount: assLineCount || null,
      ...lineFields(productionLines),
      cueRtl,
      layoutMode: cueLineLayout.mode,
      layoutMaxLines: cueLineLayout.maxLines,
      layoutWordsPerLineMax: cueLineLayout.wordsPerLineMax,
      layoutMaxCharsPerLine: cueLineLayout.maxCharsPerLine,
      trace
    };

    cues.push(entry);

    if (!firstOverTwo && (lineCount > 2 || trace.layoutLinesLegacyStackLineCount > 2)) {
      let introducedAtFunction = 'buildCueLines → layoutLines';
      if (trace.semanticProductionEnabled && trace.layoutLinesProductionLineCount > 2) {
        introducedAtFunction = 'layoutLines → compareAndSelectSegmentation (SEMANTIC_SEGMENTATION_PRODUCTION=1)';
      } else if (trace.layoutLinesLegacyStackLineCount > 2) {
        introducedAtFunction = 'layoutLinesLegacyStack → splitSemanticStack (before clampToMaxLines)';
      } else if (trace.afterSplitSemanticStackLineCount > 2 && trace.layoutMaxLines < 2) {
        introducedAtFunction = 'clampToMaxLines skipped (layout.maxLines=0)';
      } else if (lineCount > 2 && trace.layoutMaxLines >= 2) {
        introducedAtFunction = 'clampToMaxLines failed to reduce to 2 lines for this phrase';
      }

      firstOverTwo = {
        cueIndex: i,
        lineCount,
        introducedAtFunction,
        phraseTextPreview: phraseText.slice(0, 120),
        legacyStackLineCount: trace.layoutLinesLegacyStackLineCount,
        productionLineCount: trace.layoutLinesProductionLineCount
      };
    }
  }

  const overTwoCues = cues.filter((c) => c.lineCount > 2);

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    presetId,
    captionMode,
    globalLayout: layout.layout,
    layoutEstimateMaxLines: layout.maxLines,
    semanticProductionEnabled: isSemanticSegmentationProductionEnabled(),
    phraseCueCount: phraseCues.length,
    sampledCueCount: cues.length,
    maxLineCountObserved: maxLineCount,
    cuesWithMoreThanTwoLines: overTwoCues.length,
    first50PhraseCues: cues,
    firstViolation: firstOverTwo,
    rootCauseAttribution: firstOverTwo
      ? {
          function: firstOverTwo.introducedAtFunction,
          requirement: 'maxLines=2 hard limit for viral export',
          note:
            'composeRhythmBlocks phrase length is not split when layout exceeds 2 lines — new phrase cues are not created in export pipeline.'
        }
      : maxLineCount > 2
        ? {
            function: 'ass dialogue soft-wrap or assDialogueLineCount mismatch',
            note: 'buildCueLines may report ≤2 lines while burned ASS shows more \\N-separated lines — check assDialogueLineCount column.'
          }
        : {
            note: 'First 50 cues: buildCueLines lineCount ≤ 2. If MP4 still shows 4+ lines, cause is likely libass auto-wrap (long lines / narrow margin) not buildCueLines output.'
          },
    traceChain: [
      'buildPhraseBurnSubtitles (phrase text — not modified here)',
      'resolveRenderLayout → layout.maxLines, wordsPerLineMax',
      'resolveCueLineLayout (RTL → maxLines=1)',
      'splitSemanticStack → rebalance → clampToMaxLines (layoutLinesLegacyStack)',
      'layoutLines (production)',
      'buildCueLines',
      'linesToAssText (\\N join)'
    ]
  };
}

export function logLineLayoutForensics(opts = {}) {
  if (!isLineLayoutForensicEnabled()) return null;
  if (!opts.segments?.length) return null;

  const report = buildLineLayoutForensicsReport(opts);
  console.log('[line-layout-forensics-summary]', JSON.stringify(report.firstViolation || report.rootCauseAttribution));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'LINE-LAYOUT-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[line-layout-forensics] write failed:', err?.message);
    }
  }

  return report;
}
