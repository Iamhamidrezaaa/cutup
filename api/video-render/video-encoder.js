/**
 * Video encoder selection — VPS defaults to libx264; GPU worker prefers NVENC with libx264 fallback.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** @type {string|null} */
let cachedWorkerEncoder = null;

/**
 * Probe ffmpeg -encoders for NVENC (RunPod worker startup).
 * @returns {Promise<'h264_nvenc'|'hevc_nvenc'|null>}
 */
export async function probeNvencAvailable() {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-encoders'], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024
    });
    const text = String(stdout || '');
    if (/\bh264_nvenc\b/.test(text)) return 'h264_nvenc';
    if (/\bhevc_nvenc\b/.test(text)) return 'hevc_nvenc';
  } catch (err) {
    console.warn('[video-encoder] NVENC probe failed:', err?.message || err);
  }
  return null;
}

/**
 * Run once on GPU worker boot: h264_nvenc when available, else libx264.
 * @returns {Promise<string>}
 */
export async function initWorkerVideoEncoder() {
  if (cachedWorkerEncoder) return cachedWorkerEncoder;

  const forced = String(process.env.VIDEO_RENDER_VIDEO_CODEC || '').trim().toLowerCase();
  if (forced === 'libx264') {
    cachedWorkerEncoder = 'libx264';
    return cachedWorkerEncoder;
  }
  if (forced === 'h264_nvenc' || forced === 'hevc_nvenc') {
    const available = await probeNvencAvailable();
    if (available) {
      cachedWorkerEncoder = available;
      process.env.VIDEO_RENDER_VIDEO_CODEC = available;
      console.log('[video-encoder] worker encoder:', available);
      return cachedWorkerEncoder;
    }
    console.warn('[video-encoder] forced', forced, 'unavailable — fallback libx264');
  }

  const nvenc = await probeNvencAvailable();
  if (nvenc) {
    cachedWorkerEncoder = nvenc;
    process.env.VIDEO_RENDER_VIDEO_CODEC = nvenc;
    console.log('[video-encoder] worker encoder:', nvenc);
  } else {
    cachedWorkerEncoder = 'libx264';
    process.env.VIDEO_RENDER_VIDEO_CODEC = 'libx264';
    console.warn('[video-encoder] NVENC unavailable — fallback libx264');
  }
  return cachedWorkerEncoder;
}

export function resolveVideoEncoder() {
  if (cachedWorkerEncoder) return cachedWorkerEncoder;
  const forced = String(process.env.VIDEO_RENDER_VIDEO_CODEC || '').trim().toLowerCase();
  if (forced === 'h264_nvenc' || forced === 'hevc_nvenc') return forced;
  if (forced === 'libx264') return 'libx264';
  if (String(process.env.GPU_RENDER_WORKER || '0') === '1') return 'h264_nvenc';
  return 'libx264';
}

export function isNvencCodec(codec) {
  return codec === 'h264_nvenc' || codec === 'hevc_nvenc';
}

/**
 * @param {string} codec
 * @param {object} enc from resolveEncodeProfile
 * @param {'fast'|'hq'} quality
 */
export function buildVideoEncodeArgs(codec, enc, quality = 'fast') {
  const maxrate = String(enc.maxrate || (quality === 'hq' ? '10M' : '6M'));
  const bufsize = String(enc.bufsize || (quality === 'hq' ? '16M' : '10M'));
  const gop = String(enc.gop || 48);
  const keyintMin = String(Math.max(24, Math.round((Number(enc.gop) || 48) * 0.5)));

  if (isNvencCodec(codec)) {
    const preset = String(process.env.VIDEO_RENDER_NVENC_PRESET || 'p4');
    const tune = String(process.env.VIDEO_RENDER_NVENC_TUNE || 'hq');
    const cq = String(
      process.env.VIDEO_RENDER_NVENC_CQ || (codec === 'hevc_nvenc' ? '26' : '23')
    );
    return [
      '-c:v',
      codec,
      '-preset',
      preset,
      '-tune',
      tune,
      '-rc',
      'vbr',
      '-cq',
      cq,
      '-b:v',
      '0',
      '-maxrate',
      maxrate,
      '-bufsize',
      bufsize,
      '-g',
      gop,
      '-keyint_min',
      keyintMin,
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p'
    ];
  }

  return [
    '-c:v',
    'libx264',
    '-preset',
    enc.preset,
    '-crf',
    String(enc.crf),
    '-maxrate',
    maxrate,
    '-bufsize',
    bufsize,
    '-g',
    gop,
    '-keyint_min',
    keyintMin,
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p'
  ];
}
