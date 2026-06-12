/**
 * Prepare uploaded files for Whisper — extract audio track from video (social-style).
 */
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkFfmpegAvailable } from './video-render/ffmpeg-renderer.js';
import { trackFfmpegStart, trackFfmpegEnd } from './video-render/ffmpeg-job-tracker.js';

const VIDEO_EXT = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi']);

function extFromName(filename, fallback = 'bin') {
  const m = String(filename || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : fallback;
}

function isVideoMime(mimeType, filename) {
  const mt = String(mimeType || '').toLowerCase();
  if (mt.startsWith('video/')) return true;
  return VIDEO_EXT.has(extFromName(filename, ''));
}

const FFMPEG_EXTRACT_TIMEOUT_MS = Math.max(
  60000,
  Number(process.env.UPLOAD_FFMPEG_TIMEOUT_MS || 180000)
);

function runFfmpegExtractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vn',
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
    const purpose = 'upload-audio-extract';
    const trackId = trackFfmpegStart(null, purpose, 'ffmpeg', args);
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      trackFfmpegEnd(null, trackId, purpose);
      reject(new Error(`ffmpeg audio extract timed out after ${FFMPEG_EXTRACT_TIMEOUT_MS}ms`));
    }, FFMPEG_EXTRACT_TIMEOUT_MS);
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', (spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      trackFfmpegEnd(null, trackId, purpose);
      reject(spawnErr);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      trackFfmpegEnd(null, trackId, purpose);
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg exited ${code}`));
    });
  });
}

/**
 * @returns {{ buffer: Buffer, mimeType: string, extension: string, extractedFromVideo: boolean }}
 */
export async function prepareUploadBufferForTranscription(
  buffer,
  mimeType,
  filename = 'upload',
  traceId = null
) {
  const baseMime = String(mimeType || 'application/octet-stream').toLowerCase();
  if (!isVideoMime(baseMime, filename)) {
    let extension = 'mp3';
    if (baseMime.includes('wav')) extension = 'wav';
    else if (baseMime.includes('m4a') || baseMime.includes('mp4')) extension = 'm4a';
    else if (baseMime.includes('ogg')) extension = 'ogg';
    else if (baseMime.includes('webm')) extension = 'webm';
    else extension = extFromName(filename, 'mp3');
    return { buffer, mimeType: baseMime || 'audio/mpeg', extension, extractedFromVideo: false };
  }

  const ffmpegOk = await checkFfmpegAvailable();
  if (!ffmpegOk) {
    console.warn('[upload-media-prep] ffmpeg missing — sending video to transcription as-is', { traceId });
    return {
      buffer,
      mimeType: baseMime,
      extension: extFromName(filename, 'mp4'),
      extractedFromVideo: false
    };
  }

  const workDir = await mkdtemp(join(tmpdir(), 'cutup-upload-'));
  const inExt = extFromName(filename, 'mp4');
  const inputPath = join(workDir, `input.${inExt}`);
  const outputPath = join(workDir, 'audio.mp3');

  try {
    await writeFile(inputPath, buffer);
    await runFfmpegExtractAudio(inputPath, outputPath);
    const audioBuffer = await readFile(outputPath);
    console.log('[upload-media-prep] extracted audio from video', {
      traceId,
      inputBytes: buffer.length,
      audioBytes: audioBuffer.length,
      filename
    });
    return {
      buffer: audioBuffer,
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      extractedFromVideo: true
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
