// API endpoint for transcribing audio using Whisper
// Deploy this to Vercel as a serverless function
// VERSION 4.1 - Using node-fetch directly to avoid ECONNRESET - NO client variable

import { handleCORS, setCORSHeaders } from './cors.js';
import fetchModule from 'node-fetch';
import Busboy from 'busboy';
import { transcribeLargeFile } from './chunk-processor.js';
import {
  requireSessionEmail,
  estimateTranscriptionMinutesFromBytes,
  billingMinutesFromWhisperSegments,
  consumeTranscriptionUsage,
  respondConsumeFailure
} from './processing-enforcement.js';
import {
  resolveTraceId,
  sendTranscriptError,
  sendTranscriptErrorFromLegacy,
  sendTranscriptSuccess,
  mapToTranscriptErrorCode,
  userMessageForCode,
  retryableForCode
} from './transcript-errors.js';
import { traceLog } from './pipeline-trace.js';
import { transcribeAudioPayload, messageForAllProvidersFailed } from './transcription/transcription-router.js';
import { isAsrPipelineV2, transcribeForPipeline } from './transcription/transcription-v2.js';
import { finalizeAsrPipelineOutput } from './transcription/asr-pipeline-finalize.js';
import {
  audioDurationFromSegments,
  buildTranscriptionRuntime
} from './transcription/transcription-runtime.js';
import { ensureTranscriptionProvidersInit, getTranscriptionProviderRegistry } from './transcription/init.js';
import { AllProvidersFailedError, TranscriptionProviderError } from './transcription/errors.js';
import { logProviderTimeout } from './provider-health.js';
import {
  runQueuedTranscribe,
  getCachedExtraction,
  setCachedExtraction,
  dedupeKeyForUrl
} from './infrastructure/guards.js';
import { transcribeDebug } from './infrastructure/observability.js';
import {
  runPreTranscriptionLanguageDetection,
  resolveTranscriptionLanguageHint,
  shouldAttemptAccentEnglishRetranscribe,
  pickAccentRetranscribeWinner
} from './language-detection-pipeline.js';

