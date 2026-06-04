/**
 * 1-click viral subtitle video export — ASS burn-in via FFmpeg.
 *
 * POST   /api/export-video              — start render job (JSON or multipart)
 * GET    /api/export-video?action=status&jobId=
 * GET    /api/export-video?action=download&jobId=
 * GET    /api/export-video?action=preview&jobId=
 * POST   /api/export-video?action=cancel — body { jobId, session }
 */
import Busboy from 'busboy';
import { createReadStream, statSync } from 'fs';
import {
  streamGpuArtifact,
  purgeExpiredGpuArtifacts
} from './video-render/gpu-render-artifacts.js';
import { handleCORS, setCORSHeaders } from './cors.js';
import { requireSessionEmail, enforceQuota } from './processing-enforcement.js';
import { resolveTraceId } from './transcript-errors.js';
import { checkFfmpegHealth } from './media-tool-health.js';
import {
  createRenderJob,
  getJob,
  cancelJob,
  publicStatus,
  getQueueStats,
  isJobReady
} from './video-render/render-queue.js';
import { listStylePresets } from './video-render/style-presets.js';
import { decodeSubtitleTextEntities } from './subtitle-text-entities.js';
import { logSubtitleTextForensicStage } from './video-render/subtitle-text-forensics.js';
import { getQueueMetrics } from './infrastructure/guards.js';
import { extractionDebug } from './infrastructure/observability.js';

const MAX_UPLOAD_BYTES = Number(process.env.VIDEO_RENDER_MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_UPLOAD_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    let videoBuffer = null;
    let videoFilename = null;

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
    });

    busboy.on('field', (name, val) => {
      fields[name] = val;
    });

    busboy.on('file', (name, stream, info) => {
      if (name !== 'video') {
        stream.resume();
        return;
      }
      const chunks = [];
      let size = 0;
      videoFilename = info.filename || 'upload.mp4';
      stream.on('data', (d) => {
        size += d.length;
        if (size > MAX_UPLOAD_BYTES) {
          reject(new Error('Video file too large'));
          stream.resume();
          return;
        }
        chunks.push(d);
      });
      stream.on('end', () => {
        videoBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      resolve({ fields, videoBuffer, videoFilename });
    });
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function normalizeSegments(raw) {
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
      text: decodeSubtitleTextEntities(String(s.text).trim())
    }));
}

