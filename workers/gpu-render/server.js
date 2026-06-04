/**
 * Cutup GPU render worker — FFmpeg burn-in only (ASS + video → MP4).
 * Run on RunPod with NVENC. Does not run subtitle/translation pipelines.
 */
process.env.GPU_RENDER_WORKER = '1';
process.env.VIDEO_RENDER_VIDEO_CODEC =
  process.env.VIDEO_RENDER_VIDEO_CODEC || 'h264_nvenc';

import express from 'express';
import { mkdir, writeFile, stat, copyFile } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomBytes } from 'crypto';
import { executeBurnExportPhase } from '../../api/video-render/burn-export-phase.js';
import { probeVideo, checkFfmpegAvailable } from '../../api/video-render/ffmpeg-renderer.js';
import { resolveVideoEncoder } from '../../api/video-render/video-encoder.js';

const PORT = Number(process.env.GPU_RENDER_PORT || process.env.PORT || 8787);
const WORK_ROOT = process.env.GPU_RENDER_WORK_DIR || '/tmp/cutup-gpu-render';
const OUTPUT_ROOT = join(WORK_ROOT, 'outputs');
const TOKEN = String(process.env.GPU_RENDER_TOKEN || '').trim();
const PUBLIC_BASE = String(process.env.GPU_RENDER_PUBLIC_URL || '').replace(/\/$/, '');

const app = express();
app.use(express.json({ limit: '2mb' }));

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

async function downloadToFile(url, destPath) {
  const res = await fetch(url, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url.slice(0, 120)}`);
  }
  const body = res.body;
  const stream =
    body && typeof body.pipe === 'function' ? body : Readable.fromWeb(body);
  await pipeline(stream, createWriteStream(destPath));
}

app.get('/health', async (_req, res) => {
  const ffmpegOk = await checkFfmpegAvailable();
  res.json({
    ok: ffmpegOk,
    encoder: resolveVideoEncoder(),
    worker: true
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

  const jobDir = join(WORK_ROOT, 'jobs', jobId);
  const videoPath = join(jobDir, 'source.mp4');
  const assPath = join(jobDir, 'subtitles.ass');
  const outputPath = join(jobDir, 'export.mp4');
  const publicOut = join(OUTPUT_ROOT, `${jobId}.mp4`);

  try {
    await mkdir(jobDir, { recursive: true });
    await mkdir(OUTPUT_ROOT, { recursive: true });

    console.log('[gpu-worker] download start', { jobId, preset });
    await downloadToFile(videoUrl, videoPath);
    const assText = await fetch(subtitleUrl, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
    }).then((r) => {
      if (!r.ok) throw new Error(`ASS download failed (${r.status})`);
      return r.text();
    });
    await writeFile(assPath, assText, 'utf8');

    const probe = await probeVideo(videoPath);
    const renderHints = body.renderHints && typeof body.renderHints === 'object' ? body.renderHints : {};
    const isVertical = Boolean(renderHints.isVertical) || probe.height > probe.width * 1.05;

    console.log('[gpu-worker] burn start', {
      jobId,
      preset,
      encoder: resolveVideoEncoder(),
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
        if (info?.pct && info.pct % 10 < 1) {
          console.log('[gpu-worker] progress', { jobId, pct: info.pct, phase: info.phase });
        }
      }
    });

    await copyFile(outputPath, publicOut);
    const renderMs = Date.now() - started;
    const outputUrl = PUBLIC_BASE
      ? `${PUBLIC_BASE}/outputs/${encodeURIComponent(jobId)}`
      : `http://127.0.0.1:${PORT}/outputs/${encodeURIComponent(jobId)}`;

    console.log('[gpu-worker] complete', { jobId, renderMs, outputUrl });

    return res.status(200).json({
      success: true,
      jobId,
      outputUrl,
      renderMs,
      preset
    });
  } catch (err) {
    console.error('[gpu-worker] failed', jobId, err?.message || err);
    return res.status(500).json({
      success: false,
      error: 'render_failed',
      message: err?.message || 'GPU render failed',
      jobId
    });
  }
});

app.listen(PORT, () => {
  console.log('[gpu-worker] listening', {
    port: PORT,
    encoder: resolveVideoEncoder(),
    workRoot: WORK_ROOT,
    publicBase: PUBLIC_BASE || '(local)'
  });
});