export default async function handler(req, res) {
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const traceId = resolveTraceId(req, requestId);
  const pipelineLog = (stage, data = {}) => {
    console.log(`[PIPELINE][${requestId}][${stage}]`, data);
  };
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Trace-Id', traceId);
  traceLog(traceId, 'start', { route: 'transcribe', requestId });
  // Log immediately when function is called
  console.log("=== TRANSCRIBE FUNCTION CALLED V4.2 ===");
  pipelineLog('REQUEST_RECEIVED', { method: req.method, url: req.url });
  console.log("TRANSCRIBE V4.2: NO OpenAI SDK - NO client variable - Using node-fetch");
  console.log("TRANSCRIBE: Timestamp:", new Date().toISOString());
  console.log("TRANSCRIBE: Request method:", req.method);
  console.log("TRANSCRIBE: Request URL:", req.url);
  
  // Initialize fetch from node-fetch module
  let fetch;
  try {
    // In node-fetch v3, the default export is the fetch function
    fetch = fetchModule.default || fetchModule;
    console.log("TRANSCRIBE: Fetch initialized, type:", typeof fetch);
    
    if (typeof fetch !== 'function') {
      throw new Error(`fetch is not a function, got: ${typeof fetch}`);
    }
  } catch (err) {
      console.error("TRANSCRIBE_ERROR: Failed to initialize fetch:", err);
      pipelineLog('INIT_ERROR', { error: err?.message });
    setCORSHeaders(res);
    return res.status(500).json({ 
      error: 'INIT_ERROR', 
        requestId,
      details: `Failed to initialize fetch: ${err.message}`,
      errorType: 'ReferenceError',
      message: 'Transcription failed [ReferenceError]'
    });
  }
  
  // Handle CORS - باید اولین کاری باشد
  const corsHandled = handleCORS(req, res);
  if (corsHandled) {
    console.log("TRANSCRIBE: OPTIONS request handled, returning");
    return; // OPTIONS request handled
  }

  console.log('TRANSCRIBE: Provider env presence:', {
    hasOpenAi: !!(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).length >= 10),
    hasGroq: !!(process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).length >= 10),
    hasDeepgram: !!(process.env.DEEPGRAM_API_KEY && String(process.env.DEEPGRAM_API_KEY).length >= 10),
    whisperLocalEnabled: process.env.WHISPER_LOCAL_ENABLED === 'true'
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const reg = ensureTranscriptionProvidersInit();
    const configuredProviders = [...reg.activeProviders];
    const openAiKeyForGpt = process.env.OPENAI_API_KEY || '';

    console.log('[provider-runtime]', {
      route: 'transcribe',
      traceId,
      activeProviders: configuredProviders,
      fallbackProviders: [...reg.fallbackProviders]
    });

    if (configuredProviders.length === 0) {
      console.error('TRANSCRIBE_ERROR: No transcription providers configured');
      return sendTranscriptError(res, {
        statusCode: 503,
        errorCode: 'TRANSCRIPTION_FAILED',
        message: userMessageForCode('TRANSCRIPTION_FAILED'),
        retryable: false,
        traceId,
        phase: 'transcription'
      });
    }

    const userEmail = requireSessionEmail(req, res);
    if (!userEmail) return;

    console.log('[transcript-start]', { traceId, requestId, email: userEmail });
    const languageHint =
      typeof req.body === 'object' && req.body && req.body.languageHint
        ? req.body.languageHint
        : null;
    const requestMetadata =
      typeof req.body === 'object' && req.body && req.body.metadata && typeof req.body.metadata === 'object'
        ? req.body.metadata
        : {};

    // Check if request is multipart/form-data (file upload) or JSON
    const contentType = req.headers['content-type'] || '';
    pipelineLog('INPUT_PARSE_START', { contentType });
    traceLog(traceId, 'parse', { multipart: contentType.includes('multipart') });
    let audioBuffer = null;
    let mimeType = 'audio/mpeg';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle direct file upload (multipart/form-data) using busboy
      console.log('TRANSCRIBE: Receiving file as multipart/form-data');
      pipelineLog('MULTIPART_RECEIVE_START');
      traceLog(traceId, 'parse', { mode: 'multipart' });
      
      const busboy = Busboy({ headers: req.headers });
      const chunks = [];
      let fileReceived = false;
      
      await new Promise((resolve, reject) => {
        busboy.on('file', (name, file, info) => {
          if (name === 'file') {
            fileReceived = true;
            const { filename, encoding, mimeType: fileMimeType } = info;
            console.log(`TRANSCRIBE: Receiving file: ${filename}, type: ${fileMimeType}`);
            mimeType = fileMimeType || 'audio/mpeg';
            
            file.on('data', (data) => {
              chunks.push(data);
            });
            
            file.on('end', () => {
              console.log('TRANSCRIBE: File upload complete');
            });
          } else {
            // Ignore other fields
            file.resume();
          }
        });
        
        busboy.on('finish', () => {
          if (fileReceived && chunks.length > 0) {
            audioBuffer = Buffer.concat(chunks);
            console.log(`TRANSCRIBE: Received file via multipart, size: ${audioBuffer.length} bytes, type: ${mimeType}`);
            resolve();
          } else {
            reject(new Error('No file received in multipart request'));
          }
        });
        
        busboy.on('error', (err) => {
          console.error('TRANSCRIBE: Busboy error:', err);
          reject(err);
        });
        
        req.pipe(busboy);
      });
      
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'No audio file provided in multipart request', requestId });
      }
      
    } else {
      // Handle JSON request (audioUrl or videoId)
      const { audioUrl, videoId } = req.body;

      if (!audioUrl && !videoId) {
        return res.status(400).json({ error: 'audioUrl, videoId, or file is required', requestId });
      }
      
      if (videoId) {
        // TODO: Implement YouTube audio extraction
        throw new Error('YouTube extraction not implemented yet');
      } else if (audioUrl) {
        // Handle data URL or regular URL
        if (audioUrl.startsWith('data:')) {
          // Extract base64 data from data URL
          const base64Match = audioUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match) {
            mimeType = base64Match[1];
            const base64Data = base64Match[2];
            audioBuffer = Buffer.from(base64Data, 'base64');
          } else {
            throw new Error('Invalid data URL format');
          }
        } else {
          // Download audio from URL
          const audioResponse = await fetch(audioUrl);
          if (!audioResponse.ok) {
            throw new Error(`Failed to download audio: ${audioResponse.statusText}`);
          }
          // Use arrayBuffer() for node-fetch v3 compatibility
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuffer);
          traceLog(traceId, 'audio-download', { bytes: audioBuffer.length, remoteUrl: true });
        }
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }
    pipelineLog('INPUT_READY', { bytes: audioBuffer.length, mimeType });
    traceLog(traceId, 'normalize', { bytes: audioBuffer.length, mimeType });
    console.log('[transcript-download]', { traceId, bytes: audioBuffer.length, mimeType });
    transcribeDebug(traceId, { phase: 'input_ready', bytes: audioBuffer.length, mimeType });

    const cacheUrl =
      requestMetadata.sourceUrl ||
      requestMetadata.youtubeUrl ||
      (typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : null);
    let transcriptFromCache = null;
    if (!isAsrPipelineV2() && cacheUrl && typeof cacheUrl === 'string' && !cacheUrl.startsWith('data:')) {
      const cached = getCachedExtraction(cacheUrl, traceId);
      if (cached?.transcript?.text) {
        transcriptFromCache = cached.transcript;
        transcribeDebug(traceId, { phase: 'cache_hit', normalizedUrl: cached.key });
      }
    }

    const preMinutes = estimateTranscriptionMinutesFromBytes(audioBuffer.length);

    console.log(`TRANSCRIBE: Processing audio file, size: ${audioBuffer.length} bytes, type: ${mimeType}`);
    console.log('=== TRANSCRIBE V4.0: NO OpenAI SDK - Using node-fetch directly ===');

    // Determine file extension from mime type
    let extension = 'mp3';
    if (mimeType.includes('wav')) extension = 'wav';
    else if (mimeType.includes('m4a')) extension = 'm4a';
    else if (mimeType.includes('ogg')) extension = 'ogg';
    else if (mimeType.includes('webm')) extension = 'webm';

    let preTranscription = null;
    let hintResolution = { languageHint: languageHint || null, source: 'client', suppressed: false };
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
        clientHint: languageHint,
        preTranscription
      });
      if (preTranscription?.language) {
        console.log('[pre-transcription-language]', {
          traceId,
          detectedLanguage: preTranscription.language,
          whisperLanguageHint: hintResolution.languageHint,
          hintSource: hintResolution.source,
          hintSuppressed: hintResolution.suppressed,
          providerAgreement: preTranscription.providerAgreement,
          languageConfidence: preTranscription.languageConfidence
        });
      }
    }
    const effectiveLanguageHint = hintResolution.languageHint;

    console.log(
      isAsrPipelineV2()
        ? 'TRANSCRIBE: Starting ASR V2 (Groq → OpenAI, raw output)…'
        : 'TRANSCRIBE: Starting transcription router (V1)…'
    );

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

    /** @type {{ text: string, segments: unknown[], language: string }} */
    let transcript;
    let transcriptionDurationMs = 0;

    try {
      if (transcriptFromCache) {
        transcript = transcriptFromCache;
        traceLog(traceId, 'transcription', { phase: 'cache_transcribe_skip', chars: transcript.text?.length || 0 });
      } else {
        const transcribeStartedAt = Date.now();
        transcript = await runQueuedTranscribe({
          userEmail,
          traceId,
          durationSec: requestMetadata.duration || requestMetadata.durationSeconds || null,
          dedupeKey: cacheUrl ? dedupeKeyForUrl(cacheUrl) : null,
          fn: async () => {
            if (audioBuffer.length > 25 * 1024 * 1024) {
              console.log(`TRANSCRIBE: File is ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB, using chunk processor`);
              const chunkResult = await transcribeLargeFile(audioBuffer, mimeType, extension, transcribeOne);
              transcribeDebug(traceId, { phase: 'chunk_complete', chars: chunkResult.text?.length || 0 });
              return {
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
              };
            }
            const single = await transcribeOne(audioBuffer, mimeType, extension);
            pipelineLog('TRANSCRIPTION_ROUTER_OK', {
              mimeType,
              bytes: audioBuffer.length,
              language: single?.language || null
            });
            traceLog(traceId, 'transcription', {
              phase: 'single_transcribe_ok',
              segmentCount: single?.segments?.length ?? 0
            });
            return single;
          }
        });
        transcriptionDurationMs = Date.now() - transcribeStartedAt;
      }
    } catch (routerErr) {
      console.error('TRANSCRIBE: Transcription router error:', routerErr);
      traceLog(traceId, 'failed', {
        phase: 'transcription',
        name: routerErr?.name,
        message: routerErr?.message
      });

      if (routerErr?.name === 'TranscriptionProviderError') {
        const pe = routerErr;
        const retry = pe.code !== 'INVALID_AUDIO';
        return sendTranscriptError(res, {
          statusCode: pe.code === 'INVALID_AUDIO' ? 400 : 503,
          errorCode: pe.code || 'TRANSCRIPTION_FAILED',
          message: userMessageForCode(pe.code) || userMessageForCode('TRANSCRIPTION_FAILED'),
          retryable: retry && retryableForCode(pe.code || 'TRANSCRIPTION_FAILED'),
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
        return sendTranscriptError(res, {
          statusCode: 503,
          errorCode: 'TRANSCRIPTION_FAILED',
          message: messageForAllProvidersFailed(routerErr, reg),
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

      return sendTranscriptError(res, {
        statusCode: 500,
        errorCode: 'PROVIDER_ERROR',
        message: userMessageForCode('PROVIDER_ERROR'),
        retryable: true,
        traceId,
        phase: 'transcription'
      });
    }

    /** @type {object|null} */
    let accentRetranscribeMeta = null;
    if (
      !isAsrPipelineV2() &&
      !transcriptFromCache &&
      audioBuffer.length <= 25 * 1024 * 1024 &&
      shouldAttemptAccentEnglishRetranscribe(transcript, hintResolution, preTranscription)
    ) {
      console.log('[accent-english-retranscribe]', {
        traceId,
        providerLanguage: transcript.language,
        suspectedAccent: hintResolution.suspectedAccent || null
      });
      try {
        const accentRetryStartedAt = Date.now();
        const englishRetry = await transcribeOne(audioBuffer, mimeType, extension, 'en');
        const picked = pickAccentRetranscribeWinner(transcript, englishRetry, preTranscription);
        accentRetranscribeMeta = {
          attempted: true,
          applied: Boolean(picked.usedRetry),
          reason: picked.reason || null,
          fromLanguage: picked.fromLanguage || null
        };
        transcriptionDurationMs += Date.now() - accentRetryStartedAt;
        if (picked.usedRetry) {
          console.log('[accent-english-retranscribe-applied]', {
            traceId,
            from: picked.fromLanguage,
            reason: picked.reason
          });
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

    console.log('TRANSCRIBE: Success, text length:', transcript.text?.length || 0);
    console.log('TRANSCRIBE: Raw segments count:', transcript.segments?.length || 0);

    const finalized = await finalizeAsrPipelineOutput({
      transcript,
      traceId,
      openAiKeyForGpt,
      preTranscription,
      fetch,
      audioBuffer,
      mimeType,
      extension
    });

    const correctedText = finalized.text;
    const timelineSegments = finalized.segments;
    const whisperLeadingOffsetSec = finalized.whisperLeadingOffsetSec;

    console.log('[asr-pipeline]', {
      traceId,
      pipeline: finalized.asrPipeline,
      segmentCount: timelineSegments.length,
      provider: finalized.provider,
      model: finalized.model
    });

    const billedMinutes = billingMinutesFromWhisperSegments(timelineSegments);
    const sourceUrl =
      typeof req.body === 'object' && req.body && typeof req.body.audioUrl === 'string'
        ? req.body.audioUrl
        : '';
    const guessedPlatform = sourceUrl.includes('youtube')
      ? 'youtube'
      : sourceUrl.includes('instagram')
        ? 'instagram'
        : sourceUrl.includes('tiktok')
          ? 'tiktok'
          : sourceUrl
            ? 'url'
            : 'upload';
    console.log('[quota-state]', {
      requestId,
      email: userEmail,
      billedMinutes,
      preMinutes,
      platform: requestMetadata.platform || guessedPlatform,
      phase: 'before_consume'
    });
    const consumed = await consumeTranscriptionUsage(userEmail, billedMinutes, {
      route: 'transcribe',
      precheckMinutes: preMinutes,
      processingSessionId: requestMetadata.processingSessionId || requestMetadata.sessionId || null,
      outputType: 'transcript',
      platform: requestMetadata.platform || guessedPlatform,
      title: requestMetadata.title || null,
      sourceUrl: requestMetadata.sourceUrl || sourceUrl || null,
      durationSeconds: timelineSegments.length
        ? Math.ceil(timelineSegments[timelineSegments.length - 1].end || 0)
        : null,
      ...requestMetadata
    });
    console.log('[transcript-provider]', { traceId, stage: 'whisper_complete', billedMinutes });
    traceLog(traceId, 'transcription', {
      phase: 'segments_ready',
      segmentCount: timelineSegments.length,
      billedMinutes
    });
    traceLog(traceId, 'srt', { phase: 'timestamps_ready', cues: timelineSegments.length });
    if (respondConsumeFailure(res, consumed, req)) {
      console.log('[transcript-failed]', { traceId, reason: 'quota_consume_denied', consumed });
      return;
    }

    if (
      !isAsrPipelineV2() &&
      cacheUrl &&
      !transcriptFromCache &&
      typeof cacheUrl === 'string' &&
      !cacheUrl.startsWith('data:')
    ) {
      setCachedExtraction(
        cacheUrl,
        {
          stage: 'full',
          transcript: {
            text: correctedText,
            segments: timelineSegments,
            language: finalized.resolvedLanguage || transcript.language || 'unknown'
          },
          subtitleBlocks: timelineSegments,
          metadata: requestMetadata,
          reusedAssets: ['transcript']
        },
        traceId
      );
    }

    const transcriptionRuntime = buildTranscriptionRuntime({
      providerId: finalized.provider || transcript.provider,
      transcriptionDurationMs,
      audioDurationSec: audioDurationFromSegments(
        timelineSegments,
        requestMetadata.duration ||
          requestMetadata.durationSeconds ||
          transcript.durationSeconds
      ),
      fromCache: Boolean(transcriptFromCache)
    });

    return sendTranscriptSuccess(res, traceId, {
      requestId,
      text: correctedText,
      language: finalized.resolvedLanguage,
      segments: timelineSegments,
      ...(finalized.words ? { words: finalized.words } : {}),
      ...(finalized.asrPipeline === 'v2'
        ? {
            asrPipeline: 'v2',
            model: finalized.model,
            ...(finalized.wordGapFill ? { wordGapFill: finalized.wordGapFill } : {})
          }
        : {}),
      transcriptionRuntime,
      ...(whisperLeadingOffsetSec > 0 ? { whisperLeadingOffsetSec } : {}),
      ...(finalized.whisperTimingForensics ? { whisperTimingForensics: finalized.whisperTimingForensics } : {}),
      ...(finalized.languageDetection ? { languageDetection: finalized.languageDetection } : {}),
      ...(finalized.subtitleIntegrity ? { subtitleIntegrity: finalized.subtitleIntegrity } : {})
    });
  } catch (err) {
    traceLog(traceId, 'failed', {
      message: String(err?.message || err).slice(0, 240),
      name: err?.name,
      code: err?.code
    });
    console.error('TRANSCRIBE_ERROR:', {
      traceId,
      message: err?.message,
      name: err?.name,
      code: err?.code
    });

    if (err?.name === 'AllProvidersFailedError') {
      const reg = getTranscriptionProviderRegistry();
      return sendTranscriptError(res, {
        statusCode: 503,
        errorCode: 'TRANSCRIPTION_FAILED',
        message: messageForAllProvidersFailed(err, reg),
        retryable: true,
        traceId,
        phase: 'transcription',
        providerDebug: {
          attemptedProviders: err.attemptedProviders || [],
          lastProvider: err.lastProviderId || null,
          lastError: String(err.lastError?.message || '').slice(0, 500),
          activeProviders: [...reg.activeProviders],
          fallbackProviders: [...reg.fallbackProviders]
        }
      });
    }

    if (err?.name === 'TranscriptionProviderError') {
      const pe = err;
      return sendTranscriptError(res, {
        statusCode: pe.code === 'INVALID_AUDIO' ? 400 : 503,
        errorCode: pe.code || 'TRANSCRIPTION_FAILED',
        message: userMessageForCode(pe.code) || userMessageForCode('TRANSCRIPTION_FAILED'),
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

    const isConnectionError =
      err?.code === 'ECONNRESET' ||
      err?.cause?.code === 'ECONNRESET' ||
      err?.message?.includes('ECONNRESET') ||
      err?.message?.includes('Connection error') ||
      err?.message?.includes('timeout');

    if (isConnectionError || /timed out|timeout/i.test(String(err?.message || ''))) {
      logProviderTimeout('openai', { traceId, kind: 'connection_or_timeout' });
    }

    const legacyType = err?.name === 'AuthError' ? 'OPENAI_ERROR' : isConnectionError ? 'CONNECTION_ERROR' : 'OPENAI_ERROR';
    const errorCode = mapToTranscriptErrorCode(legacyType, { message: err?.message });
    const statusCode = err?.status || err?.response?.status || (isConnectionError ? 503 : 500);

    const fallbackMsg = userMessageForCode(errorCode);
    const detail = String(err?.message || '').trim();
    let message = fallbackMsg;
    if (detail && detail !== fallbackMsg && detail.length < 900) {
      message = `${fallbackMsg} — ${detail}`;
    }

    return sendTranscriptErrorFromLegacy(res, {
      statusCode,
      legacyCode: legacyType,
      message,
      traceId,
      stage: 'transcription',
      retryable: retryableForCode(errorCode)
    });
  }
}