async function handleStart(req, res) {
  const traceId = resolveTraceId(req);
  const email = requireSessionEmail(req, res);
  if (!email) return;

  const allowed = await enforceQuota(res, email, 'srt', 0, req);
  if (!allowed) return;

  const ff = await checkFfmpegHealth();
  if (ff.status !== 'operational') {
    setCORSHeaders(res);
    return res.status(503).json({
      error: 'service_unavailable',
      code: 'FFMPEG_MISSING',
      message: 'Video rendering is temporarily unavailable (FFmpeg).',
      traceId
    });
  }

  const contentType = String(req.headers['content-type'] || '');
  let body = {};
  let videoBuffer = null;
  let videoFilename = null;

  if (contentType.includes('multipart/form-data')) {
    const parsed = await parseMultipart(req);
    body = parsed.fields;
    if (parsed.fields.exportDoc) {
      try {
        body.exportDoc = JSON.parse(parsed.fields.exportDoc);
      } catch {
        body.exportDoc = null;
      }
    }
    if (parsed.fields.segments) {
      try {
        body.segments = JSON.parse(parsed.fields.segments);
      } catch {
        body.segments = [];
      }
    }
    if (parsed.fields.captionForensics) {
      try {
        body.captionForensics = JSON.parse(parsed.fields.captionForensics);
      } catch {
        body.captionForensics = null;
      }
    }
    videoBuffer = parsed.videoBuffer;
    videoFilename = parsed.videoFilename;
  } else {
    body = req.body && typeof req.body === 'object' ? req.body : await parseJsonBody(req);
  }

  const sessionId = body.session || req.query?.session || req.headers['x-session-id'];
  const presetId = body.selectedPresetId || body.presetId || body.preset || null;
  const selectedVersion = String(body.selectedVersion || 'original');
  const quality = body.quality === 'hq' ? 'hq' : 'fast';
  const captionModeRaw = String(body.captionMode || body.qualityMode || 'viral').toLowerCase();
  const captionMode = ['accurate', 'clean', 'viral'].includes(captionModeRaw) ? captionModeRaw : 'viral';
  const styleModeRaw = String(body.styleMode || '').toLowerCase();
  const styleMode = ['safe', 'cinematic', 'aggressive'].includes(styleModeRaw) ? styleModeRaw : null;
  const sourceUrl = body.sourceUrl || body.url || null;
  const segments = normalizeSegments(body.segments);
  const exportDoc = body.exportDoc && body.exportDoc.format === 'cutup-style-v1' ? body.exportDoc : null;

  logSubtitleTextForensicStage(
    'render_export_request_segments',
    segments.map((seg, i) => ({
      id: `export-seg-${i}`,
      start: seg.start,
      end: seg.end,
      text: String(seg.text || '')
    })),
    { traceId, selectedVersion, captionMode }
  );

  if (!exportDoc && !segments.length) {
    setCORSHeaders(res);
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Provide segments or a cutup-style-v1 exportDoc.',
      traceId
    });
  }

  if (!sourceUrl && !videoBuffer) {
    setCORSHeaders(res);
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Provide sourceUrl or upload a video file.',
      traceId
    });
  }
  if (!presetId) {
    setCORSHeaders(res);
    return res.status(400).json({
      error: 'invalid_request',
      code: 'PRESET_NOT_APPLIED',
      message: 'PRESET_NOT_APPLIED: missing selected preset',
      traceId
    });
  }

  const firstExportCue = exportDoc?.cues?.[0];
  const firstSegment = segments[0];
  console.log('[render-payload]', {
    selectedPresetId: presetId,
    selectedVersion,
    renderQuality: quality,
    hasExportDoc: Boolean(exportDoc?.cues?.length),
    exportDocCueCount: exportDoc?.cues?.length || 0,
    segmentCount: segments.length,
    firstExportDocCue: firstExportCue
      ? {
          start: firstExportCue.start,
          end: firstExportCue.end,
          text: String(firstExportCue.text || '').slice(0, 100)
        }
      : null,
    firstSegment: firstSegment
      ? {
          start: firstSegment.start,
          end: firstSegment.end,
          text: String(firstSegment.text || '').slice(0, 100)
        }
      : null
  });

  extractionDebug(traceId, {
    phase: 'export_start',
    sourceUrl: sourceUrl || 'upload',
    presetId,
    quality
  });

  const captionForensics =
    body.captionForensics && typeof body.captionForensics === 'object' ? body.captionForensics : null;
  const selectedPresetFromUI =
    captionForensics?.selectedPresetFromUI ||
    body.selectedPresetId ||
    body.presetId ||
    body.preset ||
    null;

  console.log('[caption-forensics-preset-lineage]', {
    traceId,
    selectedPresetFromUI,
    presetReceivedByAPI: presetId
  });

  const result = createRenderJob({
    userEmail: email,
    sessionId,
    presetId,
    selectedVersion,
    quality,
    captionMode,
    styleMode,
    segments: segments.length ? segments : null,
    exportDoc,
    captionForensics: captionForensics
      ? {
          ...captionForensics,
          selectedPresetFromUI,
          presetReceivedByAPI: presetId
        }
      : {
          selectedPresetFromUI,
          presetReceivedByAPI: presetId
        },
    sourceUrl: sourceUrl && !String(sourceUrl).startsWith('upload://') ? sourceUrl : null,
    uploadBuffer: videoBuffer,
    uploadFilename: videoFilename,
    traceId
  });

  setCORSHeaders(res);
  return res.status(202).json({
    success: true,
    ...result,
    traceId,
    queue: getQueueStats(),
    infrastructure: getQueueMetrics()
  });
}

async function handleStatus(req, res, jobId, email) {
  const job = getJob(jobId);
  if (!job) {
    setCORSHeaders(res);
    return res.status(404).json({ error: 'not_found', message: 'Render job not found.' });
  }
  if (job.userEmail !== email) {
    setCORSHeaders(res);
    return res.status(403).json({ error: 'forbidden' });
  }
  setCORSHeaders(res);
  return res.status(200).json({ success: true, ...publicStatus(job) });
}

function streamJobMp4(req, res, jobId, job, disposition) {
  const stat = statSync(job.outputPath);
  setCORSHeaders(res);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  const safeName = String(job.outputFilename || 'cutup-export.mp4').replace(/[^\w.\-]+/g, '_');
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Export-Job-Id', jobId);

  const stream = createReadStream(job.outputPath);
  stream.on('error', (err) => {
    console.error('[export-video] stream error', jobId, err?.message);
    if (!res.headersSent) res.status(500).json({ error: 'stream_failed' });
    else res.end();
  });
  stream.pipe(res);
}

