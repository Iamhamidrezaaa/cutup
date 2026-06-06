/**
 * Mandatory pre-burn CFR timeline normalization (YouTube/VFR → zero-based monotonic PTS).
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { probeMediaTimeline } from './ffmpeg-timeline.js';
import { probeVideoFramePtsAtSeconds } from './render-timeline-trace.js';
import { logFfmpegStart } from './ffmpeg-spawn-log.js';

const NORMALIZE_TIMEOUT_MS = Number(process.env.RENDER_NORMALIZE_TIMEOUT_MS || 600000);
const CFR_FPS = Math.max(15, Math.min(60, Number(process.env.RENDER_NORMALIZE_CFR_FPS || 30)));
const NORMALIZE_PRESET = String(process.env.RENDER_NORMALIZE_PRESET || 'veryfast');
const NORMALIZE_CRF = Number(process.env.RENDER_NORMALIZE_CRF || 18);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseFps(rate) {
  const raw = String(rate || '').trim();
  if (!raw || raw === '0/0') return null;
  if (raw.includes('/')) {
    const [a, b] = raw.split('/').map(Number);
    if (!b) return null;
    return a / b;
  }
  const f = Number(raw);
  return Number.isFinite(f) && f > 0 ? f : null;
}

/**
 * Probe video stream frame rate metadata for VFR detection.
 */
export async function probeSourceVideoTiming(inputPath) {
  const probe = await probeMediaTimeline(inputPath);
  const v = probe.video || {};
  const rFps = parseFps(v.r_frame_rate);
  const avgFps = parseFps(v.avg_frame_rate);
  const isVfr =
    rFps == null ||
    avgFps == null ||
    Math.abs(rFps - avgFps) > 0.45 ||
    /\/0$/.test(String(v.avg_frame_rate || '')) ||
    num(probe.format?.duration, 0) > 0 &&
      v.nb_frames > 0 &&
      Math.abs(v.nb_frames / probe.format.duration - avgFps) > 2;

  return {
    probe,
    rFrameRate: v.r_frame_rate,
    avgFrameRate: v.avg_frame_rate,
    rFps,
    avgFps,
    isVfr,
    videoStartTime: num(v.start_time, 0),
    audioStartTime: num(probe.audio?.start_time, 0),
    formatDuration: num(probe.format?.duration, 0),
    streamOffsetSec: num(v.start_time, 0) - num(probe.audio?.start_time, 0)
  };
}

export function logNormalizedTimelineDebug(payload) {
  console.log('[normalized-timeline-debug]', payload);
}

/**
 * CFR re-encode with zero-based A/V PTS (never burn subtitles on raw source).
 * @param {object} opts
 */
