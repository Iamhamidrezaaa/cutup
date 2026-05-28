/**
 * FFmpeg video burn-in renderer (ASS subtitles).
 */
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { dirname, basename, resolve, extname } from 'path';
import {
  probeMediaTimeline,
  buildTimelineBurnPlan,
  buildAlignedVideoFilter,
  buildFfmpegInputFlags,
  buildFfmpegOutputSyncFlags,
  shiftAssFileTimestamps,
  parseAssDialogueTimes,
  logFfmpegTimelineDebug,
  logStreamOffsetDetected,
  logSubtitleBurnSync,
  buildSubtitleBurnSyncReport
} from './ffmpeg-timeline.js';
import {
  isHardSyncTestEnabled,
  writeHardSyncTestAss,
  probeVideoFramePtsAtSeconds,
  detectFirstSpeechSec,
  auditFfmpegInvocation,
  logBurnInputVerification,
  traceRenderTimeline,
  emitFinalRenderSyncReport
} from './render-timeline-trace.js';

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

function roundEven(value) {
  const v = Math.max(2, Math.round(Number(value) || 0));
  return v % 2 === 0 ? v : v + 1;
}

/** Debug geometry metadata only — filter chain is built separately. */
export function resolveSubtitleRenderGeometry({
  sourceWidth,
  sourceHeight,
  quality = 'fast',
  renderHints = {}
}) {
  const srcW = roundEven(sourceWidth || 1080);
  const srcH = roundEven(sourceHeight || 1920);
  const isVertical = Boolean(renderHints?.isVertical) || srcH > srcW * 1.05;
  const enc = resolveEncodeProfile(quality, renderHints);

  return {
    enc,
    isVertical,
    playResX: 1080,
    playResY: 1920,
    outputWidth: isVertical ? 1080 : srcW,
    outputHeight: isVertical ? 1920 : srcH,
    sourceWidth: srcW,
    sourceHeight: srcH,
    filters: []
  };
}

