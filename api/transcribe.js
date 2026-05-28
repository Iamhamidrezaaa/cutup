// API endpoint for transcribing audio using Whisper
// Deploy this to Vercel as a serverless function
// VERSION 4.1 - Using node-fetch directly to avoid ECONNRESET - NO client variable

import { handleCORS, setCORSHeaders } from './cors.js';
import fetchModule from 'node-fetch';
import OpenAI from 'openai';
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
    if (cacheUrl && typeof cacheUrl === 'string' && !cacheUrl.startsWith('data:')) {
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

    // Multi-provider transcription router (OpenAI → Groq → Deepgram → local scaffold)
    console.log('TRANSCRIBE: Starting transcription router…');

    const transcribeOne = async (buf, mt, ext) =>
      transcribeAudioPayload({
        fetch,
        traceId,
        audioBuffer: buf,
        mimeType: mt,
        extension: ext,
        languageHint
      });

    /** @type {{ text: string, segments: unknown[], language: string }} */
    let transcript;

    try {
      if (transcriptFromCache) {
        transcript = transcriptFromCache;
        traceLog(traceId, 'transcription', { phase: 'cache_transcribe_skip', chars: transcript.text?.length || 0 });
      } else {
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
                language: chunkResult.language
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

    console.log('TRANSCRIBE: Success, text length:', transcript.text?.length || 0);
    console.log('TRANSCRIBE V4.0: Segments count:', transcript.segments?.length || 0);

    // GPT "correction" was Persian-only prompts but ran for all languages → wrong-language output.
    // Only run for confirmed Persian (Whisper lang + Arabic script ratio).
    const whisperLang = String(transcript.language || '').toLowerCase();
    const isWhisperPersian = whisperLang === 'fa' || whisperLang === 'per' || whisperLang === 'persian' || whisperLang === 'fas';
    const totalLen = (transcript.text || '').length;
    const scriptChars = (transcript.text || '').match(/[\u0600-\u06FF]/g)?.length || 0;
    const scriptRatio = totalLen > 0 ? scriptChars / totalLen : 0;
    const shouldRunPersianGptCorrection = isWhisperPersian && scriptRatio >= 0.25;

    let correctedText = transcript.text;
    let correctedSegments = transcript.segments || [];
    
    try {
      if (!shouldRunPersianGptCorrection) {
        console.log('TRANSCRIBE: Skipping GPT correction (non-Persian or low Arabic-script ratio)');
      } else if (openAiKeyForGpt.length >= 10) {
      console.log('TRANSCRIBE: Starting Persian-only GPT correction...');
        const corrected = await correctTranscriptionWithGPT(transcript.text, openAiKeyForGpt);
      correctedText = corrected.text;
      
      // Update segment texts with corrected text
      // Smart mapping: try to preserve timing while updating text
      if (correctedSegments.length > 0 && correctedSegments.length > 0) {
        const originalText = transcript.text;
        
        // Strategy: Split corrected text proportionally based on segment durations
        // This preserves timing while updating text content
        const totalDuration = correctedSegments[correctedSegments.length - 1].end || 0;
          const correctedWords = correctedText.split(/\s+/).filter((w) => w.trim().length > 0);
          const originalWords = originalText.split(/\s+/).filter((w) => w.trim().length > 0);
        
        // If word count is similar, map word by word
        if (Math.abs(correctedWords.length - originalWords.length) / Math.max(originalWords.length, 1) < 0.5) {
          let wordIndex = 0;
          correctedSegments = correctedSegments.map((segment, segIndex) => {
              const segmentWords = segment.text.trim().split(/\s+/).filter((w) => w.trim().length > 0);
            const segmentWordCount = segmentWords.length;
            
            const wordsForSegment = correctedWords.slice(wordIndex, wordIndex + segmentWordCount);
            wordIndex += segmentWordCount;
            
              const newText =
                wordsForSegment.length > 0 ? wordsForSegment.join(' ').trim() : segment.text.trim();
            
            return {
              ...segment,
              text: newText || segment.text
            };
          });
        } else {
          let charIndex = 0;
          correctedSegments = correctedSegments.map((segment, segIndex) => {
            const segmentDuration = segment.end - segment.start;
              const segmentRatio =
                totalDuration > 0 ? segmentDuration / totalDuration : 1 / correctedSegments.length;
            const charsForSegment = Math.ceil(correctedText.length * segmentRatio);
            
            const segmentText = correctedText.substring(charIndex, charIndex + charsForSegment).trim();
            charIndex += charsForSegment;
            
            return {
              ...segment,
              text: segmentText || segment.text
            };
          });
        }
      }
      
      console.log('TRANSCRIBE: GPT correction completed');
      } else {
        console.log('TRANSCRIBE: Skipping GPT correction (OPENAI_API_KEY not configured for chat step)');
      }
    } catch (correctionError) {
      console.warn('TRANSCRIBE: GPT correction failed, using original transcription:', correctionError.message);
      // Continue with original transcription if correction fails
    }

    // Ensure segments are valid and properly formatted
    const validSegments = (correctedSegments || []).filter(s => 
      s && 
      typeof s.start === 'number' && 
      typeof s.end === 'number' && 
      s.start >= 0 && 
      s.end > s.start &&
      s.text && 
      s.text.trim().length > 0
    );
    
    // Log segment information for debugging
    console.log('TRANSCRIBE: Final segments count:', validSegments.length);
    if (validSegments.length > 0) {
      console.log('TRANSCRIBE: First segment:', {
        start: validSegments[0].start,
        end: validSegments[0].end,
        text: validSegments[0].text.substring(0, 50)
      });
      console.log('TRANSCRIBE: Last segment:', {
        start: validSegments[validSegments.length - 1].start,
        end: validSegments[validSegments.length - 1].end,
        text: validSegments[validSegments.length - 1].text.substring(0, 50)
      });
    }

    const billedMinutes = billingMinutesFromWhisperSegments(validSegments);
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
      durationSeconds: validSegments.length ? Math.ceil(validSegments[validSegments.length - 1].end || 0) : null,
      ...requestMetadata
    });
    console.log('[transcript-provider]', { traceId, stage: 'whisper_complete', billedMinutes });
    traceLog(traceId, 'transcription', { phase: 'segments_ready', segmentCount: validSegments.length, billedMinutes });
    traceLog(traceId, 'srt', { phase: 'timestamps_ready', cues: validSegments.length });
    if (respondConsumeFailure(res, consumed, req)) {
      console.log('[transcript-failed]', { traceId, reason: 'quota_consume_denied', consumed });
      return;
    }

    if (cacheUrl && !transcriptFromCache && typeof cacheUrl === 'string' && !cacheUrl.startsWith('data:')) {
      setCachedExtraction(
        cacheUrl,
        {
          stage: 'full',
          transcript: {
            text: correctedText,
            segments: validSegments,
            language: transcript.language || 'unknown'
          },
          subtitleBlocks: validSegments,
          metadata: requestMetadata,
          reusedAssets: ['transcript']
        },
        traceId
      );
    }

    return sendTranscriptSuccess(res, traceId, {
      requestId,
      text: correctedText,
      language: transcript.language || 'unknown',
      segments: validSegments
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

// Correct transcription using GPT for better accuracy
async function correctTranscriptionWithGPT(text, apiKey) {
  const client = new OpenAI({
    apiKey: apiKey
  });

  const systemPrompt = `شما یک متخصص تصحیح متن فارسی هستید که در تصحیح شعر، آهنگ و متن فارسی تخصص دارید. 
متن تبدیل شده از صوت را با دقت بالا تصحیح کنید. به خصوص:
- کلمات شعر و آهنگ فارسی
- نام‌های فارسی
- عبارات رایج فارسی
- حفظ ساختار و معنی متن

فقط اشتباهات را تصحیح کنید و ساختار کلی متن را حفظ کنید.`;

  const userPrompt = `متن زیر که از تبدیل صوت به متن (احتمالاً شعر یا آهنگ فارسی) به دست آمده را با دقت بالا تصحیح کنید.

متن اصلی:
${text}

لطفاً:
1. تمام کلمات اشتباه را درست کنید
2. ساختار شعر/آهنگ را حفظ کنید
3. معنی و مفهوم را حفظ کنید
4. فقط متن تصحیح شده را برگردانید، بدون توضیح اضافی

متن تصحیح شده:`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o', // Using more powerful model for better accuracy
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.0, // Zero temperature for maximum accuracy
      max_tokens: Math.min(text.length * 3, 8000) // More tokens for longer texts
    });

    const correctedText = completion.choices[0].message.content.trim();
    
    // Remove any markdown formatting if present
    const cleanText = correctedText.replace(/```[\s\S]*?```/g, '').trim();
    
    return {
      text: cleanText,
      segments: null // Will be updated in the main function
    };
  } catch (error) {
    console.error('CORRECTION_ERROR:', error);
    // If gpt-4o fails, try with gpt-4o-mini
    try {
      const fallbackCompletion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0,
        max_tokens: Math.min(text.length * 2, 4000)
      });
      
      const correctedText = fallbackCompletion.choices[0].message.content.trim();
      const cleanText = correctedText.replace(/```[\s\S]*?```/g, '').trim();
      
      return {
        text: cleanText,
        segments: null
      };
    } catch (fallbackError) {
      console.error('FALLBACK_CORRECTION_ERROR:', fallbackError);
      throw error;
    }
  }
}
