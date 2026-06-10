/**
 * POST /api/admin/asr-benchmark — admin-only ASR engine comparison (does not touch production transcribe).
 * Returns immediately; long work runs in background with GET polling by traceId.
 */
import Busboy from 'busboy';
import fetchModule from 'node-fetch';
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { prepareUploadBufferForTranscription } from './upload-media-prep.js';
import { runAllBenchmarkEngines } from './asr-benchmark/benchmark-providers.js';
import {
  buildComparisonReport,
  buildComparisonSummaryText,
  saveAsrComparisonArtifacts,
  resolveAsrComparisonDir
} from './asr-benchmark/asr-comparison.js';

const MAX_BYTES = 100 * 1024 * 1024;

/** @type {Set<string>} */
const activeJobs = new Set();

function getFetch() {
  return fetchModule.default || fetchModule;
}

function jobStatusPath(traceId) {
  return join(resolveAsrComparisonDir(traceId), 'job-status.json');
}

function jobResultPath(traceId) {
  return join(resolveAsrComparisonDir(traceId), 'job-result.json');
}

function writeJobStatus(traceId, patch) {
  const dir = resolveAsrComparisonDir(traceId);
  mkdirSync(dir, { recursive: true });
  const path = jobStatusPath(traceId);
  let prev = {};
  if (existsSync(path)) {
    try {
      prev = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      prev = {};
    }
  }
  const next = {
    ...prev,
    traceId,
    updatedAt: new Date().toISOString(),
    ...patch
  };
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function probeAudioDurationSec(audioBuffer, extension) {
  const { spawn } = await import('child_process');
  const { mkdtemp, writeFile, rm } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const dir = await mkdtemp(join(tmpdir(), 'cutup-asr-bench-probe-'));
  const inputPath = join(dir, `audio.${extension || 'mp3'}`);
  try {
    await writeFile(inputPath, audioBuffer);
    const sec = await new Promise((resolve) => {
      const proc = spawn(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputPath
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let out = '';
      proc.stdout.on('data', (d) => {
        out += d.toString();
      });
      proc.on('error', () => resolve(null));
      proc.on('close', () => {
        const n = parseFloat(String(out).trim());
        resolve(Number.isFinite(n) && n > 0 ? n : null);
      });
    });
    return sec;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let filename = 'upload';
    let mimeType = 'application/octet-stream';
    let languageHint = null;

    busboy.on('field', (name, value) => {
      if (name === 'languageHint') languageHint = String(value || '').trim() || null;
    });

    busboy.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      filename = info.filename || filename;
      mimeType = info.mimeType || mimeType;
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on('finish', () => {
      resolve({ fileBuffer, filename, mimeType, languageHint });
    });
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

export async function runAsrBenchmark(opts = {}) {
  const {
    traceId,
    audioBuffer,
    mimeType,
    extension,
    languageHint = null,
    extractedFromVideo = false,
    sourceFilename = null,
    onProgress = null
  } = opts;

  const progress = (patch) => {
    if (typeof onProgress === 'function') onProgress(patch);
  };

  progress({ stage: 'transcribing', enginesDone: 0, enginesTotal: 3 });
  let enginesDone = 0;

  const engineResults = await runAllBenchmarkEngines(
    {
      fetch: getFetch(),
      traceId,
      audioBuffer,
      mimeType,
      extension,
      languageHint
    },
    {
      parallel: true,
      onEngineDone: (engine, result) => {
        enginesDone += 1;
        progress({
          stage: `engine_done_${engine.id}`,
          enginesDone,
          enginesTotal: 3,
          lastEngineId: engine.id,
          lastEngineWordCount: result.wordCount ?? 0
        });
      }
    }
  );

  progress({ stage: 'comparing', enginesDone: 3, enginesTotal: 3 });

  let audioDurationSec = await probeAudioDurationSec(audioBuffer, extension);
  if (!audioDurationSec) {
    const durations = engineResults
      .map((r) => Number(r.durationSeconds) || 0)
      .filter((d) => d > 0);
    audioDurationSec = durations.length ? Math.max(...durations) : null;
  }

  const report = buildComparisonReport({ audioDurationSec, engineResults });
  report.traceId = traceId;
  report.source = {
    filename: sourceFilename,
    mimeType,
    extension,
    bytes: audioBuffer.length,
    extractedFromVideo: Boolean(extractedFromVideo),
    languageHint
  };
  report.artifactDir = resolveAsrComparisonDir(traceId);

  const summaryText = buildComparisonSummaryText(report, engineResults);
  const saved = saveAsrComparisonArtifacts({
    traceId,
    engineResults,
    report,
    summaryText
  });

  const payload = {
    traceId,
    report,
    summaryText,
    engineResults: engineResults.map((r) => ({
      engineId: r.engineId,
      provider: r.provider,
      model: r.model,
      skipped: r.skipped,
      failed: r.failed,
      wordCount: r.wordCount,
      segmentCount: r.segmentCount,
      text: r.text
    })),
    paths: saved.written,
    artifactDir: saved.dir
  };

  writeFileSync(jobResultPath(traceId), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function runBenchmarkJob({
  traceId,
  fileBuffer,
  filename,
  mimeType,
  languageHint,
  adminEmail
}) {
  if (activeJobs.has(traceId)) return;
  activeJobs.add(traceId);

  try {
    writeJobStatus(traceId, {
      status: 'running',
      stage: 'extracting_audio',
      startedAt: new Date().toISOString(),
      enginesDone: 0,
      enginesTotal: 3,
      adminEmail
    });

    const prepared = await prepareUploadBufferForTranscription(
      fileBuffer,
      mimeType,
      filename,
      traceId
    );

    writeJobStatus(traceId, {
      stage: 'audio_ready',
      extractedFromVideo: prepared.extractedFromVideo,
      audioBytes: prepared.buffer.length,
      audioMimeType: prepared.mimeType,
      audioExtension: prepared.extension
    });

    const result = await runAsrBenchmark({
      traceId,
      audioBuffer: prepared.buffer,
      mimeType: prepared.mimeType,
      extension: prepared.extension,
      languageHint,
      extractedFromVideo: prepared.extractedFromVideo,
      sourceFilename: filename,
      onProgress: (patch) => writeJobStatus(traceId, { status: 'running', ...patch })
    });

    writeJobStatus(traceId, {
      status: 'completed',
      stage: 'done',
      completedAt: new Date().toISOString(),
      enginesDone: 3,
      enginesTotal: 3,
      artifactDir: result.artifactDir
    });

    console.log(
      JSON.stringify({
        event: 'asr_benchmark_complete',
        traceId,
        admin: adminEmail,
        artifactDir: result.artifactDir,
        engines: result.engineResults.map((e) => ({
          id: e.engineId,
          words: e.wordCount,
          skipped: e.skipped
        }))
      })
    );
  } catch (err) {
    console.error('[asr-benchmark-job-error]', traceId, err?.message || err);
    writeJobStatus(traceId, {
      status: 'failed',
      stage: 'failed',
      completedAt: new Date().toISOString(),
      error: String(err?.message || err)
    });
  } finally {
    activeJobs.delete(traceId);
  }
}

function loadBenchmarkPollResponse(traceId) {
  const statusPath = jobStatusPath(traceId);
  if (!existsSync(statusPath)) {
    return { found: false };
  }

  const job = JSON.parse(readFileSync(statusPath, 'utf8'));
  const out = {
    found: true,
    traceId,
    status: job.status || 'running',
    job,
    artifactDir: resolveAsrComparisonDir(traceId)
  };

  if (job.status === 'completed') {
    const resultPath = jobResultPath(traceId);
    const reportPath = join(resolveAsrComparisonDir(traceId), 'comparison-report.json');
    const summaryPath = join(resolveAsrComparisonDir(traceId), 'comparison-summary.txt');

    if (existsSync(resultPath)) {
      const result = JSON.parse(readFileSync(resultPath, 'utf8'));
      return { ...out, ok: true, ...result };
    }
    if (existsSync(reportPath)) {
      return {
        ...out,
        ok: true,
        report: JSON.parse(readFileSync(reportPath, 'utf8')),
        summaryText: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : ''
      };
    }
  }

  return out;
}

export default async function handler(req, res) {
  setAdminPanelCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const auth = await resolveAdminAuth(req);
  if (!auth?.email) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    const traceId = String(req.query?.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({ error: 'traceId required' });
    }
    try {
      const polled = loadBenchmarkPollResponse(traceId);
      if (!polled.found) {
        return res.status(404).json({ error: 'benchmark_not_found', traceId });
      }
      if (polled.status === 'failed') {
        return res.status(200).json({
          ok: false,
          traceId,
          status: 'failed',
          job: polled.job,
          error: polled.job?.error || 'ASR benchmark failed'
        });
      }
      if (polled.status !== 'completed') {
        return res.status(200).json({
          ok: true,
          traceId,
          status: polled.status,
          job: polled.job
        });
      }
      return res.status(200).json({
        ok: true,
        status: 'completed',
        ...polled
      });
    } catch (err) {
      return res.status(500).json({ error: String(err?.message || err) });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileBuffer, filename, mimeType, languageHint } = await parseMultipart(req);
    if (!fileBuffer?.length) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (fileBuffer.length > MAX_BYTES) {
      return res.status(400).json({ error: 'File too large for benchmark (max 100MB upload)' });
    }

    const traceId = `asr-bench-${Date.now()}-${randomBytes(4).toString('hex')}`;
    writeJobStatus(traceId, {
      status: 'queued',
      stage: 'queued',
      startedAt: new Date().toISOString(),
      sourceFilename: filename,
      uploadBytes: fileBuffer.length,
      languageHint,
      adminEmail: auth.email
    });

    void runBenchmarkJob({
      traceId,
      fileBuffer,
      filename,
      mimeType,
      languageHint,
      adminEmail: auth.email
    });

    return res.status(202).json({
      ok: true,
      traceId,
      status: 'queued',
      message: 'ASR benchmark started. Poll GET /api/admin/asr-benchmark?traceId=… for results.',
      pollUrl: `/api/admin/asr-benchmark?traceId=${encodeURIComponent(traceId)}`
    });
  } catch (err) {
    console.error('[asr-benchmark-error]', err?.message || err);
    return res.status(500).json({
      error: 'ASR_BENCHMARK_FAILED',
      message: String(err?.message || err)
    });
  }
}
