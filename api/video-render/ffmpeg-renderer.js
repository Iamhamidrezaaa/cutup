/**
 * FFmpeg video burn-in renderer (ASS subtitles).
 */
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { dirname, basename, resolve } from 'path';

const execFileAsync = promisify(execFile);
const RENDER_TIMEOUT_MS = Number(process.env.VIDEO_RENDER_TIMEOUT_MS || 600000);
const RENDER_STALL_MS = Number(process.env.VIDEO_RENDER_STALL_MS || 45000);
const MAX_BUFFER = 8 * 1024 * 1024;
const HWACCEL_AUTO = String(process.env.VIDEO_RENDER_HWACCEL_AUTO || '1') !== '0';
let hwAccelProbePromise = null;

export const ENCODE_PRESETS = {
  fast: {
    preset: 'veryfast',
    crf: 27,
    maxWidth: 1280,
    audioBitrate: '128k',
    gop: 48,
    label: 'Fast preview'
  },
  hq: {
    preset: 'faster',
    crf: 20,
    maxWidth: null,
    audioBitrate: '192k',
    gop: 60,
    label: 'High quality'
  }
};

export function resolveEncodeProfile(quality = 'fast', renderHints = {}) {
  const base = ENCODE_PRESETS[quality] || ENCODE_PRESETS.fast;
  const enc = { ...base };
  enc.movflags = '+faststart+frag_keyframe+default_base_moof';
  enc.maxrate = quality === 'hq' ? '10M' : '6M';
  enc.bufsize = quality === 'hq' ? '16M' : '10M';

  if (quality === 'hq' && renderHints?.hqSafeguards) {
    enc.preset = 'fast';
    enc.crf = Math.max(21, Number(enc.crf) || 20);
    enc.maxrate = '8M';
    enc.bufsize = '12M';
    if (renderHints?.isVertical && Number(renderHints?.sourceWidth || 0) > 1440) {
      enc.maxWidth = 1440;
    }
  }
  if (renderHints?.isVertical) {
    enc.gop = quality === 'hq' ? 48 : 40;
    if (quality !== 'hq') enc.maxWidth = Math.min(Number(enc.maxWidth || 1080), 1080);
  }
  return enc;
}

function parseFfmpegTime(line) {
  const m = String(line).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseFfmpegProgressLines(chunkText) {
  const lines = String(chunkText || '').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function buildVideoFilter(assName, enc) {
  const filters = [];
  if (enc.maxWidth) {
    filters.push(`scale='min(${enc.maxWidth},iw)':-2:flags=lanczos`);
  }
  filters.push(`subtitles=${assName}:charenc=UTF-8`);
  return filters.join(',');
}

async function detectHardwareAcceleration() {
  if (!HWACCEL_AUTO) return { enabled: false, methods: [] };
  if (!hwAccelProbePromise) {
    hwAccelProbePromise = (async () => {
      try {
        const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-hwaccels'], {
          timeout: 6000,
          maxBuffer: 512 * 1024
        });
        const methods = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && line !== 'Hardware acceleration methods:' && !line.startsWith('ffmpeg version'));
        return { enabled: methods.length > 0, methods };
      } catch {
        return { enabled: false, methods: [] };
      }
    })();
  }
  return hwAccelProbePromise;
}

/**
 * @returns {Promise<{ width: number, height: number, durationSec: number, rotation: number }>}
 */
export async function probeVideo(inputPath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration:stream_tags=rotate',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      inputPath
    ],
    { timeout: 15000, maxBuffer: MAX_BUFFER }
  );
  const data = JSON.parse(stdout || '{}');
  const stream = data.streams?.[0] || {};
  const dur = Number(stream.duration || data.format?.duration || 0);
  const rotation = Number(stream.tags?.rotate || 0);
  return {
    width: Number(stream.width) || 1080,
    height: Number(stream.height) || 1920,
    durationSec: dur > 0 ? dur : 0,
    rotation
  };
}

