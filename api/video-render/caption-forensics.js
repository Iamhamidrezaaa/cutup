/**
 * Caption rendering forensic trace — evidence only (no behavior changes).
 * Enable: CAPTION_FORENSIC=1
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import { layoutLinesLegacyStack } from './text-layout.js';
import { BURN_LEAD_DELAY_SEC } from './subtitle-pipeline.js';

export const CAPTION_FORENSIC_MAX = 10;

const SAMPLE_SEGMENTATION_TEXT = 'این بچه تو یه چالش شرکت کرده بود...';

export function isCaptionForensicEnabled() {
  return String(process.env.CAPTION_FORENSIC ?? '1') !== '0';
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundSec(v) {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(3));
}

function deltaMs(a, b) {
  if (a == null || b == null) return null;
  return Math.round((Number(b) - Number(a)) * 1000);
}

/** Preview chunkWords (mirrors website/subtitle-styles/utils/text-layout.js). */
function previewChunkWords(text, layout) {
  const w = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!w.length) return [''];
  const min = layout.wordsPerLineMin || 2;
  const max = layout.wordsPerLineMax || 6;
  if (layout.mode === 'single') return [w.join(' ')];
  const lines = [];
  let i = 0;
  while (i < w.length) {
    const remain = w.length - i;
    const size = remain <= max ? remain : remain - max < min ? remain : max;
    lines.push(w.slice(i, i + size).join(' '));
    i += size;
  }
  return lines.length ? lines : [''];
}

/**
 * Code-proven segmentation split for forensic sample text.
 */
export function proveSegmentationSplit(text = SAMPLE_SEGMENTATION_TEXT, layout = null) {
  const previewLayout = layout || {
    mode: 'stack',
    wordsPerLineMin: 2,
    wordsPerLineMax: 4,
    align: 'center',
    maxWidth: '88%'
  };
  const exportLayout =
    getStylePreset('hormozi').layout ||
    getStylePreset('alexHormozi').layout || {
      mode: 'stack',
      wordsPerLineMin: 2,
      wordsPerLineMax: 4,
      maxCharsPerLine: 18,
      maxLines: 2
    };

  const previewLines = previewChunkWords(text, previewLayout);
  const exportLines = layoutLinesLegacyStack(text, exportLayout);

  return {
    inputText: text,
    preview: {
      module: 'website/subtitle-styles/utils/text-layout.js',
      functionChain: ['layoutLines', 'chunkWords'],
      layout: previewLayout,
      lines: previewLines
    },
    export: {
      module: 'api/video-render/text-layout.js',
      functionChain: [
        'layoutLinesLegacyStack',
        'splitSemanticStack',
        'rebalanceTrailingOrphan',
        'rebalanceByLength',
        'clampToMaxLines'
      ],
      layout: exportLayout,
      lines: exportLines,
      semanticProductionEnabled: String(process.env.SEMANTIC_SEGMENTATION_PRODUCTION ?? '0') !== '0'
    },
    linesMatch: JSON.stringify(previewLines) === JSON.stringify(exportLines)
  };
}

/**
 * Exact style objects used by each renderer (serialized).
 */
export function collectStyleEvidence(previewPresetId = 'hormozi', exportPresetId = 'hormozi') {
  const exportResolvedId = resolvePresetIdOrThrow(exportPresetId);
  const exportPreset = getStylePreset(exportResolvedId);
  return {
    preview: {
      renderer: 'CutupStyleRenderer',
      module: 'website/subtitle-styles/presets/registry.js',
      presetId: previewPresetId,
      note: 'Full object captured client-side in cutupCaptionForensicsPreview.previewStyleObject when preview refreshes'
    },
    export: {
      renderer: 'ass-generator.js',
      module: 'api/video-render/style-presets.js',
      requestedPresetId: exportPresetId,
      resolvedPresetId: exportResolvedId,
      styleObject: exportPreset
    }
  };
}

