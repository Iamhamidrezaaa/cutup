/**
 * Forensic trace for coalesceBurnPhrases + stabilizeBurnCueTiming only.
 * Does not change production merge/stabilize output when used as parallel audit.
 * Enable: CAPTION_MERGE_FORENSIC=1
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  mergeRollingCaptionChains,
  coalesceBurnPhrases,
  stabilizeBurnCueTiming,
  BURN_LEAD_DELAY_SEC,
  BURN_TAIL_PAD_SEC,
  MIN_BURN_CUE_VISIBLE_SEC,
  MIN_BURN_PHRASE_READ_SEC
} from './subtitle-pipeline.js';
import { isDebugExportEnabled } from './export-debug.js';

export function isCaptionMergeForensicEnabled() {
  return isDebugExportEnabled() && String(process.env.CAPTION_MERGE_FORENSIC ?? '1') !== '0';
}

function normText(t) {
  return String(t || '').trim();
}

function cueIdFrom(cue, fallbackIndex) {
  if (cue?.id != null) return String(cue.id);
  if (cue?.segmentIndex != null) return `seg-${cue.segmentIndex}`;
  if (cue?.index != null) return `idx-${cue.index}`;
  return `cue-${fallbackIndex}`;
}

/**
 * Instrumented coalesce — same rules as coalesceBurnPhrases.
 */
export function coalesceBurnPhrasesWithForensics(cues, collector) {
  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);
  const out = [];
  const outputLineage = [];
  collector.inputCount = sorted.length;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const dur = cur.end - cur.start;
    const sourceCueId = cueIdFrom(cur, i);
    const sourceText = normText(cur.text);

    collector.events.push({
      stage: 'coalesceBurnPhrases',
      action: 'input',
      inputIndex: i,
      cueId: sourceCueId,
      sourceCueId,
      sourceText,
      mergedCueId: null,
      mergedText: null,
      start: Number(cur.start),
      end: Number(cur.end),
      durationSec: Number(dur.toFixed(3))
    });

    if (!sourceText) {
      collector.events.push({
        stage: 'coalesceBurnPhrases',
        action: 'dropped_empty_text',
        sourceCueId,
        sourceText: '',
        mergedCueId: null,
        mergedText: null
      });
      continue;
    }

    if (
      next &&
      dur < 0.4 &&
      next.start - cur.start < 0.35 &&
      normText(next.text).length > sourceText.length
    ) {
      collector.events.push({
        stage: 'coalesceBurnPhrases',
        action: 'dropped_orphan_preview',
        sourceCueId,
        sourceText,
        mergedCueId: null,
        mergedText: null,
        reason: 'dur<0.4 && gap<0.35 && next.text longer',
        nextCueId: cueIdFrom(next, i + 1),
        nextText: normText(next.text)
      });
      continue;
    }

    const prev = out[out.length - 1];
    const prevLineage = outputLineage[outputLineage.length - 1];

    if (prev && cur.start - prev.end < 0.14 && dur < 0.55) {
      const prevText = normText(prev.text);
      prev.text = normText(`${prev.text} ${sourceText}`);
      prev.end = Math.max(prev.end, cur.end);
      if (prevLineage) {
        prevLineage.sourceCueIds.push(sourceCueId);
        prevLineage.sourceTexts.push({ sourceCueId, sourceText });
        prevLineage.mergedText = prev.text;
        prevLineage.mergeActions.push({
          action: 'merged_into_previous',
          absorbedSourceCueId: sourceCueId,
          absorbedSourceText: sourceText,
          previousText: prevText
        });
      }
      collector.events.push({
        stage: 'coalesceBurnPhrases',
        action: 'merged_into_previous',
        sourceCueId,
        sourceText,
        mergedCueId: prevLineage?.mergedCueId || null,
        mergedText: prev.text,
        reason: 'gap<0.14 && dur<0.55'
      });
      continue;
    }

    const mergedCueId = `coalesce-out-${out.length}`;
    out.push({ start: cur.start, end: cur.end, text: sourceText, words: cur.words });
    outputLineage.push({
      mergedCueId,
      mergedText: sourceText,
      sourceCueIds: [sourceCueId],
      sourceTexts: [{ sourceCueId, sourceText }],
      mergeActions: [{ action: 'emitted' }]
    });
    collector.events.push({
      stage: 'coalesceBurnPhrases',
      action: 'emitted',
      sourceCueId,
      sourceText,
      mergedCueId,
      mergedText: sourceText
    });
  }

  collector.outputCount = out.length;
  collector.outputLineage = outputLineage;
  return out;
}

/**
 * Instrumented stabilize — same rules as stabilizeBurnCueTiming.
 */
