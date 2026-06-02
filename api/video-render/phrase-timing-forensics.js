/**
 * Phrase timing forensic attribution (read-only). No timing behavior changes.
 * Enable: PHRASE_TIMING_FORENSIC=1
 * Writes: {jobDir}/PHRASE-TIMING-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  beginPhraseTimingForensicCapture,
  endPhraseTimingForensicCapture,
  buildPhraseBurnSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows
} from './subtitle-pipeline.js';

const MAX_PHRASES = 20;

export function isPhraseTimingForensicEnabled() {
  return String(process.env.PHRASE_TIMING_FORENSIC ?? '1') !== '0';
}

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

function deltaMs(fromSec, toSec) {
  if (fromSec == null || toSec == null) return null;
  return Math.round((Number(toSec) - Number(fromSec)) * 1000);
}

function enrichRowWithDeltas(row) {
  const anchor = row.firstWordStart;
  if (anchor == null) return row;

  const stages = [
    ['speechAnchorStart', row.speechAnchorStart],
    ['phraseStartBeforeReanchor', row.phraseStartBeforeReanchor],
    ['phraseStartAfterReanchor', row.phraseStartAfterReanchor],
    ['phraseStartAfterDetectAndCorrectDrift', row.phraseStartAfterDetectAndCorrectDrift],
    ['afterValidateAndFixCaptionTimingForExportStart', row.afterValidateAndFixCaptionTimingForExportStart],
    ['afterBuildVisualCueViewStart', row.afterBuildVisualCueViewStart],
    ['renderStart', row.renderStart],
    ['assStart', row.assStart]
  ];

  const deltaFromFirstWordStartMs = {};
  const stageToStageDeltaMs = {};
  let prevKey = 'firstWordStart';
  let prevVal = anchor;
  deltaFromFirstWordStartMs.firstWordStart = 0;

  for (const [key, val] of stages) {
    if (val == null) continue;
    deltaFromFirstWordStartMs[key] = deltaMs(anchor, val);
    if (prevVal != null) {
      stageToStageDeltaMs[`${prevKey}_to_${key}`] = deltaMs(prevVal, val);
    }
    prevKey = key;
    prevVal = val;
  }

  if (row.prerollSec != null) {
    deltaFromFirstWordStartMs.prerollSubtractedMs = Math.round(-Number(row.prerollSec) * 1000);
  }

  return {
    ...row,
    deltaFromFirstWordStartMs,
    stageToStageDeltaMs
  };
}

function attributeLargestDelay(rows) {
  const first = rows[0];
  if (!first?.deltaFromFirstWordStartMs) {
    return { note: 'no first phrase row' };
  }

  const entries = Object.entries(first.deltaFromFirstWordStartMs).filter(
    ([k]) => k !== 'firstWordStart' && k !== 'prerollSubtractedMs'
  );
  let maxKey = null;
  let maxAbs = 0;
  let maxSigned = 0;
  for (const [key, ms] of entries) {
    if (ms == null) continue;
    const abs = Math.abs(ms);
    if (abs > maxAbs) {
      maxAbs = abs;
      maxKey = key;
      maxSigned = ms;
    }
  }

  const fnMap = {
    speechAnchorStart: 'speechAnchorStart (normalizeWordTimeline)',
    phraseStartBeforeReanchor: 'reanchorBlockTiming (anchor before preroll)',
    phraseStartAfterReanchor: 'reanchorBlockTiming (firstWordStart - preroll)',
    phraseStartAfterDetectAndCorrectDrift: 'detectAndCorrectDrift',
    afterValidateAndFixCaptionTimingForExportStart: 'validateAndFixCaptionTimingForExport',
    afterBuildVisualCueViewStart: 'buildVisualCueView (copies start → sourceStart/renderStart)',
    renderStart: 'applyVisualReadabilityWindows',
    assStart: 'generateAssContent (syncStart = sourceStart ?? start ?? renderStart)'
  };

  return {
    firstPhraseIndex: 0,
    firstPhraseText: first.phraseText,
    firstWordStartSec: first.firstWordStart,
    assStartSec: first.assStart,
    totalDelayFirstWordToAssMs: first.deltaFromFirstWordStartMs.assStart,
    largestAbsoluteStage: maxKey,
    largestAbsoluteStageMs: maxSigned,
    attributedFunction: fnMap[maxKey] || maxKey,
    positiveMsMeansCaptionLate: 'assStart > firstWordStart → caption appears after speech anchor',
    prerollEffectMs: first.deltaFromFirstWordStartMs.phraseStartAfterReanchor,
    driftCorrectionSec: first.driftCorrectionApplied
  };
}

/**
 * @param {object[]} rawSegments
 * @param {object} opts assResult, captionMode, durationSec, renderProfile minCueDuration
 */
