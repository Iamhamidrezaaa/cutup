/**
 * Slice audio windows for OpenAI-first language verification (first / middle / last).
 */
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkFfmpegAvailable } from '../video-render/ffmpeg-renderer.js';

export const DEFAULT_VERIFY_SEC = 15;

function extFromMime(mimeType, fallback = 'mp3') {
  const mt = String(mimeType || '').toLowerCase();
  if (mt.includes('wav')) return 'wav';
  if (mt.includes('m4a') || mt.includes('mp4')) return 'm4a';
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('ogg')) return 'ogg';
  return fallback;
}

function runFfprobeDuration(inputPath) {
  return new Promise((resolve) => {
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
    proc.on('error', () => resolve(0));
    proc.on('close', () => {
      const sec = parseFloat(String(out).trim());
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
    });
  });
}

function runFfmpegSliceAt(inputPath, outputPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, startSec)),
      '-i',
      inputPath,
      '-t',
      String(durationSec),
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      outputPath
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg slice exited ${code}`));
    });
  });
}

async function sliceOneWindow(audioBuffer, mimeType, extension, startSec, durationSec) {
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  if (!buf.length) {
    return {
      buffer: buf,
      mimeType: mimeType || 'audio/mpeg',
      extension: extension || 'mp3',
      sliced: false,
      startSec: 0
    };
  }

  const ffOk = await checkFfmpegAvailable().catch(() => false);
  if (!ffOk) {
    return {
      buffer: buf,
      mimeType: mimeType || 'audio/mpeg',
      extension: extension || extFromMime(mimeType),
      sliced: false,
      startSec: 0
    };
  }

  const ext = extension || extFromMime(mimeType);
  const dir = await mkdtemp(join(tmpdir(), 'cutup-lang-verify-'));
  const inPath = join(dir, `in.${ext}`);
  const outPath = join(dir, `sample.mp3`);

  try {
    await writeFile(inPath, buf);
    await runFfmpegSliceAt(inPath, outPath, startSec, durationSec);
    const sample = await readFile(outPath);
    return {
      buffer: sample,
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      sliced: true,
      startSec
    };
  } catch {
    return {
      buffer: buf,
      mimeType: mimeType || 'audio/mpeg',
      extension: ext,
      sliced: false,
      startSec: 0
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @param {string} extension
 * @param {number} [seconds]
 * @returns {Promise<{ buffer: Buffer, mimeType: string, extension: string, sliced: boolean }>}
 */
export async function sliceAudioFirstSeconds(
  audioBuffer,
  mimeType,
  extension,
  seconds = DEFAULT_VERIFY_SEC
) {
  const slice = await sliceOneWindow(audioBuffer, mimeType, extension, 0, seconds);
  return {
    buffer: slice.buffer,
    mimeType: slice.mimeType,
    extension: slice.extension,
    sliced: slice.sliced
  };
}

/**
 * First, middle, and last N-second samples for majority-vote language detection.
 * @returns {Promise<Array<{ position: 'first'|'middle'|'last', buffer: Buffer, mimeType: string, extension: string, sliced: boolean, startSec: number }>>}
 */
export async function sliceAudioVerificationSamples(
  audioBuffer,
  mimeType,
  extension,
  seconds = DEFAULT_VERIFY_SEC
) {
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  const ext = extension || extFromMime(mimeType);
  const ffOk = await checkFfmpegAvailable().catch(() => false);

  let durationSec = 0;
  if (ffOk && buf.length > 0) {
    const dir = await mkdtemp(join(tmpdir(), 'cutup-lang-probe-'));
    const inPath = join(dir, `in.${ext}`);
    try {
      await writeFile(inPath, buf);
      durationSec = await runFfprobeDuration(inPath);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const sliceDur = seconds;
  const firstStart = 0;
  const middleStart =
    durationSec > sliceDur ? Math.max(0, durationSec / 2 - sliceDur / 2) : 0;
  const lastStart = durationSec > sliceDur ? Math.max(0, durationSec - sliceDur) : 0;

  const positions = [
    { position: 'first', startSec: firstStart },
    { position: 'middle', startSec: middleStart },
    { position: 'last', startSec: lastStart }
  ];

  const samples = [];
  for (const { position, startSec } of positions) {
    const slice = await sliceOneWindow(buf, mimeType, ext, startSec, sliceDur);
    samples.push({
      position,
      buffer: slice.buffer,
      mimeType: slice.mimeType,
      extension: slice.extension,
      sliced: slice.sliced,
      startSec: slice.startSec
    });
  }
  return samples;
}