/** @deprecated use buildAlignedVideoFilter via timeline plan */
function buildVideoFilter(assName) {
  return `setpts=PTS-STARTPTS,scale=1080:1920,subtitles=${assName}`;
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
 */
export async function burnSubtitles(opts) {
  const {
    inputPath,
    assPath,
    outputPath,
    quality = 'fast',
    durationSec = 0,
    renderHints = {},
    subtitleCues = [],
    timelineTrace = null,
    jobDir = null,
    onProgress,
    signal
  } = opts;
  if (!existsSync(inputPath)) return Promise.reject(new Error('INPUT_VIDEO_MISSING'));
  if (!existsSync(assPath)) return Promise.reject(new Error('ASS_FILE_MISSING'));

  const assExt = extname(assPath).toLowerCase();
  if (assExt === '.srt') {
    return Promise.reject(new Error('SUBTITLE_FILE_IS_SRT_NOT_ASS'));
  }

  traceRenderTimeline(timelineTrace, 'burn_stage_enter', {
    burnStageInputFile: inputPath,
    burnStageOutputFile: outputPath,
    assSourceFile: assPath,
    durationSec
  });

  const framePtsAtSeek = await probeVideoFramePtsAtSeconds(inputPath, [0, 1, 2, 3, 4]);
  const speechAnchor = await detectFirstSpeechSec(inputPath);
  logBurnInputVerification(timelineTrace, inputPath, framePtsAtSeek, speechAnchor);

  const inputProbe = await probeMediaTimeline(inputPath);
  const timelinePlan = buildTimelineBurnPlan(inputProbe, subtitleCues);
  if (timelinePlan.offsetDetected) {
    logStreamOffsetDetected({
      streamOffsetSec: timelinePlan.streamOffsetSec,
      videoStart: timelinePlan.videoStart,
      audioStart: timelinePlan.audioStart,
      videoPtsShiftSec: timelinePlan.videoPtsShiftSec,
      assShiftSec: timelinePlan.assShiftSec
    });
    traceRenderTimeline(timelineTrace, 'stream_offset_at_burn_input', {
      streamOffsetSec: timelinePlan.streamOffsetSec,
      videoStart: timelinePlan.videoStart,
      audioStart: timelinePlan.audioStart
    });
  }

  let burnAssPath = assPath;
  if (isHardSyncTestEnabled() && jobDir) {
    burnAssPath = writeHardSyncTestAss(assPath, jobDir);
    traceRenderTimeline(timelineTrace, 'hard_sync_test_mode', {
      burnAssPath,
      firstDialogueStart: '0:00:00.00',
      diagnostic:
        'If subtitle still appears ~4s late in output, delay is in video timeline not ASS cue times'
    });
  } else if (Math.abs(timelinePlan.assShiftSec) > 0.001) {
    burnAssPath = shiftAssFileTimestamps(assPath, timelinePlan.assShiftSec);
    traceRenderTimeline(timelineTrace, 'ass_timeline_shift_export_only', {
      from: assPath,
      to: burnAssPath,
      assShiftSec: timelinePlan.assShiftSec
    });
  }

  traceRenderTimeline(timelineTrace, 'burn_ass_target_exact', {
    exactFileReceivingSubtitles: burnAssPath,
    generatorAssPath: assPath,
    subtitlesAppliedViaFilter: `subtitles=${basename(burnAssPath)}`
  });

  const geometry = resolveSubtitleRenderGeometry({
    sourceWidth: renderHints?.sourceWidth,
    sourceHeight: renderHints?.sourceHeight,
    quality,
    renderHints
  });
  const enc = geometry.enc;
  const hwAccel = await detectHardwareAcceleration();
  const assDir = dirname(resolve(burnAssPath));
  const assName = basename(burnAssPath);
  const vf = buildAlignedVideoFilter(assName, timelinePlan);
  const syncFlags = buildFfmpegOutputSyncFlags();
  const inputFlags = buildFfmpegInputFlags();

  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-progress',
    'pipe:2',
    ...inputFlags,
    ...(hwAccel.enabled ? ['-hwaccel', 'auto'] : []),
    '-i',
    inputPath,
    '-vf',
    vf,
    ...syncFlags.audio,
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
    ...syncFlags.mux,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    outputPath
  ];

  auditFfmpegInvocation(timelineTrace, {
    purpose: 'subtitle_burn_export',
    inputIndex: 0,
    inputs: [{ index: 0, path: inputPath, type: 'video+audio' }],
    maps: ['0:v:0', '0:a?'],
    videoFilter: vf,
    audioFilters: syncFlags.audio,
    muxFlags: syncFlags.mux,
    inputFlags,
    subtitleInputSource: `subtitles=${assName} (file: ${burnAssPath}, cwd-relative basename)`,
    filterComplex: null,
    copyts: false,
    itsoffset: 'none',
    vsync: 'cfr',
    setpts: timelinePlan.videoPtsShiftSec > 0 ? `PTS-STARTPTS-${timelinePlan.videoPtsShiftSec}/TB` : 'PTS-STARTPTS',
    asetpts: 'PTS-STARTPTS',
    scaleStage: 'scale=1080:1920 before subtitles filter',
    burnStageInputFile: inputPath,
    burnStageOutputFile: outputPath
  });

  logFfmpegTimelineDebug({
    videoStreamStartTime: timelinePlan.videoStart,
    audioStreamStartTime: timelinePlan.audioStart,
    formatStartTime: timelinePlan.formatStart,
    subtitleSourceTimingStart: timelinePlan.subtitleSourceStart,
    subtitleSourceTimingEnd: timelinePlan.subtitleSourceEnd,
    outputTimelineOffsetSec: timelinePlan.outputTimelineOffsetSec,
    streamOffsetSec: timelinePlan.streamOffsetSec,
    videoPtsShiftSec: timelinePlan.videoPtsShiftSec,
    assShiftSec: timelinePlan.assShiftSec,
    ffmpegInputOrdering: ['input_flags', 'hwaccel?', 'input', 'vf', 'af', 'maps', 'output'],
    ffmpegInputFlags: inputFlags,
    ffmpegFilters: vf,
    ffmpegAudioFilters: syncFlags.audio,
    ffmpegMuxFlags: syncFlags.mux,
    copyts: false,
    vsync: 'cfr',
    async: 'disabled',
    adelay: 'none',
    asetpts: 'PTS-STARTPTS',
    setpts: timelinePlan.videoPtsShiftSec > 0 ? `PTS-STARTPTS-${timelinePlan.videoPtsShiftSec}/TB` : 'PTS-STARTPTS',
    itsoffset: 'none',
    ignoreEditlist: true,
    presentationAnchor: timelinePlan.presentationAnchor,
    cwd: assDir,
    input: basename(inputPath),
    assFile: assName
  });

  console.log('[video-render] started', {
    quality,
    durationSec,
    encodePreset: enc.preset,
    crf: enc.crf,
    gop: enc.gop,
    maxrate: enc.maxrate,
    movflags: enc.movflags,
    vf,
    playRes: `${geometry.playResX}x${geometry.playResY}`,
    outputResolution: `${geometry.outputWidth}x${geometry.outputHeight}`,
    sourceResolution: `${geometry.sourceWidth}x${geometry.sourceHeight}`,
    hwAccel: hwAccel.enabled ? hwAccel.methods.slice(0, 3) : [],
    cwd: assDir,
    input: basename(inputPath),
    timelinePlan
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

    proc.on('close', async (code) => {
      clearInterval(stallTimer);
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (killed && code !== 0) return;

      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        console.error('[video-render] failed', { code, tail });
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
      console.log('[video-render] ffmpeg completed', { outputPath: basename(outputPath) });
      try {
        const outputProbe = await probeMediaTimeline(outputPath);
        const assDialogues = parseAssDialogueTimes(burnAssPath, 10);
        const syncReport = buildSubtitleBurnSyncReport({
          plan: timelinePlan,
          sourceCues: subtitleCues,
          assDialogues,
          outputProbe
        });
        logSubtitleBurnSync(syncReport);

        const firstCue = subtitleCues[0];
        const firstAss = assDialogues[0];
        const finalRenderSyncReport = emitFinalRenderSyncReport(timelineTrace, {
          sourceSpeechStart: speechAnchor?.firstSpeechSec ?? null,
          speechAnchorMethod: speechAnchor?.method || null,
          subtitleFirstCueStart: firstCue?.start ?? firstAss?.start ?? null,
          subtitleFirstAssBurnStart: firstAss?.start ?? null,
          burnTargetVideoStart: timelinePlan.videoStart,
          burnTargetAudioStart: timelinePlan.audioStart,
          effectiveRenderOffsetSec: Number(
            (timelinePlan.videoPtsShiftSec + timelinePlan.assShiftSec).toFixed(4)
          ),
          streamOffsetAtBurnInput: timelinePlan.streamOffsetSec,
          intermediateFileOffsets: timelineTrace?.intermediateOffsets || [],
          framePtsAtSeekBeforeBurn: framePtsAtSeek,
          hardSyncTestEnabled: isHardSyncTestEnabled(),
          hardSyncInterpretation: isHardSyncTestEnabled()
            ? 'First ASS forced to 0:00:00.00 — if output still ~4s late, video PTS/editlist is the cause'
            : null,
          burnInputAlreadyDelayed:
            framePtsAtSeek?.some((f) => f.deltaFromSeek != null && Math.abs(f.deltaFromSeek) > 0.5) ||
            Math.abs(timelinePlan.streamOffsetSec) > 0.1,
          outputStreamOffsetSec: Number(
            (
              Number(outputProbe?.video?.start_time || 0) - Number(outputProbe?.audio?.start_time || 0)
            ).toFixed(4)
          ),
          subtitleBurnSync: syncReport
        });

        if (!settled) {
          settled = true;
          resolve({
            outputPath,
            quality,
            preset: enc,
            timelinePlan,
            finalRenderSyncReport
          });
        }
        return;
      } catch (syncErr) {
        console.warn('[subtitle-burn-sync] verification skipped', syncErr?.message || syncErr);
      }
      if (!settled) {
        settled = true;
        resolve({ outputPath, quality, preset: enc, timelinePlan, finalRenderSyncReport: null });
      }
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
