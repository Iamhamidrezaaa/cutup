// API endpoint for uploading and transcribing audio files
// Supports sync POST (legacy) and async POST + GET status (avoids proxy timeouts).

import { handleCORS, setCORSHeaders } from './cors.js';
import fetchModule from 'node-fetch';
import Busboy from 'busboy';
import {
  requireSessionEmail,
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
import { ensureTranscriptionProvidersInit } from './transcription/init.js';
import { prepareUploadBufferForTranscription } from './upload-media-prep.js';
import {
  createUploadJob,
  patchUploadJob,
  getUploadJob,
  completeUploadJob,
  failUploadJob
} from './upload-jobs.js';
import { processUploadBuffer, UploadProcessError, uploadErrorFromUnknown } from './upload-process.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024;

function wantsAsyncUpload(req) {
  const q = req.query?.async;
  const h = req.headers?.['x-cutup-async'] || req.headers?.['X-Cutup-Async'];
  return q === '1' || q === 'true' || h === '1' || h === 'true';
}

async function receiveUploadMultipart(req) {
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
        filename = info.filename || 'audio.mp3';
        mimeType = info.mimeType || 'audio/mpeg';

        file.on('data', (data) => {
          totalSize += data.length;
          if (totalSize > MAX_FILE_SIZE) {
            file.destroy();
            reject(new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`));
            return;
          }
          chunks.push(data);
        });

        file.on('error', reject);
      } else {
        file.resume();
      }
    });

    busboy.on('finish', () => {
      if (fileReceived && chunks.length > 0) resolve();
      else reject(new Error('No file received in multipart request'));
    });

    busboy.on('error', reject);
    req.pipe(busboy);
  });

  return {
    buffer: Buffer.concat(chunks),
    mimeType,
    filename,
    totalSize
  };
}

function sendUploadProcessError(res, err, traceId) {
  const e = err instanceof UploadProcessError ? err : uploadErrorFromUnknown(err, traceId);
  return sendTranscriptError(res, {
    statusCode: e.statusCode,
    errorCode: e.errorCode,
    message: e.message,
    retryable: e.retryable,
    traceId: e.traceId || traceId,
    phase: e.phase,
    providerDebug: e.providerDebug || undefined
  });
}

async function runUploadJob(jobId, ctx) {
  try {
    const { responseData } = await processUploadBuffer({
      ...ctx,
      onPhase: ({ phase, progress }) => patchUploadJob(jobId, { phase, progress })
    });
    completeUploadJob(jobId, responseData);
    console.log('[upload-job-complete]', { jobId, traceId: ctx.traceId });
  } catch (err) {
    console.error('[upload-job-failed]', { jobId, traceId: ctx.traceId, message: err?.message });
    const e = err instanceof UploadProcessError ? err : uploadErrorFromUnknown(err, ctx.traceId);
    failUploadJob(jobId, e);
  }
}

async function handleUploadStatus(req, res, userEmail) {
  const jobId = String(req.query?.jobId || '').trim();
  if (!jobId) {
    setCORSHeaders(res);
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_REQUEST',
      message: 'jobId is required'
    });
  }

  const job = getUploadJob(jobId);
  if (!job) {
    setCORSHeaders(res);
    return res.status(404).json({
      success: false,
      errorCode: 'JOB_NOT_FOUND',
      message: 'Upload job not found or expired. Please upload again.',
      retryable: true
    });
  }

  if (job.userEmail !== userEmail) {
    setCORSHeaders(res);
    return res.status(403).json({
      success: false,
      errorCode: 'SESSION_EXPIRED',
      message: userMessageForCode('SESSION_EXPIRED'),
      retryable: false
    });
  }

  setCORSHeaders(res);
  if (job.status === 'completed') {
    return res.status(200).json({
      success: true,
      async: true,
      jobId: job.id,
      traceId: job.traceId,
      status: 'completed',
      phase: job.phase,
      progress: 100,
      result: job.result
    });
  }

  if (job.status === 'failed') {
    return res.status(200).json({
      success: false,
      async: true,
      jobId: job.id,
      traceId: job.traceId,
      status: 'failed',
      phase: job.phase,
      progress: job.progress,
      ...job.error
    });
  }

  return res.status(200).json({
    success: true,
    async: true,
    jobId: job.id,
    traceId: job.traceId,
    status: 'processing',
    phase: job.phase,
    progress: job.progress
  });
}

export default async function handler(req, res) {
  console.log('=== UPLOAD ENDPOINT CALLED ===');
  console.log('UPLOAD: Method:', req.method);

  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  const userEmail = requireSessionEmail(req, res);
  if (!userEmail) return;

  if (req.method === 'GET') {
    const action = String(req.query?.action || '').trim();
    if (action === 'status') return handleUploadStatus(req, res, userEmail);
    setCORSHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'POST') {
    setCORSHeaders(res);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const traceId = resolveTraceId(req, requestId);
  const useAsync = wantsAsyncUpload(req);

  try {
    console.log('[transcript-start]', { traceId, email: userEmail, route: 'upload', async: useAsync });

    const reg = ensureTranscriptionProvidersInit();
    if (reg.activeProviders.length === 0) {
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

    let fetch;
    try {
      fetch = fetchModule.default || fetchModule;
      if (typeof fetch !== 'function') throw new Error(`fetch is not a function`);
    } catch (err) {
      setCORSHeaders(res);
      return res.status(500).json({
        error: 'INIT_ERROR',
        details: `Failed to initialize fetch: ${err.message}`
      });
    }

    const { buffer, mimeType, filename, totalSize } = await receiveUploadMultipart(req);

    if (totalSize > MAX_FILE_SIZE) {
      setCORSHeaders(res);
      return res.status(413).json({
        error: 'FILE_TOO_LARGE',
        message: `File is too large (${(totalSize / 1024 / 1024).toFixed(2)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      });
    }

    let audioBuffer = buffer;
    const prepared = await prepareUploadBufferForTranscription(audioBuffer, mimeType, filename, traceId);
    audioBuffer = prepared.buffer;
    const preparedMime = prepared.mimeType;
    const extension = prepared.extension;

    const processCtx = {
      userEmail,
      traceId,
      audioBuffer,
      mimeType: preparedMime,
      extension,
      filename,
      fetch
    };

    if (useAsync) {
      const job = createUploadJob({ traceId, userEmail });
      patchUploadJob(job.id, { phase: 'transcribing', progress: 18 });
      setImmediate(() => {
        void runUploadJob(job.id, processCtx);
      });
      setCORSHeaders(res);
      return res.status(202).json({
        success: true,
        async: true,
        jobId: job.id,
        traceId,
        status: 'processing',
        phase: 'transcribing',
        progress: 18
      });
    }

    const { responseData } = await processUploadBuffer(processCtx);
    return sendTranscriptSuccess(res, traceId, responseData);
  } catch (error) {
    if (error instanceof UploadProcessError && error.consumeDenied) {
      const fakeConsume = { ok: false, reason: error.consumeReason };
      if (respondConsumeFailure(res, fakeConsume, req)) return;
    }
    if (error instanceof UploadProcessError) {
      return sendUploadProcessError(res, error, traceId);
    }
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
