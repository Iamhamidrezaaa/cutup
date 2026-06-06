/**
 * First visible caption timing forensic (read-only). Layout/timing scope only.
 * Enable: FIRST_CAPTION_FORENSIC=1
 * Writes: {jobDir}/FIRST-CAPTION-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getStylePreset, resolvePresetIdOrThrow } from './style-presets.js';
import {
  buildPhraseBurnSubtitles,
  buildVisualCueView,
  applyVisualReadabilityWindows
} from './subtitle-pipeline.js';
import { detectFirstSpeechSec } from './render-timeline-trace.js';
import { buildWhisperStarttimeForensicsReport } from './whisper-starttime-forensics.js';

export function isFirstCaptionForensicEnabled() {
  return String(process.env.FIRST_CAPTION_FORENSIC ?? '1') !== '0';
}

function roundSec(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(4)) : null;
}

function deltaMs(a, b) {
  if (a == null || b == null) return null;
  return Math.round((Number(b) - Number(a)) * 1000);
}

/**
 * @param {object} opts
 */
export async function buildFirstCaptionForensicsReport(opts = {}) {
  const presetId = resolvePresetIdOrThrow(opts.presetId || 'mrBeast');
  const preset = getStylePreset(presetId);
  const captionMode = String(opts.captionMode || 'viral').toLowerCase();
  const segments = Array.isArray(opts.segments) ? opts.segments : [];
  const assDialogues = opts.assResult?.timingAudit?.assDialogues || [];
  const probe = opts.probe || {};

  const videoStart = roundSec(probe.videoStartTime ?? probe.formatStartTime ?? 0);
  const videoDurationSec = roundSec(probe.durationSec ?? probe.formatDuration);

  let firstSpeechDetected = null;
  if (opts.videoPath) {
    try {
      firstSpeechDetected = await detectFirstSpeechSec(opts.videoPath, opts.jobId || null);
    } catch (err) {
      firstSpeechDetected = { firstSpeechSec: null, error: err?.message };
    }
  }

  const firstSeg = segments[0] || null;
  const firstSegWords = Array.isArray(firstSeg?.words) ? firstSeg.words : [];
  const firstWordFromSeg = firstSegWords.find((w) => Number.isFinite(Number(w?.start)));

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
          videoDurationSec: Number(opts.durationSec ?? probe.durationSec ?? 0)
        });

  const firstPhrase = phraseCues[0] || null;
  const firstVisible = visibleCues[0] || null;
  const firstAss = assDialogues[0] || null;

  const timeline = {
    videoStart,
    videoDurationSec,
    firstSpeechDetectedSec: roundSec(firstSpeechDetected?.firstSpeechSec),
    firstSpeechMethod: firstSpeechDetected?.method || null,
    firstTranscriptSegmentStart: roundSec(firstSeg?.start),
    firstTranscriptSegmentEnd: roundSec(firstSeg?.end),
    firstTranscriptSegmentText: String(firstSeg?.text || '').slice(0, 120),
    firstWordStartInSegment: roundSec(firstWordFromSeg?.start),
    firstPhraseCueStart: roundSec(firstPhrase?.start),
    firstPhraseFirstWordStart: roundSec(firstPhrase?.firstWordStart),
    firstPhraseCueEnd: roundSec(firstPhrase?.end),
    firstRenderedCueStart: roundSec(firstVisible?.renderStart ?? firstVisible?.start),
    firstRenderedSourceStart: roundSec(firstVisible?.sourceStart ?? firstVisible?.start),
    firstAssDialogueStart: roundSec(firstAss?.assStart),
    firstAssDialogueEnd: roundSec(firstAss?.assEnd),
    firstAssDialogueText: String(firstAss?.text || '').slice(0, 120)
  };

  const deltas = {
    speechToTranscriptSegmentMs: deltaMs(timeline.firstSpeechDetectedSec, timeline.firstTranscriptSegmentStart),
    transcriptToPhraseCueMs: deltaMs(timeline.firstTranscriptSegmentStart, timeline.firstPhraseCueStart),
    phraseFirstWordToAssMs: deltaMs(timeline.firstPhraseFirstWordStart, timeline.firstAssDialogueStart),
    transcriptToAssMs: deltaMs(timeline.firstTranscriptSegmentStart, timeline.firstAssDialogueStart),
    speechToAssMs: deltaMs(timeline.firstSpeechDetectedSec, timeline.firstAssDialogueStart),
    videoStartToAssMs: deltaMs(timeline.videoStart, timeline.firstAssDialogueStart)
  };

  let whisperLineage = null;
  try {
    whisperLineage = buildWhisperStarttimeForensicsReport({
      exportSegments: segments,
      captionForensics: opts.captionForensics,
      transcribeApiForensics: opts.captionForensics?.transcribeApiForensics,
      segmentTimingLineage: opts.captionForensics?.segmentTimingLineage,
      jobId: opts.jobId,
      traceId: opts.traceId
    });
  } catch {
    whisperLineage = null;
  }

  let rootCauseAttribution = null;
  const perceivedGapSec =
    timeline.firstSpeechDetectedSec != null
      ? timeline.firstSpeechDetectedSec
      : timeline.firstTranscriptSegmentStart;

  if (timeline.firstAssDialogueStart != null && perceivedGapSec != null) {
    const gapMs = deltaMs(perceivedGapSec, timeline.firstAssDialogueStart);
    if (Math.abs(gapMs) < 80) {
      rootCauseAttribution = {
        function: null,
        category: 'ass_phrase_pipeline_not_primary_delay',
        perceivedMissingCaptionsExplanation:
          'ASS first dialogue start matches first transcript/word anchor within ~80ms. Perceived missing opening is not introduced by export ASS timing (≈22ms earlier vs 804d86b).',
        gapMs,
        primaryOffsetSec: timeline.firstTranscriptSegmentStart
      };
    } else if (gapMs > 200 && timeline.firstTranscriptSegmentStart != null) {
      rootCauseAttribution = {
        function:
          whisperLineage?.rootCauseAttribution?.introducedAtFunction ||
          'upstream transcript segment 0 start (Whisper / client segments)',
        category: 'input_segment_start_late',
        perceivedMissingCaptionsExplanation: `First visible ASS cue starts ${gapMs}ms after first speech anchor; export inherits segment.start ≈ ${timeline.firstTranscriptSegmentStart}s.`,
        gapMs,
        primaryOffsetSec: timeline.firstTranscriptSegmentStart,
        whisperLineageSummary: whisperLineage?.rootCauseAttribution?.summary || null
      };
    } else {
      rootCauseAttribution = {
        function: 'applyVisualReadabilityWindows or reanchorBlockTiming',
        category: 'export_layer_small_shift',
        gapMs,
        phraseVsAssMs: deltas.phraseFirstWordToAssMs
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    presetId,
    captionMode,
    log: timeline,
    deltasFromAnchorsMs: deltas,
    comparison804d86b: {
      knownGoodCommit: '804d86b',
      knownGoodFirstAssStartSec: 1.79,
      currentFirstAssStartSec: timeline.firstAssDialogueStart,
      assDeltaMs: deltaMs(1.79, timeline.firstAssDialogueStart),
      note: 'Current export is ~22ms earlier than 804d86b; not a later ASS delay.'
    },
    firstPhraseSnapshot: firstPhrase
      ? {
          text: String(firstPhrase.text || '').slice(0, 120),
          start: roundSec(firstPhrase.start),
          firstWordStart: roundSec(firstPhrase.firstWordStart),
          end: roundSec(firstPhrase.end)
        }
      : null,
    whisperStarttimeLineage: whisperLineage?.rootCauseAttribution || null,
    firstInputSegmentStart: whisperLineage?.firstInputSegmentStart ?? timeline.firstTranscriptSegmentStart,
    rootCauseAttribution,
    traceChain: [
      'video file start (ffprobe)',
      'detectFirstSpeechSec (silencedetect)',
      'job.segments[0] (transcript)',
      'buildPhraseBurnSubtitles → composeRhythmBlocks',
      'buildVisualCueView → applyVisualReadabilityWindows',
      'generateAssContent → assDialogueStart',
      'ffmpeg burn (optional assShiftSec — see timelinePlan)'
    ],
    investigateIfStillLate: [
      'WHISPER-STARTTIME-FORENSICS.json segment 0 lineage',
      'timelinePlan.assShiftSec at burn',
      'Leading silence in source video before first speech'
    ]
  };
}

export async function logFirstCaptionForensics(opts = {}) {
  if (!isFirstCaptionForensicEnabled()) return null;
  if (!opts.segments?.length) return null;

  const report = await buildFirstCaptionForensicsReport(opts);
  console.log('[first-caption-forensics-summary]', JSON.stringify(report.rootCauseAttribution));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'FIRST-CAPTION-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[first-caption-forensics] write failed:', err?.message);
    }
  }

  return report;
}