/**
 * First-subtitle delay: evidence table from measured stage timestamps (no guesses).
 */
export function buildFirstSubtitleDelayEvidence(opts = {}) {
  const whisper = opts.whisperSegments?.[0];
  const pipeline = opts.pipelineAudit || {};
  const parsed0 = pipeline.parsed?.[0];
  const merge0 = pipeline.afterRollingMerge?.[0];
  const coalesce0 = pipeline.afterCoalesce?.[0];
  const stabilize0 = pipeline.afterStabilize?.[0];
  const ass0 = opts.assDialogues?.[0];
  const timelinePlan = opts.timelinePlan || {};

  const t0 = 0;
  const firstTranscriptWord = (() => {
    const seg = whisper || {};
    const words = Array.isArray(seg.words) ? seg.words : [];
    const firstWord = words.find((w) => Number.isFinite(Number(w?.start)));
    return firstWord ? Number(firstWord.start) : num(seg.start, null);
  })();
  const firstTranslatedCue = num(opts.translatedSegments?.[0]?.start, null);
  const firstMergedCue = num(stabilize0?.start ?? coalesce0?.start ?? merge0?.start, null);
  const firstBurnCue = num(stabilize0?.start, null);
  const firstASSDialogue = num(ass0?.assStart, null);
  const rows = [];

  const push = (stage, startSec, endSec, note) => {
    rows.push({
      stage,
      startSec: roundSec(startSec),
      endSec: roundSec(endSec),
      deltaStartFromVideoZeroMs: deltaMs(t0, startSec),
      deltaStartFromPreviousStageMs:
        rows.length > 0 && startSec != null ? deltaMs(rows[rows.length - 1].startSec, startSec) : null,
      note: note || undefined
    });
  };

  push('Whisper', whisper?.start, whisper?.end, 'transcriptSegments[0] / cutupLastTranscription');
  push('export_input_segment', opts.exportInputSegments?.[0]?.start, opts.exportInputSegments?.[0]?.end, 'job.segments[0] sent to render');
  push('buildSourceAlignedSubtitles_parsed', parsed0?.start, parsed0?.end, 'normalizeCueText only');
  push('mergeRollingCaptionChains', merge0?.start, merge0?.end, `cue count ${pipeline.parsedCount} → ${pipeline.afterRollingMergeCount}`);
  push('coalesceBurnPhrases', coalesce0?.start, coalesce0?.end, `cue count → ${pipeline.afterCoalesceCount}`);
  push(
    'stabilizeBurnCueTiming',
    stabilize0?.start,
    stabilize0?.end,
    `BURN_LEAD_DELAY_SEC=${BURN_LEAD_DELAY_SEC}`
  );
  push('ASS_Dialogue', ass0?.assStart, ass0?.assEnd, 'timingAuditRows / generateAssContent');
  if (timelinePlan.assShiftSec != null && Math.abs(Number(timelinePlan.assShiftSec)) > 0.0001) {
    push(
      'render_queue_ffmpeg_assShift',
      ass0?.assStart != null ? Number(ass0.assStart) + Number(timelinePlan.assShiftSec) : null,
      null,
      `assShiftSec=${timelinePlan.assShiftSec} applied in ffmpeg-renderer shiftAssFileTimestamps`
    );
  }

  let introducedAtStage = null;
  for (const row of rows) {
    if (row.deltaStartFromPreviousStageMs != null && row.deltaStartFromPreviousStageMs > 100) {
      introducedAtStage = row.stage;
      break;
    }
    if (row.stage === 'Whisper' && row.deltaStartFromVideoZeroMs != null && row.deltaStartFromVideoZeroMs > 1000) {
      introducedAtStage = 'Whisper';
      break;
    }
  }

  return {
    evidenceRows: rows,
    introducedAtStage,
    firstTranscriptWord: roundSec(firstTranscriptWord),
    firstTranslatedCue: roundSec(firstTranslatedCue),
    firstMergedCue: roundSec(firstMergedCue),
    firstBurnCue: roundSec(firstBurnCue),
    firstASSDialogue: roundSec(firstASSDialogue),
    deltasMs: {
      translatedMinusTranscriptWord: deltaMs(firstTranscriptWord, firstTranslatedCue),
      mergedMinusTranscriptWord: deltaMs(firstTranscriptWord, firstMergedCue),
      burnMinusTranscriptWord: deltaMs(firstTranscriptWord, firstBurnCue),
      assMinusTranscriptWord: deltaMs(firstTranscriptWord, firstASSDialogue)
    },
    firstVisibleStartSec: roundSec(
      ass0?.assStart ?? stabilize0?.start ?? merge0?.start ?? whisper?.start
    ),
    whisperFirstStartSec: roundSec(whisper?.start),
    exportMinusWhisperMs: deltaMs(whisper?.start, ass0?.assStart ?? stabilize0?.start)
  };
}