export function inferAspect({ width, height, rotation }) {
  const rot = Math.abs(rotation || 0);
  const w = rot === 90 || rot === 270 ? height : width;
  const h = rot === 90 || rot === 270 ? width : height;
  if (!w || !h) return 'vertical';
  const ratio = w / h;
  if (ratio < 0.85) return 'vertical';
  if (ratio > 1.2) return 'horizontal';
  return 'square';
}

/**
 * Burn ASS subtitles — spawn + stderr progress (avoids silent hangs with no UI updates).
 * @param {{ inputPath: string, assPath: string, outputPath: string, quality?: 'fast'|'hq', durationSec?: number, renderHints?: { hqSafeguards?: boolean, isVertical?: boolean, sourceWidth?: number }, onProgress?: (info: { pct: number, etaSec: number|null, renderedSec: number|null, speed: number|null, fps: number|null, phase: 'rendering'|'muxing'|'finalizing' }) => void, signal?: AbortSignal }} opts
 */
export async function burnSubtitles(opts) {
  const { inputPath, assPath, outputPath, quality = 'fast', durationSec = 0, renderHints = {}, onProgress, signal } = opts;
  if (!existsSync(inputPath)) return Promise.reject(new Error('INPUT_VIDEO_MISSING'));
  if (!existsSync(assPath)) return Promise.reject(new Error('ASS_FILE_MISSING'));

  const enc = resolveEncodeProfile(quality, renderHints);
  const hwAccel = await detectHardwareAcceleration();
  const assDir = dirname(resolve(assPath));
  const assName = basename(assPath);
  const vf = buildVideoFilter(assName, enc);

  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-progress',
    'pipe:2',
    ...(hwAccel.enabled ? ['-hwaccel', 'auto'] : []),
    '-i',
    inputPath,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    enc.preset,
    '-crf',
    String(enc.crf),
    '-maxrate',
    String(enc.maxrate || (quality === 'hq' ? '10M' : '6M')),
    '-bufsize',
    String(enc.bufsize || (quality === 'hq' ? '16M' : '10M')),
    '-g',
    String(enc.gop || 48),
    '-keyint_min',
    String(Math.max(24, Math.round((enc.gop || 48) * 0.5))),
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    String(enc.movflags || '+faststart+frag_keyframe+default_base_moof'),
    '-c:a',
    'aac',
    '-b:a',
    enc.audioBitrate || '192k',
    '-max_muxing_queue_size',
    '2048',
    '-threads',
    '0',
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    outputPath
  ];

  console.log('[video-render] ffmpeg start', {
    quality,
    durationSec,
    encodePreset: enc.preset,
    crf: enc.crf,
    gop: enc.gop,
    maxrate: enc.maxrate,
    movflags: enc.movflags,
    vf,
    hwAccel: hwAccel.enabled ? hwAccel.methods.slice(0, 3) : [],
    cwd: assDir,
    input: basename(inputPath)
  });

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { cwd: assDir, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let killed = false;
    let lastPct = 0;
    let phase = 'rendering';
    let ffSpeed = null;
    let ffFps = null;
    let lastActivityAt = Date.now();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      killed = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* noop */
      }
      reject(err);
    };

    const emitProgress = ({
      pct,
      renderedSec = null,
      speed = ffSpeed,
      fps = ffFps,
      force = false,
      currentPhase = phase
    }) => {
      const clamped = Math.min(99, Math.max(0, Number(pct) || 0));
      if (!force && clamped <= lastPct) return;
      lastPct = Math.max(lastPct, clamped);
      if (clamped >= 97 && currentPhase === 'rendering') phase = 'muxing';

      let etaSec = null;
      if (durationSec > 0 && renderedSec != null) {
        if (speed != null && speed > 0.05) {
          etaSec = Math.round(Math.max(1, (durationSec - renderedSec) / speed));
        } else {
          etaSec = Math.round(Math.max(1, durationSec - renderedSec));
        }
      }

      onProgress?.({
        pct: lastPct,
        etaSec,
        renderedSec,
        speed: speed != null ? Number(speed) : null,
        fps: fps != null ? Number(fps) : null,
        phase: phase
      });
    };

    const timer = setTimeout(() => {
      fail(new Error(`FFmpeg timed out after ${Math.round(RENDER_TIMEOUT_MS / 1000)}s`));
    }, RENDER_TIMEOUT_MS);
    const stallTimer = setInterval(() => {
      if (Date.now() - lastActivityAt <= RENDER_STALL_MS) return;
      fail(new Error(`FFmpeg stalled for ${Math.round(RENDER_STALL_MS / 1000)}s`));
    }, 5000);
    stallTimer.unref?.();

    const onAbort = () => {
      fail(new Error('Render cancelled'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stderr.on('data', (chunk) => {
      lastActivityAt = Date.now();
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 120000) stderr = stderr.slice(-80000);

      const progress = parseFfmpegProgressLines(text);
      if (progress.speed) {
        const s = Number(String(progress.speed).replace('x', ''));
        if (Number.isFinite(s) && s > 0) ffSpeed = s;
      }
      if (progress.fps) {
        const f = Number(progress.fps);
        if (Number.isFinite(f) && f >= 0) ffFps = f;
      } else {
        const fpm = text.match(/fps=\s*([0-9]+(?:\.[0-9]+)?)/);
        if (fpm) {
          const f = Number(fpm[1]);
          if (Number.isFinite(f) && f >= 0) ffFps = f;
        }
      }

      let renderedSec = null;
      if (progress.out_time_ms) {
        const ms = Number(progress.out_time_ms);
        if (Number.isFinite(ms)) renderedSec = ms / 1000000;
      } else if (progress.out_time_us) {
        const us = Number(progress.out_time_us);
        if (Number.isFinite(us)) renderedSec = us / 1000000;
      } else if (progress.out_time) {
        renderedSec = parseFfmpegTime(`time=${progress.out_time}`);
      }
      if (renderedSec != null && durationSec > 0.5) {
        const pct = Math.min(99, Math.round((renderedSec / durationSec) * 100));
        emitProgress({ pct, renderedSec, speed: ffSpeed, fps: ffFps });
      }

      if (String(progress.progress) === 'end') {
        phase = 'finalizing';
      }

      // Fallback for ffmpeg builds that don't emit -progress consistently.
      if (!progress.out_time_ms && !progress.out_time_us && !progress.out_time) {
        const t = parseFfmpegTime(text);
        if (t != null && durationSec > 0.5) {
          const pct = Math.min(99, Math.round((t / durationSec) * 100));
          emitProgress({ pct, renderedSec: t, speed: ffSpeed, fps: ffFps });
        }
      }
    });

    proc.on('error', (err) => {
      clearInterval(stallTimer);
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (!settled) reject(err);
    });

    proc.on('close', (code) => {
      clearInterval(stallTimer);
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (killed && code !== 0) return;

      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        console.error('[video-render] ffmpeg failed', { code, tail });
        if (!settled) reject(new Error(tail || `FFmpeg exited with code ${code}`));
        return;
      }
      if (!existsSync(outputPath)) {
        if (!settled) reject(new Error('FFMPEG_OUTPUT_MISSING'));
        return;
      }
      onProgress?.({
        pct: 100,
        etaSec: 0,
        renderedSec: durationSec || null,
        speed: ffSpeed,
        fps: ffFps,
        phase: 'finalizing'
      });
      console.log('[video-render] ffmpeg done', { outputPath: basename(outputPath) });
      resolve({ outputPath, quality, preset: enc });
    });
  });
}

export async function checkFfmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000, maxBuffer: 65536 });
    return true;
  } catch {
    return false;
  }
}