export function stabilizeBurnCueTimingWithForensics(cues, collector, opts = {}) {
  const minVisibleSec = Math.max(0.08, Number(opts.minVisibleSec ?? MIN_BURN_CUE_VISIBLE_SEC));
  const minReadSec = Math.max(minVisibleSec, Number(opts.minReadSec ?? MIN_BURN_PHRASE_READ_SEC));
  const tailPadSec = Math.max(0, Number(opts.tailPadSec ?? BURN_TAIL_PAD_SEC));
  const leadDelaySec = Math.max(0, Number(opts.leadDelaySec ?? BURN_LEAD_DELAY_SEC));
  const interCueGapSec = Math.max(0.01, Number(opts.interCueGapSec ?? 0.02));

  const sorted = [...(Array.isArray(cues) ? cues : [])].sort((a, b) => a.start - b.start);
  collector.inputCount = sorted.length;
  const outputLineage = [];

  const stabilized = sorted.map((cue, i) => {
    const next = sorted[i + 1];
    const rawStart = Number(cue.start);
    const naturalEnd = Number(cue.end);
    const start = rawStart + leadDelaySec;
    const textBefore = normText(cue.text);
    const wordCount = textBefore.split(/\s+/).filter(Boolean).length;
    const minByWords = Math.min(5.5, Math.max(minReadSec, wordCount * 0.22));

    let end = naturalEnd + tailPadSec;
    end = Math.max(end, start + minByWords, start + minVisibleSec);

    if (next) {
      const nextStart = Number(next.start) + leadDelaySec;
      const pauseGap = nextStart - (naturalEnd + tailPadSec);
      if (pauseGap > 0.12) {
        end = Math.min(naturalEnd + tailPadSec + pauseGap * 0.4, nextStart - interCueGapSec);
      } else if (end > nextStart - interCueGapSec) {
        end = Math.max(naturalEnd + tailPadSec * 0.5, nextStart - interCueGapSec);
      }
    }

    end = Math.max(start + minVisibleSec, end);
    const mergedCueId = `stabilize-out-${i}`;
    const textAfter = textBefore;

    collector.events.push({
      stage: 'stabilizeBurnCueTiming',
      action: 'timing_adjust',
      inputIndex: i,
      cueId: `stabilize-in-${i}`,
      sourceCueId: cueIdFrom(cue, i),
      sourceText: textBefore,
      mergedCueId,
      mergedText: textAfter,
      textChanged: textBefore !== textAfter,
      startBefore: rawStart,
      endBefore: naturalEnd,
      startAfter: start,
      endAfter: end
    });

    outputLineage.push({
      mergedCueId,
      mergedText: textAfter,
      sourceText: textBefore,
      textChanged: textBefore !== textAfter
    });

    return {
      ...cue,
      text: textAfter,
      start,
      end,
      sourceStart: start,
      sourceEnd: end,
      duration: Number((end - start).toFixed(3))
    };
  });

  collector.outputCount = stabilized.length;
  collector.outputLineage = outputLineage;
  return stabilized;
}

function verifyMatchesProduction(rawSegments) {
  const parsed = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) {
      continue;
    }
    const text = normText(seg.text);
    if (!text) continue;
    parsed.push({
      id: `src-${i}`,
      index: i,
      segmentIndex: i,
      start: Number(seg.start),
      end: Number(seg.end),
      text
    });
  }
  const rolled = mergeRollingCaptionChains(parsed);
  const prodCoalesce = coalesceBurnPhrases(rolled);
  const prodStabilize = stabilizeBurnCueTiming(prodCoalesce);
  return { parsed, rolled, prodCoalesce, prodStabilize };
}

/**
 * @param {object[]} rawSegments export input segments
 */