/**
 * Full per-cue record for [caption-forensics] logs.
 */
export function buildCaptionForensicRecords(opts = {}) {
  const max = CAPTION_FORENSIC_MAX;
  const whisper = Array.isArray(opts.whisperSegments) ? opts.whisperSegments : [];
  const translated = Array.isArray(opts.translatedSegments) ? opts.translatedSegments : [];
  const exportInput = Array.isArray(opts.exportInputSegments) ? opts.exportInputSegments : [];
  const pipeline = opts.pipelineAudit || {};
  const canonical = Array.isArray(opts.canonicalCues) ? opts.canonicalCues : [];
  const ass = Array.isArray(opts.assDialogues) ? opts.assDialogues : [];
  const previewByIndex = new Map(
    (Array.isArray(opts.previewRows) ? opts.previewRows : []).map((r) => [Number(r.cueIndex ?? r.segmentIndex), r])
  );

  const mergeByInputIndex = (list, segmentIndex) => {
    const hit = (Array.isArray(list) ? list : []).find((c) => c.segmentIndex === segmentIndex);
    if (hit) return hit;
    return list?.[segmentIndex] || null;
  };

  const records = [];
  for (let segmentIndex = 0; segmentIndex < max; segmentIndex++) {
    const w = whisper[segmentIndex];
    const tr = translated[segmentIndex];
    const inp = exportInput[segmentIndex];
    const prev = previewByIndex.get(segmentIndex);
    const canon = canonical[segmentIndex];
    const assRow = ass[segmentIndex];
    const merged = mergeByInputIndex(pipeline.afterStabilize, segmentIndex);

    records.push({
      segmentIndex,
      originalStart: roundSec(w?.start ?? inp?.start),
      originalEnd: roundSec(w?.end ?? inp?.end),
      originalText: String(w?.text ?? '').slice(0, 200),

      translatedStart: roundSec(tr?.start),
      translatedEnd: roundSec(tr?.end),
      translatedText: tr?.text ? String(tr.text).slice(0, 200) : null,

      mergedStart: roundSec(merged?.start),
      mergedEnd: roundSec(merged?.end),

      previewStart: roundSec(prev?.previewStart ?? inp?.start ?? tr?.start ?? w?.start),
      previewEnd: roundSec(prev?.previewEnd ?? inp?.end ?? tr?.end ?? w?.end),
      previewText: String(prev?.text ?? inp?.text ?? tr?.text ?? w?.text ?? '').slice(0, 200),

      exportStart: roundSec(canon?.start ?? canon?.sourceStart),
      exportEnd: roundSec(canon?.end ?? canon?.sourceEnd),
      exportText: String(canon?.text ?? inp?.text ?? '').slice(0, 200),

      assDialogueStart: roundSec(assRow?.assStart),
      assDialogueEnd: roundSec(assRow?.assEnd),
      assText: assRow?.text ? String(assRow.text).slice(0, 200) : null,

      segmentedLinesPreview: prev?.segmentedLines || prev?.segmentedLinesPreview || null,
      segmentedLinesExport: opts.exportSegmentedLines?.[segmentIndex] || null
    });
  }
  return records;
}

