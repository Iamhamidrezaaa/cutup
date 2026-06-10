/**
 * Slice first N seconds of audio for lightweight language verification passes.
 */
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkFfmpegAvailable } from '../video-render/ffmpeg-renderer.js';

const DEFAULT_VERIFY_SEC = 15;

function extFromMime(mimeType, fallback = 'mp3') {
  const mt = String(mimeType || '').toLowerCase();
  if (mt.includes('wav')) return 'wav';
  if (mt.includes('m4a') || mt.includes('mp4')) return 'm4a';
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('ogg')) return 'ogg';
  return fallback;
}

function runFfmpegSlice(inputPath, outputPath, seconds) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-t',
      String(seconds),
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
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  if (!buf.length) {
    return { buffer: buf, mimeType: mimeType || 'audio/mpeg', extension: extension || 'mp3', sliced: false };
  }

  const ffOk = await checkFfmpegAvailable().catch(() => false);
  if (!ffOk) {
    return {
      buffer: buf,
      mimeType: mimeType || 'audio/mpeg',
      extension: extension || extFromMime(mimeType),
      sliced: false
    };
  }

  const ext = extension || extFromMime(mimeType);
  const dir = await mkdtemp(join(tmpdir(), 'cutup-lang-verify-'));
  const inPath = join(dir, `in.${ext}`);
  const outPath = join(dir, `sample.mp3`);

  try {
    await writeFile(inPath, buf);
    await runFfmpegSlice(inPath, outPath, seconds);
    const sample = await readFile(outPath);
    return {
      buffer: sample,
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      sliced: true
    };
  } catch {
    return {
      buffer: buf,
      mimeType: mimeType || 'audio/mpeg',
      extension: ext,
      sliced: false
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
