/**
 * Shared upload transcription pipeline (sync + async jobs).
 */
import { transcribeLargeFile } from './chunk-processor.js';
import {
  estimateTranscriptionMinutesFromBytes,
  billingMinutesFromWhisperSegments,
  consumeTranscriptionUsage
} from './processing-enforcement.js';
import {
  userMessageForCode,
  retryableForCode,
  mapToTranscriptErrorCode
} from './transcript-errors.js';
import { transcribeAudioPayload, messageForAllProvidersFailed } from './transcription/transcription-router.js';
import { isAsrPipelineV2, transcribeForPipeline } from './transcription/transcription-v2.js';
import { finalizeAsrPipelineOutput } from './transcription/asr-pipeline-finalize.js';
import { getTranscriptionProviderRegistry } from './transcription/init.js';
import { runQueuedTranscribe } from './infrastructure/guards.js';
import { transcribeDebug } from './infrastructure/observability.js';
import {
  audioDurationFromSegments,
  buildTranscriptionRuntime
} from './transcription/transcription-runtime.js';
import {
  runPreTranscriptionLanguageDetection,
  resolveTranscriptionLanguageHint,
  shouldAttemptAccentEnglishRetranscribe,
  pickAccentRetranscribeWinner
} from './language-detection-pipeline.js';

export class UploadProcessError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'UploadProcessError';
    this.errorCode = opts.errorCode || 'UNKNOWN_ERROR';
    this.statusCode = opts.statusCode || 500;
    this.retryable = opts.retryable !== false;
    this.traceId = opts.traceId || null;
    this.phase = opts.phase || 'transcription';
    this.providerDebug = opts.providerDebug || null;
    this.consumeDenied = Boolean(opts.consumeDenied);
    this.consumeReason = opts.consumeReason || null;
  }
}

function touchPhase(onPhase, phase, progress) {
  if (typeof onPhase === 'function') onPhase({ phase, progress });
}

/**
 * @param {object} ctx
 * @returns {Promise<{ responseData: object, preMinutes: number, traceId: string }>}
 */