export function buildCaptionForensicReport(opts = {}) {
  const records = buildCaptionForensicRecords(opts);
  const firstSubtitleDelay = buildFirstSubtitleDelayEvidence(opts);
  const selectedPresetFromUI = opts.selectedPresetFromUI || null;
  const presetReceivedByAPI = opts.presetReceivedByAPI || null;
  const presetReceivedByRenderQueue = opts.presetReceivedByRenderQueue || null;
  const presetUsedByASSGenerator = opts.presetUsedByASSGenerator || opts.exportPresetId || null;
  const styleComparison = {
    ...collectStyleEvidence(opts.previewPresetId, opts.exportPresetId),
    previewStyleObject: opts.previewStyleObject || null
  };
  const segmentationProof = proveSegmentationSplit(
    opts.segmentationSampleText || SAMPLE_SEGMENTATION_TEXT
  );

  return {
    traceId: opts.traceId || null,
    jobId: opts.jobId || null,
    cueCountLogged: records.length,
    presetLineage: {
      selectedPresetFromUI,
      presetReceivedByAPI,
      presetReceivedByRenderQueue,
      presetUsedByASSGenerator
    },
    captionRecords: records,
    firstSubtitleDelayAttribution: firstSubtitleDelay,
    styleComparison,
    segmentationProof,
    cueCountByStage: opts.pipelineAudit
      ? {
          inputToBuildSourceAlignedSubtitles: opts.pipelineAudit.inputCount,
          beforeMergeRollingCaptionChains: opts.pipelineAudit.parsedCount,
          afterMergeRollingCaptionChains: opts.pipelineAudit.afterRollingMergeCount,
          beforeCoalesceBurnPhrases: opts.pipelineAudit.afterRollingMergeCount,
          afterCoalesceBurnPhrases: opts.pipelineAudit.afterCoalesceCount,
          beforeStabilizeBurnCueTiming: opts.pipelineAudit.afterCoalesceCount,
          afterStabilizeBurnCueTiming: opts.pipelineAudit.afterStabilizeCount
        }
      : null,
    pipelineCounts: opts.pipelineAudit
      ? {
          input: opts.pipelineAudit.inputCount,
          parsed: opts.pipelineAudit.parsedCount,
          afterRollingMerge: opts.pipelineAudit.afterRollingMergeCount,
          afterCoalesce: opts.pipelineAudit.afterCoalesceCount,
          afterStabilize: opts.pipelineAudit.afterStabilizeCount
        }
      : null
  };
}

export function logCaptionForensics(opts = {}) {
  if (!isCaptionForensicEnabled()) return null;

  const report = buildCaptionForensicReport(opts);

  for (const record of report.captionRecords) {
    console.log('[caption-forensics]', JSON.stringify(record));
  }

  console.log('[caption-forensics-report]', JSON.stringify(report));
  console.log('[caption-forensics-preset-lineage]', JSON.stringify(report.presetLineage));
  if (report.cueCountByStage) {
    console.log('[caption-forensics-cue-counts]', JSON.stringify(report.cueCountByStage));
  }

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(join(opts.jobDir, 'caption-forensics.json'), JSON.stringify(report, null, 2), 'utf8');
      writeFileSync(
        join(opts.jobDir, 'CAPTION-ROOT-CAUSE-REPORT.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
      writeFileSync(
        join(opts.jobDir, 'CAPTION-PIPELINE-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[caption-forensics] write failed:', err?.message);
    }
  }
  return report;
}

/** @deprecated use buildCaptionForensicRecords */
export function buildCaptionForensicRows(opts = {}) {
  return buildCaptionForensicRecords(opts).map((r) => ({
    cueIndex: r.segmentIndex,
    ...r,
    text: r.previewText || r.exportText
  }));
}
