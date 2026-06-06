/**
 * Cutup GPU render worker (RunPod) — FFmpeg subtitle burn-in only.
 * ASS/subtitle pipeline stays on the main VPS; this service only runs burn-export-phase.
 */
import express from 'express';
import { mkdir, writeFile, stat, copyFile } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomBytes } from 'crypto';
import { executeBurnExportPhase } from '../../api/video-render/burn-export-phase.js';
import { checkFfmpegAvailable, probeVideo } from '../../api/video-render/ffmpeg-renderer.js';
import {
  initWorkerVideoEncoder,
  resolveVideoEncoder
} from '../../api/video-render/video-encoder.js';
import {
  noteRenderJobStarted,
  noteRenderJobFinished,
  startAutoStopScheduler,
  getAutoStopState
} from './auto-stop.js';

const PORT = Number(process.env.GPU_RENDER_PORT || process.env.PORT || 8787);
const WORK_ROOT = process.env.GPU_RENDER_WORK_DIR || '/tmp/cutup-gpu-render';
const OUTPUT_ROOT = join(WORK_ROOT, 'outputs');
const TOKEN = String(process.env.GPU_RENDER_TOKEN || '').trim();
const PUBLIC_BASE = String(process.env.GPU_RENDER_PUBLIC_URL || '').replace(/\/$/, '');

const app = express();
app.use(express.json({ limit: '4mb' }));

function requireAuth(req, res, next) {
  if (!TOKEN) {
    return res.status(503).json({ success: false, error: 'GPU_RENDER_TOKEN not set' });
  }
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (auth !== TOKEN) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  next();
}

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${String(url).slice(0, 160)}`);
  }
  const body = res.body;
  const stream =
    body && typeof body.pipe === 'function' ? body : Readable.fromWeb(body);
  await pipeline(stream, createWriteStream(destPath));
}

async function downloadText(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`ASS download failed (${res.status}): ${String(url).slice(0, 160)}`);
  }
  return res.text();
}

/** Liveness — contract: { ok: true } */
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/** Readiness (optional detail) */
app.get('/health/ready', async (_req, res) => {
  const ffmpegOk = await checkFfmpegAvailable();
  const encoder = resolveVideoEncoder();
  res.json({
    ok: ffmpegOk,
    ffmpeg: ffmpegOk,
    encoder,
    autoStop: getAutoStopState()
  });
});

app.get('/outputs/:jobId', requireAuth, async (req, res) => {
  const path = join(OUTPUT_ROOT, `${req.params.jobId}.mp4`);
  try {
    const st = await stat(path);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', st.size);
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(path).pipe(res);
  } catch {
    res.status(404).json({ success: false, error: 'output_not_found' });
  }
});

/**
 * POST /render
 * Body: { jobId, videoUrl, subtitleUrl, preset, quality?, trustPreviewTimings?, renderHints? }
 */
app.post('/render', requireAuth, async (req, res) => {
  const started = Date.now();
  const body = req.body || {};
  const jobId = String(body.jobId || randomBytes(8).toString('hex'));
  const videoUrl = String(body.videoUrl || '').trim();
  const subtitleUrl = String(body.subtitleUrl || '').trim();
  const preset = String(body.preset || 'mrbeast');
  const quality = body.quality === 'hq' ? 'hq' : 'fast';

  if (!videoUrl || !subtitleUrl) {
    return res.status(400).json({
      success: false,
      error: 'videoUrl and subtitleUrl are required'
    });
  }

  noteRenderJobStarted();

  const jobDir = join(WORK_ROOT, 'jobs', jobId);
  const videoPath = join(jobDir, 'source.mp4');
  const assPath = join(jobDir, 'subtitles.ass');
  const outputPath = join(jobDir, 'export.mp4');
  const publicOut = join(OUTPUT_ROOT, `${jobId}.mp4`);

  try {
    await mkdir(jobDir, { recursive: true });
    await mkdir(OUTPUT_ROOT, { recursive: true });

    console.log('[gpu-worker] download', { jobId, preset });
    console.time('download');
    try {
      await downloadToFile(videoUrl, videoPath);
      const assText = await downloadText(subtitleUrl);
      await writeFile(assPath, assText, 'utf8');
    } finally {
      console.timeEnd('download');
    }

    const probe = await probeVideo(videoPath);
    const renderHints =
      body.renderHints && typeof body.renderHints === 'object' ? body.renderHints : {};
    const isVertical =
      Boolean(renderHints.isVertical) || probe.height > probe.width * 1.05;

    console.log('[gpu-worker] burn', {
      jobId,
      preset,
      encoder: resolveVideoEncoder(),
      quality,
      durationSec: probe.durationSec
    });

    await executeBurnExportPhase({
      jobId,
      jobDir,
      videoPath,
      assPath,
      outputPath,
      quality,
      probe,
      segments: [],
      assResult: null,
      hqSafeguards: Boolean(renderHints.hqSafeguards),
      isVertical,
      trustPreviewTimings: Boolean(body.trustPreviewTimings),
      timelineTrace: null,
      onProgress: (info) => {
        if (info?.pct != null && Math.round(info.pct) % 20 === 0) {
          console.log('[gpu-worker] progress', { jobId, pct: info.pct, phase: info.phase });
        }
      }
    });

    await copyFile(outputPath, publicOut);
    const renderMs = Date.now() - started;
    const outputUrl = PUBLIC_BASE
      ? `${PUBLIC_BASE}/outputs/${encodeURIComponent(jobId)}`
      : `http://127.0.0.1:${PORT}/outputs/${encodeURIComponent(jobId)}`;

    console.log('[gpu-worker] done', { jobId, renderMs, encoder: resolveVideoEncoder() });

    return res.status(200).json({
      success: true,
      jobId,
      outputUrl,
      renderMs,
      preset,
      encoder: resolveVideoEncoder()
    });
  } catch (err) {
    console.error('[gpu-worker] failed', jobId, err?.message || err);
    return res.status(500).json({
      success: false,
      error: 'render_failed',
      message: err?.message || 'GPU render failed',
      jobId
    });
  } finally {
    noteRenderJobFinished();
  }
});

async function main() {
  process.env.GPU_RENDER_WORKER = '1';
  const ffmpegOk = await checkFfmpegAvailable();
  if (!ffmpegOk) {
    console.error('[gpu-worker] FFmpeg not found on PATH');
    process.exit(1);
  }
  const encoder = await initWorkerVideoEncoder();
  startAutoStopScheduler();
  app.listen(PORT, () => {
    console.log('[gpu-worker] listening', {
      port: PORT,
      encoder,
      workRoot: WORK_ROOT,
      publicBase: PUBLIC_BASE || `http://127.0.0.1:${PORT}`
    });
  });
}

main().catch((err) => {
  console.error('[gpu-worker] startup failed', err);
  process.exit(1);
});