export async function processUploadBuffer(ctx) {
  const {
    userEmail,
    traceId,
    audioBuffer,
    mimeType,
    extension,
    filename,
    fetch,
    onPhase
  } = ctx;

  const preMinutes = estimateTranscriptionMinutesFromBytes(audioBuffer.length);
  transcribeDebug(traceId, { phase: 'input_ready', bytes: audioBuffer.length, route: 'upload' });
  touchPhase(onPhase, 'transcribing', 25);

  let preTranscription = null;
  let hintResolution = { languageHint: null, source: 'none', suppressed: false };
  if (!isAsrPipelineV2()) {
    try {
      preTranscription = await runPreTranscriptionLanguageDetection({
        traceId,
        fetch,
        audioBuffer,
        mimeType,
        extension
      });
    } catch (preLangErr) {
      console.warn('[pre-transcription-language-failed]', {
        traceId,
        message: preLangErr?.message || String(preLangErr)
      });
    }

    hintResolution = resolveTranscriptionLanguageHint({
      traceId,
      clientHint: null,
      preTranscription
    });
  }
  const effectiveLanguageHint = hintResolution.languageHint;

  const transcribeOne = async (buf, mt, ext, hintOverride = undefined) =>
    transcribeForPipeline(
      {
        fetch,
        traceId,
        audioBuffer: buf,
        mimeType: mt,
        extension: ext,
        languageHint: hintOverride !== undefined ? hintOverride : effectiveLanguageHint
      },
      (b, m, e, h) =>
        transcribeAudioPayload({
          fetch,
          traceId,
          audioBuffer: b,
          mimeType: m,
          extension: e,
          languageHint: h !== undefined ? h : effectiveLanguageHint
        })
    );

  let transcript;
  let transcriptionDurationMs = 0;
  touchPhase(onPhase, 'transcribing', 40);

  try {
    const transcribeStartedAt = Date.now();
    transcript = await runQueuedTranscribe({
      userEmail,
      traceId,
      durationSec: null,
      fn: async () => {
        if (audioBuffer.length > 25 * 1024 * 1024) {
          return transcribeLargeFile(audioBuffer, mimeType, extension, transcribeOne).then((chunkResult) => ({
            text: chunkResult.text,
            segments: chunkResult.segments,
            language: chunkResult.language,
            languageConfidence: chunkResult.languageConfidence,
            provider: chunkResult.provider,
            asrChunkCaptures: chunkResult.asrChunkCaptures || [],
            asrChunkDiagnostics: chunkResult.asrChunkDiagnostics || [],
            asrDiagnostics: {
              winnerProviderId: chunkResult.provider,
              chunking: chunkResult.chunking || null
            }
          }));
        }
        return transcribeOne(audioBuffer, mimeType, extension);
      }
    });
    transcriptionDurationMs = Date.now() - transcribeStartedAt;
  } catch (routerErr) {
    if (routerErr?.name === 'TranscriptionProviderError') {
      const pe = routerErr;
      throw new UploadProcessError(userMessageForCode(pe.code) || userMessageForCode('TRANSCRIPTION_FAILED'), {
        errorCode: pe.code || 'TRANSCRIPTION_FAILED',
        statusCode: pe.code === 'INVALID_AUDIO' ? 400 : 503,
        retryable: pe.code !== 'INVALID_AUDIO' && retryableForCode(pe.code || 'TRANSCRIPTION_FAILED'),
        traceId,
        phase: 'transcription',
        providerDebug: {
          providerId: pe.providerId,
          httpStatus: pe.httpStatus,
          details: pe.details
        }
      });
    }
    if (routerErr?.name === 'AllProvidersFailedError') {
      const reg = getTranscriptionProviderRegistry();
      throw new UploadProcessError(messageForAllProvidersFailed(routerErr, reg), {
        errorCode: 'TRANSCRIPTION_FAILED',
        statusCode: 503,
        retryable: true,
        traceId,
        phase: 'transcription',
        providerDebug: {
          attemptedProviders: routerErr.attemptedProviders || [],
          lastProvider: routerErr.lastProviderId || null,
          lastError: String(routerErr.lastError?.message || '').slice(0, 500),
          activeProviders: [...reg.activeProviders],
          fallbackProviders: [...reg.fallbackProviders]
        }
      });
    }
    throw new UploadProcessError(userMessageForCode('PROVIDER_ERROR'), {
      errorCode: 'PROVIDER_ERROR',
      statusCode: 500,
      retryable: true,
      traceId,
      phase: 'transcription'
    });
  }

  touchPhase(onPhase, 'transcribing', 78);

  if (
    !isAsrPipelineV2() &&
    audioBuffer.length <= 25 * 1024 * 1024 &&
    shouldAttemptAccentEnglishRetranscribe(transcript, hintResolution, preTranscription)
  ) {
    try {
      const accentRetryStartedAt = Date.now();
      const englishRetry = await transcribeOne(audioBuffer, mimeType, extension, 'en');
      const picked = pickAccentRetranscribeWinner(transcript, englishRetry, preTranscription);
      transcriptionDurationMs += Date.now() - accentRetryStartedAt;
      if (picked.usedRetry) {
        transcript = {
          ...picked.transcript,
          provider: englishRetry.provider || picked.transcript.provider
        };
      }
    } catch (retryErr) {
      console.warn('[accent-english-retranscribe-failed]', {
        traceId,
        message: retryErr?.message || String(retryErr)
      });
    }
  }

  if (!transcript?.text || transcript.text.trim().length === 0) {
    throw new UploadProcessError('Whisper API returned empty text', {
      errorCode: 'INVALID_AUDIO',
      statusCode: 400,
      retryable: false,
      traceId,
      phase: 'transcription'
    });
  }

  touchPhase(onPhase, 'finalizing', 88);

  const finalized = await finalizeAsrPipelineOutput({
    transcript,
    traceId,
    preTranscription,
    fetch,
    audioBuffer,
    mimeType,
    extension
  });

  let correctedText = finalized.text || transcript.text || '';
  const timelineSegments = finalized.segments || [];

  if (!correctedText || correctedText.trim().length === 0) {
    throw new UploadProcessError('No text was transcribed from the audio file', {
      errorCode: 'INVALID_AUDIO',
      statusCode: 400,
      retryable: false,
      traceId,
      phase: 'transcription'
    });
  }

  const transcriptionRuntime = buildTranscriptionRuntime({
    providerId: finalized.provider || transcript.provider,
    transcriptionDurationMs,
    audioDurationSec: audioDurationFromSegments(timelineSegments, transcript.durationSeconds)
  });

  const responseData = {
    text: correctedText,
    language: finalized.resolvedLanguage,
    segments: timelineSegments || [],
    ...(finalized.words ? { words: finalized.words } : {}),
    ...(finalized.asrPipeline === 'v2'
      ? {
          asrPipeline: 'v2',
          model: finalized.model,
          ...(finalized.wordGapFill ? { wordGapFill: finalized.wordGapFill } : {}),
          ...(finalized.segmentSource ? { segmentSource: finalized.segmentSource } : {}),
          ...(finalized.gapRetranscribe ? { gapRetranscribe: finalized.gapRetranscribe } : {})
        }
      : {}),
    transcriptionRuntime,
    ...(finalized.languageDetection ? { languageDetection: finalized.languageDetection } : {}),
    ...(finalized.subtitleIntegrity ? { subtitleIntegrity: finalized.subtitleIntegrity } : {})
  };

  touchPhase(onPhase, 'billing', 94);

  const billedMinutes = billingMinutesFromWhisperSegments(timelineSegments);
  const consumed = await consumeTranscriptionUsage(userEmail, billedMinutes, {
    route: 'upload',
    filename: filename || 'audio',
    precheckMinutes: preMinutes,
    outputType: 'transcript',
    platform: 'upload',
    title: filename || 'Uploaded file',
    sourceUrl: 'upload://local-file',
    durationSeconds: timelineSegments.length
      ? Math.ceil(timelineSegments[timelineSegments.length - 1].end || 0)
      : null
  });

  if (!consumed?.ok) {
    throw new UploadProcessError(consumed?.reason || 'Quota exceeded.', {
      errorCode: 'QUOTA_EXCEEDED',
      statusCode: 403,
      retryable: false,
      traceId,
      phase: 'billing',
      consumeDenied: true,
      consumeReason: consumed?.reason || null
    });
  }

  return { responseData, preMinutes, traceId };
}

export function uploadErrorFromUnknown(err, traceId) {
  if (err instanceof UploadProcessError) return err;
  const errorCode = mapToTranscriptErrorCode('UPLOAD_ERROR', { message: err?.message });
  return new UploadProcessError(userMessageForCode(errorCode), {
    errorCode,
    statusCode: 500,
    retryable: retryableForCode(errorCode),
    traceId,
    phase: 'upload'
  });
}