export async function normalizeVideoForBurn(opts) {
  const { inputPath, outputPath, signal, onProgress } = opts;
  if (!existsSync(inputPath)) {
    throw new Error('NORMALIZE_INPUT_MISSING');
  }

  const sourceTiming = await probeSourceVideoTiming(inputPath);
  const forceNormalize =
    String(process.env.RENDER_FORCE_NORMALIZE || '1').toLowerCase() !== '0' ||
    sourceTiming.isVfr ||
    Math.abs(sourceTiming.streamOffsetSec) > 0.1;

  if (!forceNormalize) {
    logNormalizedTimelineDebug({
      skipped: true,
      reason: 'force_normalize_disabled_and_not_vfr',
      ...sourceTiming
    });
    return { outputPath: inputPath, skipped: true, sourceTiming, normalizedTiming: null };
  }

  logNormalizedTimelineDebug({
    phase: 'normalize_start',
    inputPath,
    outputPath,
    sourceFps: sourceTiming.avgFps ?? sourceTiming.rFps,
    sourceAvgFrameRate: sourceTiming.avgFrameRate,
    sourceRFrameRate: sourceTiming.rFrameRate,
    sourceVideoStartTime: sourceTiming.videoStartTime,
    sourceAudioStartTime: sourceTiming.audioStartTime,
    sourceStreamOffsetSec: sourceTiming.streamOffsetSec,
    sourceIsVfr: sourceTiming.isVfr,
    targetCfrFps: CFR_FPS,
    flags: {
      vsync: 'cfr',
      r: CFR_FPS,
      fflags: '+genpts',
      avoid_negative_ts: 'make_zero',
      videoFilter: 'setpts=PTS-STARTPTS',
      audioFilter: 'asetpts=PTS-STARTPTS'
    }
  });

  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-progress',
    'pipe:2',
    '-ignore_editlist',
    '1',
    '-fflags',
    '+genpts',
    '-avoid_negative_ts',
    'make_zero',
    '-i',
    inputPath,
    '-vf',
    'setpts=PTS-STARTPTS',
    '-af',
    'asetpts=PTS-STARTPTS',
    '-vsync',
    'cfr',
    '-r',
    String(CFR_FPS),
    '-c:v',
    'libx264',
    '-preset',
    NORMALIZE_PRESET,
    '-crf',
    String(NORMALIZE_CRF),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    outputPath
  ];

  await runFfmpegNormalize(args, { signal, onProgress, timeoutMs: NORMALIZE_TIMEOUT_MS });

  if (!existsSync(outputPath)) {
    throw new Error('NORMALIZE_OUTPUT_MISSING');
  }

  const normalizedProbe = await probeMediaTimeline(outputPath);
  const normalizedTiming = {
    probe: normalizedProbe,
    rFrameRate: normalizedProbe.video?.r_frame_rate,
    avgFrameRate: normalizedProbe.video?.avg_frame_rate,
    rFps: parseFps(normalizedProbe.video?.r_frame_rate),
    avgFps: parseFps(normalizedProbe.video?.avg_frame_rate),
    videoStartTime: num(normalizedProbe.video?.start_time, 0),
    audioStartTime: num(normalizedProbe.audio?.start_time, 0),
    formatDuration: num(normalizedProbe.format?.duration, 0),
    streamOffsetSec:
      num(normalizedProbe.video?.start_time, 0) - num(normalizedProbe.audio?.start_time, 0)
  };

  const durationDelta = Number(
    (normalizedTiming.formatDuration - sourceTiming.formatDuration).toFixed(4)
  );

  logNormalizedTimelineDebug({
    phase: 'normalize_complete',
    sourceFps: sourceTiming.avgFps ?? sourceTiming.rFps,
    sourceAvgFrameRate: sourceTiming.avgFrameRate,
    sourceRFrameRate: sourceTiming.rFrameRate,
    sourceStartTime: sourceTiming.videoStartTime,
    normalizedFps: normalizedTiming.avgFps ?? CFR_FPS,
    normalizedAvgFrameRate: normalizedTiming.avgFrameRate,
    normalizedRFrameRate: normalizedTiming.rFrameRate,
    normalizedVideoStartTime: normalizedTiming.videoStartTime,
    normalizedAudioStartTime: normalizedTiming.audioStartTime,
    normalizedStreamOffsetSec: normalizedTiming.streamOffsetSec,
    normalizedDurationDeltaSec: durationDelta,
    sourceDurationSec: sourceTiming.formatDuration,
    normalizedDurationSec: normalizedTiming.formatDuration
  });

  return {
    outputPath,
    skipped: false,
    sourceTiming,
    normalizedTiming,
    durationDeltaSec: durationDelta,
    cfrFps: CFR_FPS,
    forceNormalizeBecauseVfr: sourceTiming.isVfr
  };
}

function parseProgressTime(progress) {
  if (progress.out_time_ms) return Number(progress.out_time_ms) / 1000000;
  if (progress.out_time_us) return Number(progress.out_time_us) / 1000000;
  if (progress.out_time) {
    const m = String(progress.out_time).match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return null;
}

function parseFfmpegProgressLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function runFfmpegNormalize(args, { signal, onProgress, timeoutMs }) {
  logFfmpegStart('normalize-cfr', 'ffmpeg', args);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* noop */
      }
      reject(err);
    };

    const timer = setTimeout(() => fail(new Error(`Normalize timed out after ${timeoutMs}ms`)), timeoutMs);

    const onAbort = () => fail(new Error('Render cancelled'));
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stderr.on('data', (chunk) => {
      const progress = parseFfmpegProgressLines(chunk.toString());
      const t = parseProgressTime(progress);
      if (t != null) onProgress?.({ phase: 'normalizing', renderedSec: t });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fail(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code !== 0) {
        fail(new Error(`Normalize ffmpeg exited with code ${code}`));
        return;
      }
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

/**
 * Post-normalize sync check: subtitle cues vs normalized video frame PTS.
 */
export async function verifyNormalizedBurnSync(subtitleCues, normalizedPath) {
  const framePts = await probeVideoFramePtsAtSeconds(normalizedPath, [0, 1, 2, 3, 4]);
  const firstCue = subtitleCues[0];
  const report = {
    firstCueStart: firstCue ? num(firstCue.start, null) : null,
    firstCueEnd: firstCue ? num(firstCue.end, null) : null,
    normalizedFramePts: framePts,
    framePtsMatchCue:
      firstCue && framePts[0]
        ? Math.abs(num(framePts[0].bestEffortTimestampTime, framePts[0].pktPtsTime, 0) - firstCue.start) < 0.35
        : null
  };
  console.log('[normalized-timeline-debug]', { phase: 'pre_burn_sync_verify', ...report });
  return report;
}