async function handleDownload(req, res, jobId, email) {
  const job = getJob(jobId);
  if (!job || job.userEmail !== email) {
    setCORSHeaders(res);
    return res.status(404).json({ error: 'not_found', message: 'Render job not found.' });
  }
  if (!isJobReady(job) || !job.outputPath) {
    setCORSHeaders(res);
    return res.status(409).json({
      error: 'not_ready',
      message: 'Export is not ready yet.',
      status: publicStatus(job)
    });
  }

  console.log('[export-video] download', { jobId, bytes: job.fileSizeBytes, disposition: 'attachment' });
  streamJobMp4(req, res, jobId, job, 'attachment');
}

async function handlePreview(req, res, jobId, email) {
  const job = getJob(jobId);
  if (!job || job.userEmail !== email) {
    setCORSHeaders(res);
    return res.status(404).json({ error: 'not_found', message: 'Render job not found.' });
  }
  if (!isJobReady(job) || !job.outputPath) {
    setCORSHeaders(res);
    return res.status(409).json({
      error: 'not_ready',
      message: 'Preview is not ready yet.',
      status: publicStatus(job)
    });
  }

  streamJobMp4(req, res, jobId, job, 'inline');
}

async function handleGpuArtifact(req, res) {
  const jobId = req.query?.jobId;
  const kind = req.query?.kind;
  const token = req.query?.token;
  const workerToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const expected = String(process.env.GPU_RENDER_TOKEN || '').trim();

  if (!jobId || !kind || !token) {
    setCORSHeaders(res);
    return res.status(400).json({ error: 'jobId, kind, and token required' });
  }
  if (!expected || workerToken !== expected) {
    setCORSHeaders(res);
    return res.status(401).json({ error: 'unauthorized' });
  }

  purgeExpiredGpuArtifacts();
  setCORSHeaders(res);
  const result = streamGpuArtifact(req, res, jobId, kind, token);
  if (!result.ok) {
    if (!res.headersSent) {
      return res.status(result.status || 404).json({ error: 'artifact_not_found' });
    }
  }
}

async function handleCancel(req, res, email) {
  const body = req.body && typeof req.body === 'object' ? req.body : await parseJsonBody(req);
  const jobId = body.jobId || req.query?.jobId;
  if (!jobId) {
    setCORSHeaders(res);
    return res.status(400).json({ error: 'jobId required' });
  }
  const result = cancelJob(jobId, email);
  setCORSHeaders(res);
  if (!result.ok) {
    return res.status(result.code === 'NOT_FOUND' ? 404 : 409).json({ error: result.code });
  }
  return res.status(200).json({ success: true, cancelled: true });
}

export default async function handler(req, res) {
  const corsHandled = handleCORS(req, res);
  if (corsHandled) return;

  const action = req.query?.action || (req.method === 'GET' ? 'status' : null);

  try {
    if (req.method === 'GET' && action === 'presets') {
      setCORSHeaders(res);
      return res.status(200).json({ presets: listStylePresets() });
    }

    if (req.method === 'GET' && action === 'gpu-artifact') {
      return handleGpuArtifact(req, res);
    }

    if (req.method === 'POST' && !action) {
      return handleStart(req, res);
    }

    const email = requireSessionEmail(req, res);
    if (!email) return;

    if (req.method === 'POST' && action === 'cancel') {
      return handleCancel(req, res, email);
    }

    const jobId = req.query?.jobId;
    if (!jobId) {
      setCORSHeaders(res);
      return res.status(400).json({ error: 'jobId required' });
    }

    if (req.method === 'GET' && action === 'download') {
      return handleDownload(req, res, jobId, email);
    }

    if (req.method === 'GET' && action === 'preview') {
      return handlePreview(req, res, jobId, email);
    }

    if (req.method === 'GET') {
      return handleStatus(req, res, jobId, email);
    }

    setCORSHeaders(res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[export-video]', err);
    setCORSHeaders(res);
    if (String(err?.code || '') === 'PRESET_NOT_APPLIED' || /PRESET_NOT_APPLIED/i.test(String(err?.message || ''))) {
      return res.status(400).json({
        error: 'invalid_request',
        code: 'PRESET_NOT_APPLIED',
        message: err?.message || 'PRESET_NOT_APPLIED',
        traceId: resolveTraceId(req)
      });
    }
    return res.status(500).json({
      error: 'export_failed',
      message: err?.message || 'Video export failed',
      traceId: resolveTraceId(req)
    });
  }
}
