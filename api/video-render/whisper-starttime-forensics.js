/**
 * Upstream segment start-time lineage (read-only). Does not assume Whisper is wrong.
 * Enable: WHISPER_STARTTIME_FORENSIC=1
 * Writes: {jobDir}/WHISPER-STARTTIME-FORENSICS.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { decodeSubtitleTextEntities } from '../subtitle-text-entities.js';
import { refineCueTimingsFromWords } from '../subtitle-translation-pipeline.js';
import {
  buildSegmentTimingSnapshot,
  buildTimingChangeLog,
  findFirstSegmentZeroChange,
  roundTimingSec,
  timingDeltaMs
} from './segment-timing-lineage.js';
import { isDebugExportEnabled } from './export-debug.js';

const MAX = 10;

export function isWhisperStarttimeForensicEnabled() {
  return isDebugExportEnabled() && String(process.env.WHISPER_STARTTIME_FORENSIC ?? '1') !== '0';
}

function startAt(snapshot, index) {
  const row = (snapshot || []).find((r) => r.segmentIndex === index);
  return row?.start ?? null;
}

function exportNormalizeSegments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s) =>
        s &&
        typeof s.start === 'number' &&
        typeof s.end === 'number' &&
        s.end > s.start &&
        String(s.text || '').trim()
    )
    .map((s) => ({
      start: s.start,
      end: s.end,
      text: decodeSubtitleTextEntities(String(s.text).trim()),
      words: Array.isArray(s.words) ? s.words : undefined
    }));
}

function stageFromApiRows(rows, functionName) {
  return {
    functionName,
    segments: (rows || []).map((r) => ({
      segmentIndex: r.segmentIndex,
      start: roundTimingSec(r.segmentStartRawFromWhisper ?? r.start),
      end: roundTimingSec(r.segmentEndRawFromWhisper ?? r.end),
      firstWordStart: roundTimingSec(r.firstWordStartRaw ?? r.firstWordStart),
      firstWordEnd: roundTimingSec(r.firstWordEndRaw ?? r.firstWordEnd),
      wordCount: r.wordCount ?? 0,
      textPreview: r.textPreview || ''
    }))
  };
}

function stageFromClient(trace, stageName, functionName) {
  const hit = (trace?.stages || []).find((s) => s.stage === stageName);
  return {
    functionName: functionName || stageName,
    segments: (hit?.segments || []).map((r) => ({
      segmentIndex: r.segmentIndex,
      start: roundTimingSec(r.segmentStartRawFromWhisper ?? r.start),
      end: roundTimingSec(r.segmentEndRawFromWhisper ?? r.end),
      firstWordStart: roundTimingSec(r.firstWordStartRaw ?? r.firstWordStart),
      firstWordEnd: roundTimingSec(r.firstWordEndRaw ?? r.firstWordEnd),
      wordCount: r.wordCount ?? 0,
      textPreview: r.textPreview || ''
    }))
  };
}

/**
 * @param {object} opts
 */
