/**
 * Timing origin investigation — diagnostics only (does not alter cue timing).
 * Explains early-video subtitle lag (often 1–2s) across pipeline stages.
 */

import {
  BURN_LEAD_DELAY_SEC,
  BURN_TAIL_PAD_SEC,
  buildSourceAlignedSubtitles,
  mergeRollingCaptionChains
} from './video-render/subtitle-pipeline.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function msDelta(a, b) {
  if (a == null || b == null) return null;
  return Math.round((a - b) * 1000);
}

function audioBounds(seg) {
  const words = Array.isArray(seg?.words) ? seg.words : [];
  const timed = words.filter(
    (w) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end))
  );
  if (!timed.length) {
    return { audioStart: num(seg?.start), audioEnd: num(seg?.end) };
  }
  return {
    audioStart: Number(timed[0].start),
    audioEnd: Number(timed[timed.length - 1].end)
  };
}

/**
 * Simulate export burn path timestamps without persisting changes.
 * @param {{ start, end, text, words? }[]} segments
 */
export function simulateExportTiming(segments) {
  return buildSourceAlignedSubtitles(segments);
}

/**
 * @param {object} opts
 * @param {{ start, end, text, words? }[]} opts.transcriptSegments — Whisper/source truth
 * @param {{ start, end, text }[]} [opts.translatedSegments]
 * @param {string} [opts.traceId]
 */
export function investigateTimingOrigins(opts) {
  const transcriptSegments = Array.isArray(opts.transcriptSegments) ? opts.transcriptSegments : [];
  const translatedSegments = Array.isArray(opts.translatedSegments)
    ? opts.translatedSegments
    : transcriptSegments;
  const traceId = opts.traceId || null;
  const cueLimit = 5;

  const exportSimulated = simulateExportTiming(translatedSegments);
  const rollingOnly = mergeRollingCaptionChains(translatedSegments);

  const cues = [];
  const findings = [];

  const firstTranscriptStart = num(transcriptSegments[0]?.start);
  const firstTranslatedStart = num(translatedSegments[0]?.start);
  const firstExportStart = num(exportSimulated[0]?.start);

  if (firstTranscriptStart != null && firstTranscriptStart > 0.5) {
    findings.push({
      cause: 'whisper_first_segment_late',
      detail: `First transcript cue starts at ${firstTranscriptStart.toFixed(3)}s — Whisper often skips silence/intro before speech.`,
      deltaMs: Math.round(firstTranscriptStart * 1000)
    });
  }

  if (
    firstTranscriptStart != null &&
    firstExportStart != null &&
    firstExportStart - firstTranscriptStart > 0.05
  ) {
    findings.push({
      cause: 'export_stabilize_lead_delay',
      detail: `buildSourceAlignedSubtitles → stabilizeBurnCueTiming adds BURN_LEAD_DELAY_SEC=${BURN_LEAD_DELAY_SEC}s to start (makes subs appear later, not earlier).`,
      deltaMs: msDelta(firstExportStart, firstTranscriptStart)
    });
  }

  if (transcriptSegments.length > rollingOnly.length + 2) {
    findings.push({
      cause: 'rolling_caption_merge',
      detail: `mergeRollingCaptionChains reduced ${transcriptSegments.length} → ${rollingOnly.length} cues; first visible phrase may start at later rolling chunk end.`,
      inputCues: transcriptSegments.length,
      afterMerge: rollingOnly.length
    });
  }

  if (
    firstTranslatedStart != null &&
    firstTranscriptStart != null &&
    Math.abs(firstTranslatedStart - firstTranscriptStart) > 0.05
  ) {
    findings.push({
      cause: 'translation_timestamp_drift',
      detail: 'First translated cue start differs from transcript — check translate/postProcess merge.',
      deltaMs: msDelta(firstTranslatedStart, firstTranscriptStart)
    });
  }

  findings.push({
    cause: 'export_tail_and_min_read',
    detail: `stabilizeBurnCueTiming also applies tail pad ${BURN_TAIL_PAD_SEC}s and min read duration — affects end times more than start.`
  });

  for (let i = 0; i < cueLimit; i++) {
    const tr = transcriptSegments[i];
    const tl = translatedSegments[i];
    const ex = exportSimulated[i];
    if (!tr && !tl && !ex) break;

    const { audioStart, audioEnd } = audioBounds(tr || tl);
    const transcriptStart = num(tr?.start ?? tl?.start);
    const transcriptEnd = num(tr?.end ?? tl?.end);
    const translatedStart = num(tl?.start);
    const translatedEnd = num(tl?.end);
    const exportStart = num(ex?.start);
    const exportEnd = num(ex?.end);

    cues.push({
      index: i,
      text: String((tl?.text || tr?.text || '')).slice(0, 60),
      transcriptStart,
      transcriptEnd,
      translatedStart,
      translatedEnd,
      exportStart,
      exportEnd,
      audioStart,
      audioEnd,
      deltasMs: {
        translatedVsTranscriptStart: msDelta(translatedStart, transcriptStart),
        exportVsTranslatedStart: msDelta(exportStart, translatedStart),
        exportVsTranscriptStart: msDelta(exportStart, transcriptStart),
        exportVsAudioStart: msDelta(exportStart, audioStart),
        transcriptVsAudioStart: msDelta(transcriptStart, audioStart)
      }
    });
  }

  const primaryLagMs =
    cues[0]?.deltasMs?.exportVsTranscriptStart ??
    (firstTranscriptStart != null ? Math.round(firstTranscriptStart * 1000) : null);

  const report = {
    traceId,
    investigatedCues: cues.length,
    primaryEarlyVideoLagMs: primaryLagMs,
    likelyRootCauses: findings,
    firstCueSummary: {
      whisperOrTranscriptStartSec: firstTranscriptStart,
      translatedStartSec: firstTranslatedStart,
      exportSimulatedStartSec: firstExportStart,
      videoStartsAtZero: firstTranscriptStart === 0 || firstTranscriptStart == null
    },
    investigationNote:
      '1–2s late subs at video start are usually Whisper first-segment start > 0 (silence/intro), not BURN_LEAD_DELAY (which adds ~90ms lag). Export merge can shift phrase start when rolling captions collapse.',
    cues
  };

  console.log('[timing-origin-investigation]', JSON.stringify(report, null, 0));
  return report;
}
