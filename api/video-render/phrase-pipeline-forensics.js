/**
 * Phrase vs segment caption pipeline forensics (read-only).
 * Traces where phrase-level timing is skipped and segment-level blocks reach ASS.
 * Enable: PHRASE_PIPELINE_FORENSIC=1
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  buildSourceAlignedSubtitles,
  buildCanonicalSubtitles,
  mergeRollingCaptionChains,
  stabilizeBurnCueTiming
} from './subtitle-pipeline.js';
import { coalesceBurnPhrasesWithForensics } from './caption-merge-forensics.js';
import { buildCueLines } from './text-layout.js';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';

const FORENSIC_FIRST_N = 10;

export function isPhrasePipelineForensicEnabled() {
  return String(process.env.PHRASE_PIPELINE_FORENSIC ?? '1') !== '0';
}

function normText(t) {
  return String(t || '').trim();
}

function parseExportSegments(rawSegments) {
  const raw = Array.isArray(rawSegments) ? rawSegments : [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number' || seg.end <= seg.start) {
      continue;
    }
    const text = normText(seg.text);
    if (!text) continue;
    out.push({
      id: `src-${i}`,
      index: i,
      segmentIndex: i,
      start: Number(seg.start),
      end: Number(seg.end),
      text,
      words: seg.words
    });
  }
  return out;
}

function countActiveDialoguesAt(cues, timeSec) {
  let n = 0;
  for (const c of cues) {
    if (timeSec >= c.start && timeSec <= c.end) n += 1;
  }
  return n;
}

/**
 * @param {object[]} rawSegments
 * @param {object} opts presetId, traceId, jobId, jobDir
 */