export function buildCaptionMergeForensicsReport(rawSegments, opts = {}) {
  const { parsed, rolled, prodCoalesce, prodStabilize } = verifyMatchesProduction(rawSegments);

  const coalesceCollector = { events: [], inputCount: 0, outputCount: 0, outputLineage: [] };
  const forensicCoalesce = coalesceBurnPhrasesWithForensics(rolled, coalesceCollector);

  const stabilizeCollector = { events: [], inputCount: 0, outputCount: 0, outputLineage: [] };
  const forensicStabilize = stabilizeBurnCueTimingWithForensics(forensicCoalesce, stabilizeCollector);

  const coalesceMatchesProduction =
    forensicCoalesce.length === prodCoalesce.length &&
    forensicCoalesce.every(
      (c, i) =>
        normText(c.text) === normText(prodCoalesce[i]?.text) &&
        Number(c.start) === Number(prodCoalesce[i]?.start) &&
        Number(c.end) === Number(prodCoalesce[i]?.end)
    );

  const stabilizeMatchesProduction =
    forensicStabilize.length === prodStabilize.length &&
    forensicStabilize.every(
      (c, i) =>
        normText(c.text) === normText(prodStabilize[i]?.text) &&
        Math.abs(Number(c.start) - Number(prodStabilize[i]?.start)) < 0.001 &&
        Math.abs(Number(c.end) - Number(prodStabilize[i]?.end)) < 0.001
    );

  const perCueLineage = forensicStabilize.map((outCue, i) => {
    const coalesceLine = coalesceCollector.outputLineage[i] || {};
    const stabLine = stabilizeCollector.outputLineage[i] || {};
    const sourceTexts = coalesceLine.sourceTexts || [];

    return {
      outputIndex: i,
      cueId: stabLine.mergedCueId || `stabilize-out-${i}`,
      sourceCueId: sourceTexts[0]?.sourceCueId || null,
      sourceCueIds: coalesceLine.sourceCueIds || [],
      sourceText: sourceTexts.map((s) => s.sourceText).join(' | '),
      sourceTextParts: sourceTexts,
      mergedCueId: coalesceLine.mergedCueId || null,
      mergedText: normText(outCue.text),
      coalesceMergedText: coalesceLine.mergedText || null,
      textChangedInCoalesce:
        (coalesceLine.mergeActions || []).some((a) => a.action === 'merged_into_previous') ||
        (coalesceLine.sourceTexts || []).length > 1,
      textChangedInStabilize: stabLine.textChanged === true,
      start: outCue.start,
      end: outCue.end,
      coalesceActions: coalesceLine.mergeActions || []
    };
  });

  const droppedEvents = coalesceCollector.events.filter((e) => e.action === 'dropped_orphan_preview');
  const mergedEvents = coalesceCollector.events.filter((e) => e.action === 'merged_into_previous');

  const indexMisalignmentExamples = [];
  for (let i = 0; i < Math.min(parsed.length, prodStabilize.length); i++) {
    const orig = parsed[i];
    const out = prodStabilize[i];
    if (normText(orig?.text) !== normText(out?.text)) {
      const lineage = perCueLineage[i];
      indexMisalignmentExamples.push({
        segmentIndex: i,
        originalText: orig.text,
        exportTextBySameIndex: out.text,
        actualSourceCueIdsAtThisOutputIndex: lineage?.sourceCueIds || [],
        actualSourceTextsAtThisOutputIndex: lineage?.sourceTextParts || [],
        note:
          'Same numeric index after coalesce does not mean same source segment — dropped/merged cues shift indices'
      });
    }
  }

  const droppedSourceTexts = droppedEvents.map((e) => ({
    sourceCueId: e.sourceCueId,
    sourceText: e.sourceText,
    reason: e.reason
  }));

  return {
    traceId: opts.traceId || null,
    jobId: opts.jobId || null,
    generatedAt: new Date().toISOString(),
    instrumentationVerified: {
      coalesceMatchesProduction,
      stabilizeMatchesProduction
    },
    cueCountByStage: {
      inputToBuildSourceAlignedSubtitles: rawSegments.length,
      afterParse: parsed.length,
      afterMergeRollingCaptionChains: rolled.length,
      beforeCoalesceBurnPhrases: rolled.length,
      afterCoalesceBurnPhrases: prodCoalesce.length,
      beforeStabilizeBurnCueTiming: prodCoalesce.length,
      afterStabilizeBurnCueTiming: prodStabilize.length,
      coalesceReduction: rolled.length - prodCoalesce.length,
      stabilizeReduction: prodCoalesce.length - prodStabilize.length
    },
    rootCauseAttribution: {
      cueCountCollapseStage:
        rolled.length > prodCoalesce.length ? 'coalesceBurnPhrases' : 'none',
      cuesRemovedByCoalesce: Math.max(0, rolled.length - prodCoalesce.length),
      cuesDroppedAsOrphanPreview: droppedEvents.length,
      cuesMergedIntoPrevious: mergedEvents.length,
      textRewriteStage:
        mergedEvents.length > 0 || droppedEvents.length > 0
          ? 'coalesceBurnPhrases'
          : 'none',
      stabilizeAltersText:
        stabilizeCollector.events.some((e) => e.textChanged) === true,
      stabilizeAltersCueCount: prodCoalesce.length !== prodStabilize.length,
      exportIndexRemapStage:
        'buildSourceAlignedSubtitles final map assigns id src-{outputIndex} — forensic reports that compare segmentIndex to output index can show false text swaps'
    },
    coalesceBurnPhrases: {
      inputCount: coalesceCollector.inputCount,
      outputCount: coalesceCollector.outputCount,
      events: coalesceCollector.events,
      droppedSourceTexts
    },
    stabilizeBurnCueTiming: {
      inputCount: stabilizeCollector.inputCount,
      outputCount: stabilizeCollector.outputCount,
      events: stabilizeCollector.events
    },
    perCueLineage,
    indexMisalignmentExamples
  };
}

export function logCaptionMergeForensics(rawSegments, opts = {}) {
  if (!isCaptionMergeForensicEnabled()) return null;

  const report = buildCaptionMergeForensicsReport(rawSegments, opts);

  for (const row of report.perCueLineage) {
    console.log(
      '[caption-merge-forensics]',
      JSON.stringify({
        cueId: row.cueId,
        sourceCueId: row.sourceCueId,
        sourceText: row.sourceText,
        mergedCueId: row.mergedCueId,
        mergedText: row.mergedText
      })
    );
  }

  console.log('[caption-merge-forensics-summary]', JSON.stringify(report.cueCountByStage));
  console.log('[caption-merge-forensics-attribution]', JSON.stringify(report.rootCauseAttribution));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'CAPTION-MERGE-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[caption-merge-forensics] write failed:', err?.message);
    }
  }

  return report;
}
