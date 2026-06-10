// API endpoint for uploading and transcribing audio files
// This endpoint receives audio files, transcribes them directly, and returns the result
// This avoids the 4.5MB limit by processing the file in the same endpoint

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
  sendTranscriptSuccess,
  sendTranscriptError,
  sendTranscriptErrorFromLegacy,
  mapToTranscriptErrorCode,
  userMessageForCode,
  retryableForCode
} from './transcript-errors.js';
import { transcribeAudioPayload, messageForAllProvidersFailed } from './transcription/transcription-router.js';
import { isAsrPipelineV2, transcribeForPipeline } from './transcription/transcription-v2.js';
import { finalizeAsrPipelineOutput } from './transcription/asr-pipeline-finalize.js';
import { ensureTranscriptionProvidersInit, getTranscriptionProviderRegistry } from './transcription/init.js';
import { runQueuedTranscribe } from './infrastructure/guards.js';
import { transcribeDebug } from './infrastructure/observability.js';
import { prepareUploadBufferForTranscription } from './upload-media-prep.js';
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

export default async function handler(req, res) {
  // Log immediately to verify this endpoint is being called
  console.log('=== UPLOAD ENDPOINT CALLED ===');
  console.log('UPLOAD: Method:', req.method);
  console.log('UPLOAD: Content-Type:', req.headers['content-type']);
  
  // Handle CORS - باید اولین کاری باشد
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return; // OPTIONS request handled

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userEmail = requireSessionEmail(req, res);
    if (!userEmail) return;

    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const traceId = resolveTraceId(req, requestId);
    console.log('[transcript-start]', { traceId, email: userEmail, route: 'upload' });

    const reg = ensureTranscriptionProvidersInit();
    const configuredProviders = [...reg.activeProviders];
    console.log('[provider-runtime]', {
      route: 'upload',
      traceId,
      activeProviders: configuredProviders,
      fallbackProviders: [...reg.fallbackProviders]
    });

    if (configuredProviders.length === 0) {
      console.error('UPLOAD_ERROR: No transcription providers configured');
      setCORSHeaders(res);
      return sendTranscriptError(res, {
        statusCode: 503,
        errorCode: 'TRANSCRIPTION_FAILED',
        message: userMessageForCode('TRANSCRIPTION_FAILED'),
        retryable: false,
        traceId,
        phase: 'transcription'
      });
    }

    // Initialize fetch
    let fetch;
    try {
      fetch = fetchModule.default || fetchModule;
      if (typeof fetch !== 'function') {
        throw new Error(`fetch is not a function, got: ${typeof fetch}`);
      }
    } catch (err) {
      console.error("UPLOAD_ERROR: Failed to initialize fetch:", err);
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INIT_ERROR', 
        details: `Failed to initialize fetch: ${err.message}`
      });
    }

    // Check file size limit before processing
    // Since we're on our own server now, we can handle larger files
    // Whisper API has 25MB limit, but we'll chunk larger files
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB (will be chunked if > 25MB)
    
    // Receive file using busboy
    console.log('UPLOAD: Receiving file as multipart/form-data');
    
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE } });
    const chunks = [];
    let fileReceived = false;
    let mimeType = 'audio/mpeg';
    let filename = 'audio.mp3';
    let totalSize = 0;
    
    await new Promise((resolve, reject) => {
      busboy.on('file', (name, file, info) => {
        if (name === 'file') {
          fileReceived = true;
          const { filename: fileFilename, encoding, mimeType: fileMimeType } = info;
          console.log(`UPLOAD: Receiving file: ${fileFilename}, type: ${fileMimeType}`);
          filename = fileFilename || 'audio.mp3';
          mimeType = fileMimeType || 'audio/mpeg';
          
          file.on('data', (data) => {
            totalSize += data.length;
            if (totalSize > MAX_FILE_SIZE) {
              file.destroy();
              reject(new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`));
              return;
            }
            chunks.push(data);
          });
          
          file.on('end', () => {
            console.log('UPLOAD: File upload complete');
          });
          
          file.on('error', (err) => {
            console.error('UPLOAD: File stream error:', err);
            reject(err);
          });
        } else {
          file.resume();
        }
      });
      
      busboy.on('finish', () => {
        if (fileReceived && chunks.length > 0) {
          console.log(`UPLOAD: File received, size: ${totalSize} bytes`);
          resolve();
        } else {
          reject(new Error('No file received in multipart request'));
        }
      });
      
      busboy.on('error', (err) => {
        console.error('UPLOAD: Busboy error:', err);
        reject(err);
      });
      
      req.pipe(busboy);
    });
    
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    
    if (totalSize > MAX_FILE_SIZE) {
      setCORSHeaders(res);
      return res.status(413).json({ 
        error: 'FILE_TOO_LARGE',
        message: `فایل خیلی بزرگ است (${(totalSize / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${MAX_FILE_SIZE / 1024 / 1024}MB است.`,
        details: `Maximum file size is ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }
    
    // If file is larger than 25MB, we'll need to chunk it
    if (totalSize > 25 * 1024 * 1024) {
      console.log(`UPLOAD: File is ${(totalSize / 1024 / 1024).toFixed(2)}MB, will be processed in chunks`);
    }
    
    let audioBuffer = Buffer.concat(chunks);
    console.log(`UPLOAD: Processing upload, size: ${audioBuffer.length} bytes, type: ${mimeType}`);

    const prepared = await prepareUploadBufferForTranscription(audioBuffer, mimeType, filename, traceId);
    audioBuffer = prepared.buffer;
    mimeType = prepared.mimeType;
    const extension = prepared.extension;
    if (prepared.extractedFromVideo) {
      console.log('UPLOAD: Audio track extracted from video before transcription');
    }

    const preMinutes = estimateTranscriptionMinutesFromBytes(audioBuffer.length);
    console.log('[transcript-download]', { traceId, bytes: audioBuffer.length, preMinutes });

    let transcript;
    let transcriptionDurationMs = 0;
    transcribeDebug(traceId, { phase: 'input_ready', bytes: audioBuffer.length, route: 'upload' });

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

    try {
      const transcribeStartedAt = Date.now();
      transcript = await runQueuedTranscribe({
        userEmail,
        traceId,
        durationSec: null,
        fn: async () => {
          if (audioBuffer.length > 25 * 1024 * 1024) {
            console.log('UPLOAD: File is larger than 25MB, using chunk processor + router...');
            const chunkResult = await transcribeLargeFile(audioBuffer, mimeType, extension, transcribeOne);
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
          console.log('UPLOAD: Transcription router (single request)...');
          return transcribeOne(audioBuffer, mimeType, extension);
        }
      });
      transcriptionDurationMs = Date.now() - transcribeStartedAt;
    } catch (routerErr) {
      console.error('UPLOAD: Transcription router error:', routerErr);
      setCORSHeaders(res);
      if (routerErr?.name === 'TranscriptionProviderError') {
        const pe = routerErr;
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

    // Get detected language from transcript
    const detectedLanguage = transcript.language || 'unknown';
    console.log('UPLOAD: Detected language:', detectedLanguage);
    console.log('UPLOAD: Transcript text preview:', transcript.text?.substring(0, 100));
    // First-pass Whisper only (no forced language=fa retry).
    console.log('UPLOAD: Using first-pass Whisper transcript only, language:', detectedLanguage);
    
    // Log full transcript for debugging
    console.log('UPLOAD: Whisper response:', {
      hasText: !!transcript.text,
      textLength: transcript.text?.length || 0,
      hasSegments: !!transcript.segments,
      segmentsCount: transcript.segments?.length || 0,
      language: transcript.language,
      fullResponse: JSON.stringify(transcript).substring(0, 200)
    });
    
    // Validate transcript response
    if (!transcript) {
      console.error('UPLOAD: No transcript response received');
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INVALID_RESPONSE',
        message: 'Whisper API returned no response',
        details: 'Transcript is missing'
      });
    }
    
    if (!transcript.text || transcript.text.trim().length === 0) {
      console.error('UPLOAD: Invalid transcript response - no text:', transcript);
      setCORSHeaders(res);
      return res.status(500).json({ 
        error: 'INVALID_RESPONSE',
        message: 'Whisper API returned empty text',
        details: 'Transcript text is missing or empty',
        transcript: transcript
      });
    }
    
    console.log('UPLOAD: Whisper success, text length:', transcript.text.length);
    console.log('UPLOAD: Segments count:', transcript.segments?.length || 0);

    const finalized = await finalizeAsrPipelineOutput({
      transcript,
      traceId,
      preTranscription,
      fetch,
      audioBuffer,
      mimeType,
      extension
    });

    let correctedText = finalized.text || '';
    const timelineSegments = finalized.segments || [];

    console.log('[asr-pipeline]', {
      traceId,
      pipeline: finalized.asrPipeline,
      segmentCount: timelineSegments.length,
      provider: finalized.provider,
      model: finalized.model
    });

    if (!correctedText || correctedText.trim().length === 0) {
      console.error('UPLOAD: No text after all processing. Checking original transcript...');
      console.error('UPLOAD: Original transcript.text exists:', !!transcript.text);
      console.error('UPLOAD: Original transcript.text length:', transcript.text?.length || 0);
      
      // Last resort - use original transcript text
      correctedText = transcript.text || '';
      
      if (!correctedText || correctedText.trim().length === 0) {
        console.error('UPLOAD: No text available at all. Transcript object:', JSON.stringify(transcript).substring(0, 500));
        setCORSHeaders(res);
        return res.status(500).json({ 
          error: 'NO_TEXT',
          message: 'No text was transcribed from the audio file',
          details: 'The audio file may be empty, corrupted, or contain no speech',
          transcript: transcript
        });
      }
    }
    
    console.log('UPLOAD: Final response preparation - text length:', correctedText.length, 'segments:', timelineSegments.length);
    console.log('UPLOAD: Text preview:', correctedText.substring(0, 100));
    
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
      ...(finalized.asrPipeline === 'v2' ? { asrPipeline: 'v2', model: finalized.model } : {}),
      transcriptionRuntime,
      ...(finalized.languageDetection ? { languageDetection: finalized.languageDetection } : {}),
      ...(finalized.subtitleIntegrity ? { subtitleIntegrity: finalized.subtitleIntegrity } : {})
    };
    
    console.log('UPLOAD: Sending response with text length:', responseData.text.length);
    console.log('UPLOAD: Response data keys:', Object.keys(responseData));
    console.log('UPLOAD: Response preview:', JSON.stringify(responseData).substring(0, 200));

    const billedMinutes = billingMinutesFromWhisperSegments(timelineSegments);
    console.log('[transcript-provider]', { traceId, billedMinutes, phase: 'before_consume' });
    const consumed = await consumeTranscriptionUsage(userEmail, billedMinutes, {
      route: 'upload',
      filename: filename || 'audio',
      precheckMinutes: preMinutes,
      outputType: 'transcript',
      platform: 'upload',
      title: filename || 'Uploaded file',
      sourceUrl: 'upload://local-file',
      durationSeconds: timelineSegments.length ? Math.ceil(timelineSegments[timelineSegments.length - 1].end || 0) : null
    });
    if (respondConsumeFailure(res, consumed, req)) {
      console.log('[transcript-failed]', { traceId, reason: 'quota_consume_denied', consumed });
      return;
    }

    return sendTranscriptSuccess(res, traceId, responseData);

  } catch (error) {
    const traceId = resolveTraceId(req);
    console.error('UPLOAD_ERROR:', { traceId, message: error?.message });
    const errorCode = mapToTranscriptErrorCode('UPLOAD_ERROR', { message: error?.message });
    return sendTranscriptErrorFromLegacy(res, {
      statusCode: 500,
      legacyCode: 'UPLOAD_ERROR',
      message: userMessageForCode(errorCode),
      traceId,
      stage: 'upload',
      retryable: retryableForCode(errorCode)
    });
  }
}

