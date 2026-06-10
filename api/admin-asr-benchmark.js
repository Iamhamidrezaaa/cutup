/**
 * POST /api/admin/asr-benchmark — admin-only ASR engine comparison (does not touch production transcribe).
 */
import Busboy from 'busboy';
import fetchModule from 'node-fetch';
import { randomBytes } from 'crypto';
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

function getFetch() {
  return fetchModule.default || fetchModule;
}

async function probeAudioDurationSec(audioBuffer, extension) {
  const { spawn } = await import('child_process');
  const { mkdtemp, writeFile, rm } = await import('fs/promises');
  const { join } = await import('path');
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
    sourceFilename = null
  } = opts;

  const engineResults = await runAllBenchmarkEngines({
    fetch: getFetch(),
    traceId,
    audioBuffer,
    mimeType,
    extension,
    languageHint
  });

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

  return {
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
      const { readFileSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const dir = resolveAsrComparisonDir(traceId);
      const reportPath = join(dir, 'comparison-report.json');
      const summaryPath = join(dir, 'comparison-summary.txt');
      if (!existsSync(reportPath)) {
        return res.status(404).json({ error: 'benchmark_not_found', traceId });
      }
      return res.status(200).json({
        traceId,
        artifactDir: dir,
        report: JSON.parse(readFileSync(reportPath, 'utf8')),
        summaryText: existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : ''
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
    const prepared = await prepareUploadBufferForTranscription(
      fileBuffer,
      mimeType,
      filename,
      traceId
    );

    const result = await runAsrBenchmark({
      traceId,
      audioBuffer: prepared.buffer,
      mimeType: prepared.mimeType,
      extension: prepared.extension,
      languageHint,
      extractedFromVideo: prepared.extractedFromVideo,
      sourceFilename: filename
    });

    console.log(
      JSON.stringify({
        event: 'asr_benchmark_complete',
        traceId,
        admin: auth.email,
        artifactDir: result.artifactDir,
        engines: result.engineResults.map((e) => ({
          id: e.engineId,
          words: e.wordCount,
          skipped: e.skipped
        }))
      })
    );

    return res.status(200).json({
      ok: true,
      ...result
    });
  } catch (err) {
    console.error('[asr-benchmark-error]', err?.message || err);
    return res.status(500).json({
      error: 'ASR_BENCHMARK_FAILED',
      message: String(err?.message || err)
    });
  }
}
