/**
 * Shared finalize step for transcribe/upload handlers — branches V1 vs V2.
 */
import { isAsrPipelineV2, finalizeV2Transcript } from './transcription-v2.js';
import { applyV1PostProcessing } from './asr-v1-postprocess.js';
import { captureTranscriptionSubtitleIntegrity } from '../subtitle-integrity-audit.js';
import {
  resolvePipelineLanguage,
  formatLanguageDetectionForApi
} from '../language-detection-pipeline.js';

/**
 * @param {object} opts
 * @param {object} opts.transcript — raw or cached transcript
 * @param {string} [opts.traceId]
 * @param {string} [opts.openAiKeyForGpt]
 * @param {object} [opts.preTranscription]
 * @param {typeof fetch} [opts.fetch]
 * @param {Buffer} [opts.audioBuffer]
 * @param {string} [opts.mimeType]
 * @param {string} [opts.extension]
 */
export async function finalizeAsrPipelineOutput(opts = {}) {
  const {
    transcript,
    traceId = '',
    openAiKeyForGpt = '',
    preTranscription = null,
    fetch,
    audioBuffer,
    mimeType,
    extension
  } = opts;

  if (isAsrPipelineV2()) {
    const v2 = finalizeV2Transcript(transcript);
    return {
      text: v2.text,
      segments: v2.segments,
      words: v2.words,
      language: v2.language,
      resolvedLanguage: v2.language,
      provider: v2.provider || transcript?.provider,
      model: v2.model,
      asrPipeline: 'v2',
      cleanSrt: v2.cleanSrt,
      segmentSource: v2.segmentSource || transcript.segmentSource || null,
      gapRetranscribe: v2.gapRetranscribe || transcript.gapRetranscribe || null,
      wordGapFill: v2.wordGapFill || null,
      whisperLeadingOffsetSec: 0,
      languageDetection: null,
      subtitleIntegrity: null,
      whisperTimingForensics: undefined,
      v1Stages: null
    };
  }

  const v1 = await applyV1PostProcessing({ transcript, openAiKeyForGpt, traceId });

  const languageProfile = await resolvePipelineLanguage({
    traceId,
    fetch,
    providerLanguage: transcript.priorMisdetectedLanguage || transcript.language,
    providerConfidence: transcript.languageConfidence,
    providerId: transcript.provider,
    text: v1.text,
    segments: v1.segments,
    audioBuffer,
    mimeType,
    extension,
    preTranscription
  });

  const rawProviderSegments = JSON.parse(JSON.stringify(transcript.segments || []));
  const subtitleIntegrity = captureTranscriptionSubtitleIntegrity({
    traceId,
    rawProvider: rawProviderSegments,
    afterValidFilter: v1.validSegments,
    afterWordSync: v1.wordSyncedSegments,
    afterOffset: v1.offsetSegments,
    afterPostProcess: v1.segments
  });

  let whisperTimingForensics;
  if (String(process.env.WHISPER_STARTTIME_FORENSIC ?? '1') !== '0') {
    const { buildTranscribeApiWhisperForensicSnapshot } = await import(
      '../video-render/whisper-starttime-forensics.js'
    );
    whisperTimingForensics = {
      whisperProviderRawFirst10: buildTranscribeApiWhisperForensicSnapshot(transcript.segments || []),
      afterGptCorrectionFirst10: buildTranscribeApiWhisperForensicSnapshot(v1.correctedSegments || []),
      afterValidFilterFirst10: buildTranscribeApiWhisperForensicSnapshot(v1.segments),
      whisperLeadingOffsetSec: v1.whisperLeadingOffsetSec || undefined
    };
  }

  return {
    text: v1.text,
    segments: v1.segments,
    words: null,
    language: transcript.language,
    resolvedLanguage: languageProfile.language || transcript.language || 'unknown',
    provider: transcript.provider,
    model: null,
    asrPipeline: 'v1',
    cleanSrt: null,
    whisperLeadingOffsetSec: v1.whisperLeadingOffsetSec,
    languageDetection: formatLanguageDetectionForApi(languageProfile),
    subtitleIntegrity: {
      rawSegments: subtitleIntegrity.report?.rawSegments,
      cleanedSegments: subtitleIntegrity.report?.cleanedSegments,
      warningCount: subtitleIntegrity.report?.warnings?.length || 0,
      removedCount: subtitleIntegrity.report?.removedSegments?.length || 0,
      suspiciousGapCount: subtitleIntegrity.report?.suspiciousGaps?.length || 0
    },
    whisperTimingForensics,
    v1Stages: v1
  };
}