export function buildPhraseTimingForensicsReport(rawSegments, opts = {}) {
  const segments = Array.isArray(rawSegments) ? rawSegments : [];
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const minCueDurationSec = Number(opts.minCueDurationSec ?? 0.74);
  const assDialogues = opts.assResult?.timingAudit?.assDialogues || [];

  beginPhraseTimingForensicCapture();
  let phraseCues;
  try {
    phraseCues = buildPhraseBurnSubtitles(segments);
  } finally {
    var composeRows = endPhraseTimingForensicCapture();
  }

  const visualCues = buildVisualCueView(phraseCues, captionMode);
  const beforeReadability = visualCues.map((c) => ({
    sourceStart: Number(c.sourceStart ?? c.start),
    renderStart: Number(c.renderStart ?? c.start)
  }));
  const afterReadability = applyVisualReadabilityWindows(visualCues, {
    minCueDurationSec,
    minGapSec: 0.035,
    maxTailExtensionSec: 0.48,
    maxLeadExtensionSec: 0.16,
    videoDurationSec: Number(opts.durationSec ?? 0)
  });

  const rows = [];
  for (let i = 0; i < Math.min(MAX_PHRASES, phraseCues.length); i++) {
    const compose = composeRows[i] || {};
    const vis = afterReadability[i] || {};
    const ass = assDialogues[i] || {};
    const renderStartBefore = beforeReadability[i]?.renderStart;

    rows.push(
      enrichRowWithDeltas({
        phraseIndex: i,
        phraseText: String(phraseCues[i]?.text || compose.phraseText || '').slice(0, 120),
        firstWordStart: roundSec(compose.firstWordStart ?? phraseCues[i]?.firstWordStart),
        speechAnchorStart: roundSec(compose.speechAnchorStart),
        phraseStartBeforeReanchor: roundSec(compose.phraseStartBeforeReanchor),
        phraseStartAfterReanchor: roundSec(compose.phraseStartAfterReanchor),
        prerollSec: compose.prerollSec != null ? roundSec(compose.prerollSec) : null,
        phraseStartAfterDetectAndCorrectDrift: roundSec(
          compose.phraseStartAfterDetectAndCorrectDrift ?? phraseCues[i]?.start
        ),
        driftCorrectionApplied: compose.driftCorrectionApplied ?? phraseCues[i]?.driftCorrectionApplied ?? 0,
        afterValidateAndFixCaptionTimingForExportStart: roundSec(
          compose.afterValidateAndFixCaptionTimingForExportStart ?? phraseCues[i]?.start
        ),
        afterBuildVisualCueViewStart: roundSec(vis.sourceStart ?? vis.start),
        renderStartBeforeReadability: roundSec(renderStartBefore),
        renderStart: roundSec(vis.renderStart),
        renderEnd: roundSec(vis.renderEnd),
        assStart: roundSec(ass.assStart),
        assEnd: roundSec(ass.assEnd)
      })
    );
  }

  const firstInput = segments[0];
  const report = {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    pipelinePath: 'buildPhraseBurnSubtitles → composeRhythmBlocks → validateAndFix → buildVisualCueView → applyVisualReadabilityWindows → generateAssContent',
    inputSegmentCount: segments.length,
    phraseCueCount: phraseCues.length,
    firstInputSegmentStart: roundSec(firstInput?.start),
    firstPhraseForensic: rows[0] || null,
    first20PhraseCues: rows,
    delayAttribution: attributeLargestDelay(rows),
    functionReference: [
      {
        function: 'normalizeWordTimeline',
        module: 'subtitle-pipeline.js',
        role: 'Builds per-word start/end; feeds speechAnchorStart'
      },
      {
        function: 'speechAnchorStart',
        module: 'subtitle-pipeline.js',
        role: 'High-confidence first word time → firstWordStart / phraseStartBeforeReanchor'
      },
      {
        function: 'reanchorBlockTiming',
        module: 'subtitle-pipeline.js',
        role: 'phraseStartAfterReanchor = speechAnchorStart - preroll (adaptivePaddingFromSpeechRate)'
      },
      {
        function: 'detectAndCorrectDrift',
        module: 'subtitle-pipeline.js',
        role: 'Rolling correction on block.start (driftCorrectionApplied); can shift LATE (+) or EARLY (-)'
      },
      {
        function: 'validateAndFixCaptionTimingForExport',
        module: 'subtitle-pipeline.js',
        role: 'Overlap/duration clamps; usually small start shift'
      },
      {
        function: 'buildVisualCueView',
        module: 'subtitle-pipeline.js',
        role: 'Copies canonical start to sourceStart/renderStart (no shift)'
      },
      {
        function: 'applyVisualReadabilityWindows',
        module: 'subtitle-pipeline.js',
        role: 'Can move renderStart earlier (maxLeadExtensionSec) for min duration — compare renderStartBeforeReadability vs renderStart'
      },
      {
        function: 'generateAssContent',
        module: 'ass-generator.js',
        role: 'assStart = sourceStart ?? start ?? renderStart (phrase viral path)'
      }
    ],
    summary:
      rows[0]?.deltaFromFirstWordStartMs?.assStart > 200
        ? 'First caption assStart is later than firstWordStart — positive deltaMs means visually LATE vs speech anchor.'
        : rows[0]?.deltaFromFirstWordStartMs?.assStart < -200
          ? 'First caption assStart is earlier than firstWordStart — may flash before speech.'
          : 'First phrase timing within ~200ms of firstWordStart at ASS layer; check Whisper firstWordStart if still feels late.'
  };

  return report;
}

export function logPhraseTimingForensics(opts = {}) {
  if (!isPhraseTimingForensicEnabled()) return null;
  if (!opts.rawSegments?.length && !opts.segments?.length) return null;

  const report = buildPhraseTimingForensicsReport(opts.rawSegments || opts.segments, opts);

  console.log('[phrase-timing-forensics-attribution]', JSON.stringify(report.delayAttribution));
  console.log('[phrase-timing-forensics-first]', JSON.stringify(report.firstPhraseForensic));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'PHRASE-TIMING-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[phrase-timing-forensics] write failed:', err?.message);
    }
  }

  return report;
}