export function buildPhrasePipelineForensicsReport(rawSegments, opts = {}) {
  const useSourceAlignedTimings =
    String(process.env.RENDER_BURN_USE_SOURCE_TIMINGS ?? '1').toLowerCase() !== '0' ||
    String(opts.captionMode || 'viral').toLowerCase() === 'accurate';

  const sourceSegments = parseExportSegments(rawSegments);
  const sourceSegmentCount = sourceSegments.length;

  const phraseBlocksRhythmPath = buildCanonicalSubtitles(sourceSegments);
  const phraseCountRhythmPath = phraseBlocksRhythmPath.length;

  const afterRolling = mergeRollingCaptionChains(sourceSegments);
  const coalesceCollector = { events: [], inputCount: 0, outputCount: 0, outputLineage: [] };
  const afterCoalesce = coalesceBurnPhrasesWithForensics(afterRolling, coalesceCollector);
  const afterStabilize = stabilizeBurnCueTiming(afterCoalesce);
  const productionCanonical = buildSourceAlignedSubtitles(rawSegments);
  const coalesceLineage = coalesceCollector.outputLineage || [];

  function countRhythmPhrasesInWindow(start, end) {
    return phraseBlocksRhythmPath.filter((p) => p.start < end && p.end > start).length;
  }

  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const cueLayout = preset.layout || {};
  const uppercase = Boolean(preset.uppercase);

  const assDialogueRows = [];
  let totalAssDisplayLines = 0;
  let maxLinesInOneDialogue = 0;
  let maxDialogueDurationSec = 0;

  for (let i = 0; i < productionCanonical.length; i++) {
    const cue = productionCanonical[i];
    const lines = buildCueLines(cue, cueLayout, uppercase);
    const lineCount = Math.max(1, lines.length);
    totalAssDisplayLines += lineCount;
    maxLinesInOneDialogue = Math.max(maxLinesInOneDialogue, lineCount);
    const dur = Number(cue.end) - Number(cue.start);
    maxDialogueDurationSec = Math.max(maxDialogueDurationSec, dur);

    assDialogueRows.push({
      dialogueIndex: i,
      assDialogueStart: Number(cue.start),
      assDialogueEnd: Number(cue.end),
      assDialogueDurationSec: Number(dur.toFixed(3)),
      assDisplayLineCount: lineCount,
      assDisplayLines: lines,
      fullCueText: normText(cue.text),
      wordCount: normText(cue.text).split(/\s+/).filter(Boolean).length
    });
  }

  const first10CountsTable = [];
  const first10Captions = [];
  for (let i = 0; i < Math.min(FORENSIC_FIRST_N, productionCanonical.length); i++) {
    const stab = productionCanonical[i];
    const coalesceCue = afterCoalesce[i] || null;
    const lineage = coalesceLineage[i] || null;
    const ass = assDialogueRows[i] || null;
    const sourceIds = lineage?.sourceCueIds || [];
    const sourceSegmentsAbsorbed = sourceIds
      .map((id) => {
        const m = /^src-(\d+)$/.exec(String(id));
        const idx = m ? Number(m[1]) : null;
        return idx != null ? sourceSegments[idx] : null;
      })
      .filter(Boolean);

    const phraseCount = countRhythmPhrasesInWindow(stab.start, stab.end);
    const segmentCount = sourceSegmentsAbsorbed.length || (coalesceCue ? 1 : 0);
    const assDialogueCount = 1;
    const assDisplayLineCount = ass?.assDisplayLineCount || 0;

    const mid = (stab.start + stab.end) / 2;
    const concurrentAtMid = countActiveDialoguesAt(productionCanonical, mid);

    const row = {
      outputIndex: i,
      phraseCount,
      segmentCount,
      assDialogueCount,
      assDisplayLineCount,
      durationSec: Number((stab.end - stab.start).toFixed(3)),
      textPreview: normText(stab.text).slice(0, 100)
    };
    first10CountsTable.push(row);

    first10Captions.push({
      index: i,
      counts: {
        phraseCount,
        segmentCount,
        assDialogueCount,
        assDisplayLineCount
      },
      sourceSegmentsAbsorbed: sourceSegmentsAbsorbed.map((s) => ({
        segmentIndex: s.segmentIndex,
        start: s.start,
        end: s.end,
        text: s.text
      })),
      coalesceLineage: lineage
        ? {
            mergedCueId: lineage.mergedCueId,
            mergeActions: lineage.mergeActions,
            sourceCueIds: lineage.sourceCueIds
          }
        : null,
      afterCoalesceBurnPhrases: coalesceCue
        ? { start: coalesceCue.start, end: coalesceCue.end, text: normText(coalesceCue.text) }
        : null,
      afterStabilizeBurnCueTiming: {
        start: stab.start,
        end: stab.end,
        durationSec: Number((stab.end - stab.start).toFixed(3)),
        text: normText(stab.text)
      },
      phraseSplitStageRhythmPathShadow: phraseBlocksRhythmPath
        .filter((p) => p.start < stab.end && p.end > stab.start)
        .slice(0, 5)
        .map((p) => ({
          start: p.start,
          end: p.end,
          text: normText(p.text),
          note: 'shadow only — composeRhythmBlocks NOT used in production export path'
        })),
      assDialogue: ass
        ? {
            start: ass.assDialogueStart,
            end: ass.assDialogueEnd,
            durationSec: ass.assDialogueDurationSec,
            displayLineCount: ass.assDisplayLineCount,
            displayLines: ass.assDisplayLines,
            concurrentDialoguesAtMidpoint: concurrentAtMid
          }
        : null
    });
  }

  const phraseCount = useSourceAlignedTimings ? 0 : phraseCountRhythmPath;
  const segmentCount = productionCanonical.length;
  const assDialogueCount = assDialogueRows.length;

  return {
    traceId: opts.traceId || null,
    jobId: opts.jobId || null,
    generatedAt: new Date().toISOString(),
    pipelineMode: {
      useSourceAlignedTimings,
      renderBurnUseSourceTimingsEnv: process.env.RENDER_BURN_USE_SOURCE_TIMINGS ?? '1',
      captionMode: opts.captionMode || 'viral',
      presetId,
      resolvedPresetId: preset.id
    },
    aggregateCounts: {
      sourceSegmentCount,
      phraseCountRhythmPathShadow: phraseCountRhythmPath,
      afterMergeRollingCaptionChains: afterRolling.length,
      afterCoalesceBurnPhrases: afterCoalesce.length,
      afterStabilizeBurnCueTiming: afterStabilize.length,
      segmentCountFinalCanonical: segmentCount,
      assDialogueCount,
      totalAssDisplayLinesInAllDialogues: totalAssDisplayLines,
      maxAssDisplayLinesInOneDialogue: maxLinesInOneDialogue,
      maxAssDialogueDurationSec: Number(maxDialogueDurationSec.toFixed(3)),
      coalesceReduction: afterRolling.length - afterCoalesce.length,
      phraseToSegmentRatio: phraseCountRhythmPath
        ? Number((segmentCount / phraseCountRhythmPath).toFixed(3))
        : null
    },
    first10Summary: {
      sourceSegmentCount: Math.min(FORENSIC_FIRST_N, sourceSegmentCount),
      phraseCountRhythmPathShadowTotal: phraseBlocksRhythmPath
        .slice(0, FORENSIC_FIRST_N)
        .length,
      segmentCountFinal: Math.min(FORENSIC_FIRST_N, segmentCount),
      assDialogueCount: Math.min(FORENSIC_FIRST_N, assDialogueCount),
      totalPhraseBlocksOverlappingFirst10Outputs: first10CountsTable.reduce(
        (s, r) => s + r.phraseCount,
        0
      ),
      totalSourceSegmentsAbsorbedFirst10: first10CountsTable.reduce(
        (s, r) => s + r.segmentCount,
        0
      ),
      totalAssDisplayLinesFirst10: first10CountsTable.reduce(
        (s, r) => s + r.assDisplayLineCount,
        0
      )
    },
    first10CountsTable,
    first10Captions,
    wherePhraseCaptionsDisappear: [
      {
        stage: 'phrase_split_skipped_in_production',
        module: 'ass-generator.js → buildSourceAlignedSubtitles',
        condition: 'RENDER_BURN_USE_SOURCE_TIMINGS=1 (default)',
        evidence: `composeRhythmBlocks is NOT called; rhythm-path would yield ${phraseCountRhythmPath} phrase blocks vs ${segmentCount} segment-level canonical cues`,
        phraseCountIfRhythmPath: phraseCountRhythmPath,
        segmentCountInProduction: segmentCount
      },
      {
        stage: 'segment_level_merge',
        module: 'subtitle-pipeline.js → coalesceBurnPhrases',
        evidence: `Cue count ${afterRolling.length} → ${afterCoalesce.length}; short cues dropped or glued into previous cue (sentence-scale blocks)`,
        functions: ['coalesceBurnPhrases']
      },
      {
        stage: 'long_on_screen_duration',
        module: 'subtitle-pipeline.js → stabilizeBurnCueTiming',
        evidence: `MIN_BURN_PHRASE_READ_SEC extends end time; max dialogue duration ${maxDialogueDurationSec.toFixed(2)}s — one ASS event stays visible with full sentence text`,
        functions: ['stabilizeBurnCueTiming']
      },
      {
        stage: 'multi_line_in_single_ass_dialogue',
        module: 'text-layout.js → buildCueLines → ass-generator.js linesToAssText',
        evidence: `One ASS Dialogue per canonical cue; buildCueLines stacks up to maxLines (${cueLayout.maxLines || 'unset'}) with \\N between lines — appears as block caption, not one phrase per dialogue`,
        maxLinesInOneDialogue,
        presetLayout: cueLayout
      }
    ],
    rootCauseAttribution: {
      primaryStructureRegression: 'export uses buildSourceAlignedSubtitles (segment/SRT-level) not composeRhythmBlocks (phrase-level)',
      secondaryCollapse: afterRolling.length > afterCoalesce.length ? 'coalesceBurnPhrases' : 'none',
      cleanSrtAppearanceCause:
        'Long single Dialogue events (segment text + multi-line \\N layout) resemble Clean SRT blocks rather than rapid phrase captions',
      mrBeastStyleHiddenCause:
        'Style preset applies per Dialogue; when one Dialogue contains full sentence and stays ~3s+, emphasis reads as static block not rapid phrase cadence'
    },
    samplesLongBlock: assDialogueRows
      .filter((r) => r.assDialogueDurationSec >= 2.5 || r.assDisplayLineCount >= 2)
      .slice(0, 5)
      .map((r) => ({
        start: r.assDialogueStart,
        end: r.assDialogueEnd,
        durationSec: r.assDialogueDurationSec,
        displayLineCount: r.assDisplayLineCount,
        textPreview: r.fullCueText.slice(0, 120)
      }))
  };
}

export function logPhrasePipelineForensics(rawSegments, opts = {}) {
  if (!isPhrasePipelineForensicEnabled()) return null;

  const report = buildPhrasePipelineForensicsReport(rawSegments, opts);

  console.log('[phrase-pipeline-forensics-counts]', JSON.stringify(report.aggregateCounts));
  console.log('[phrase-pipeline-forensics-first10]', JSON.stringify(report.first10Summary));
  console.log(
    '[phrase-pipeline-forensics-attribution]',
    JSON.stringify(report.rootCauseAttribution)
  );

  for (const stage of report.wherePhraseCaptionsDisappear) {
    console.log('[phrase-pipeline-forensics-stage]', JSON.stringify(stage));
  }

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'PHRASE-PIPELINE-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[phrase-pipeline-forensics] write failed:', err?.message);
    }
  }

  return report;
}