export function buildWhisperStarttimeForensicsReport(opts = {}) {
  const exportSegs = exportNormalizeSegments(opts.exportSegments || []);
  const transcriptSegs = exportNormalizeSegments(
    opts.captionForensics?.transcriptSegments || opts.transcriptSegments || []
  );
  const translatedSegs = exportNormalizeSegments(
    opts.captionForensics?.translatedSegments || opts.translatedSegments || exportSegs
  );
  const clientTrace = opts.captionForensics?.whisperTimingTrace || opts.whisperTimingTrace || null;
  const apiForensics = opts.transcribeApiForensics || opts.captionForensics?.transcribeApiForensics || {};
  const translateLineage = opts.segmentTimingLineage || opts.captionForensics?.segmentTimingLineage || [];

  const alignedReplay = refineCueTimingsFromWords(translatedSegs);

  const stageSnapshots = [
    stageFromApiRows(apiForensics.whisperProviderRawFirst10, 'transcribe.providerRawResponse'),
    stageFromApiRows(apiForensics.afterGptCorrectionFirst10, 'transcribe.afterGptTextRemap'),
    stageFromApiRows(apiForensics.afterValidFilterFirst10, 'transcribe.validSegmentsFilter'),
    stageFromClient(clientTrace, 'whisper_api_response', 'client.normalizeTranscriptionResult.input'),
    stageFromClient(clientTrace, 'after_client_normalize', 'client.normalizeTranscriptionResult.output'),
    stageFromClient(clientTrace, 'after_register_original', 'CutupSubtitleVersions.registerOriginal'),
    stageFromClient(clientTrace, 'after_translate_api', 'client.afterTranslateApiResponse'),
    stageFromClient(clientTrace, 'after_register_translation', 'CutupSubtitleVersions.registerTranslation'),
    stageFromClient(clientTrace, 'after_display_results', 'client.displayResults'),
    ...translateLineage.map((s) => ({
      functionName: s.functionName,
      segments: s.segments || []
    })),
    {
      functionName: 'export-video.normalizeSegments',
      segments: buildSegmentTimingSnapshot(exportSegs)
    },
    {
      functionName: 'forensicReplay.refineCueTimingsFromWords',
      segments: buildSegmentTimingSnapshot(alignedReplay)
    },
    {
      functionName: 'phrasePipeline.input.jobSegments',
      segments: buildSegmentTimingSnapshot(exportSegs)
    }
  ].filter((s) => s.segments?.length);

  const changeLog = buildTimingChangeLog(stageSnapshots);
  const firstSeg0 = findFirstSegmentZeroChange(stageSnapshots);

  const first10 = [];
  for (let i = 0; i < MAX; i++) {
    const rawWhisperSegmentStart = startAt(stageSnapshots[0]?.segments, i) ??
      startAt(stageFromClient(clientTrace, 'whisper_api_response').segments, i);
    const normalizedSegmentStart =
      startAt(stageFromClient(clientTrace, 'after_client_normalize').segments, i) ??
      roundTimingSec(transcriptSegs[i]?.start);
    const cleanedSegmentStart = roundTimingSec(transcriptSegs[i]?.start);
    const alignedSegmentStart =
      startAt(
        translateLineage.find((s) => s.functionName === 'postProcess.afterRefineCueTimings')?.segments,
        i
      ) ?? roundTimingSec(alignedReplay[i]?.start);
    const finalSegmentStartUsedByPhrasePipeline = roundTimingSec(exportSegs[i]?.start);

    first10.push({
      segmentIndex: i,
      rawWhisperSegmentStart,
      normalizedSegmentStart,
      cleanedSegmentStart,
      alignedSegmentStart,
      finalSegmentStartUsedByPhrasePipeline,
      firstWordStartAtProvider: startAt(stageSnapshots[0]?.segments, i)
        ? (apiForensics.whisperProviderRawFirst10?.[i]?.firstWordStartRaw ?? null)
        : null,
      textPreview: String(exportSegs[i]?.text || translatedSegs[i]?.text || '').slice(0, 80),
      perStageStarts: stageSnapshots.map((st) => ({
        functionName: st.functionName,
        start: startAt(st.segments, i)
      }))
    });
  }

  const targetStart = first10[0]?.finalSegmentStartUsedByPhrasePipeline ?? first10[0]?.rawWhisperSegmentStart;

  return {
    generatedAt: new Date().toISOString(),
    jobId: opts.jobId || null,
    traceId: opts.traceId || null,
    methodology:
      'Neutral lineage: does not assume Whisper is wrong. Compares start timestamps across captured stages; reports first function where segment 0 start changes.',
    historicalNote:
      'If captions previously appeared earlier in this project, a later pipeline stage (post-Whisper) may have shifted indices or segment boundaries — compare changeLog and perStageStarts.',
    firstInputSegmentStart: targetStart,
    first10Segments: first10,
    timestampChangeLog: changeLog,
    rootCauseAttribution: {
      introducedAtFunction: firstSeg0.introducedAtFunction,
      introducedDelayMs: firstSeg0.introducedDelayMs,
      baselineStart: firstSeg0.baselineStart,
      firstChange: firstSeg0.firstChange,
      summary: firstSeg0.note,
      whereFirstInputSegmentStartComesFrom:
        firstSeg0.firstChange == null
          ? `firstInputSegmentStart (${targetStart}s) equals earliest captured provider/client start — not introduced by a later function in captured stages.`
          : `firstInputSegmentStart (${targetStart}s) inherits from chain; first detected change: ${firstSeg0.introducedAtFunction}.`
    },
    capturedStages: stageSnapshots.map((s) => s.functionName),
    investigateZones: {
      beforeWhisper: ['audio extraction', 'video trim', 'chunk offset (transcribeLargeFile)'],
      insideWhisper: ['transcribe.providerRawResponse'],
      afterWhisper: stageSnapshots.slice(1).map((s) => s.functionName)
    }
  };
}

export function logWhisperStarttimeForensics(opts = {}) {
  if (!isWhisperStarttimeForensicEnabled()) return null;

  const report = buildWhisperStarttimeForensicsReport(opts);

  console.log('[whisper-starttime-forensics-summary]', JSON.stringify(report.rootCauseAttribution));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(
        join(opts.jobDir, 'WHISPER-STARTTIME-FORENSICS.json'),
        JSON.stringify(report, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn('[whisper-starttime-forensics] write failed:', err?.message);
    }
  }

  return report;
}

export function buildTranscribeApiWhisperForensicSnapshot(segments) {
  return buildSegmentTimingSnapshot(segments).map((row) => ({
    segmentIndex: row.segmentIndex,
    segmentStartRawFromWhisper: row.start,
    segmentEndRawFromWhisper: row.end,
    firstWordStartRaw: row.firstWordStart,
    firstWordEndRaw: row.firstWordEnd,
    wordCount: row.wordCount,
    textPreview: row.textPreview
  }));
}
