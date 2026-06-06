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
  buildFfmpegAudioFiltersForBurn,
  buildFfmpegInputFlags,
  buildFfmpegOutputSyncFlags,
  shiftAssFileTimestamps,
  parseAssDialogueTimes,
  logFfmpegTimelineDebug,
  logStreamOffsetDetected,
  logSubtitleBurnSync,
  buildSubtitleBurnSyncReport
} from './ffmpeg-timeline.js';
import { runRtlBurnForensics } from './rtl-burn-forensics.js';
import { resolveVideoEncoder, buildVideoEncodeArgs, isNvencCodec } from './video-encoder.js';
import {
  isHardSyncTestEnabled,
  isDebugExportEnabled,
  writeHardSyncTestAss,
  probeVideoFramePtsAtSeconds,
  detectFirstSpeechSec,
  auditFfmpegInvocation,
  logBurnInputVerification,
  traceRenderTimeline,
  emitFinalRenderSyncReport
} from './render-timeline-trace.js';
import { trackFfmpegStart, trackFfmpegEnd } from './ffmpeg-job-tracker.js';

const execFileAsync = promisify(execFile);
const RENDER_TIMEOUT_MS = Number(process.env.VIDEO_RENDER_TIMEOUT_MS || 600000);
const RENDER_STALL_MS = Number(process.env.VIDEO_RENDER_STALL_MS || 45000);
const MAX_BUFFER = 8 * 1024 * 1024;
const HWACCEL_AUTO = String(process.env.VIDEO_RENDER_HWACCEL_AUTO || '1') !== '0';
let hwAccelProbePromise = null;

export const ENCODE_PRESETS = {
  fast: {
    preset: 'ultrafast',
    crf: 27,
    maxWidth: 720,
    audioBitrate: '128k',
    gop: 48,
    label: 'Fast preview'
  },
  hq: {
    preset: 'veryfast',
    crf: 20,
    maxWidth: null,
    audioBitrate: '192k',
    gop: 60,
    label: 'High quality'
  }
};

/** Vertical export output (TikTok 9:16). Fast preview = 720p, HQ = 1080p. */
export function resolveExportOutputSize(quality = 'fast') {
  if (quality === 'hq') {
    return { width: 1080, height: 1920 };
  }
  return { width: 720, height: 1280 };
}

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
    if (quality !== 'hq') {
      const fastOut = resolveExportOutputSize('fast');
      enc.maxWidth = Math.min(Number(enc.maxWidth || fastOut.width), fastOut.width);
    }
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
  const isHorizontal = srcW > srcH * 1.15;
  const enc = resolveEncodeProfile(quality, renderHints);
  const exportSize = resolveExportOutputSize(quality);
  const playResX = isVertical ? exportSize.width : srcW;
  const playResY = isVertical ? exportSize.height : srcH;

  return {
    enc,
    isVertical,
    isHorizontal,
    playResX,
    playResY,
    outputWidth: isVertical ? exportSize.width : srcW,
    outputHeight: isVertical ? exportSize.height : srcH,
    sourceWidth: srcW,
    sourceHeight: srcH,
    filters: []
  };
}

/** @deprecated use buildAlignedVideoFilter via timeline plan */
function buildVideoFilter(assName) {
  return `setpts=PTS-STARTPTS,scale=1080:1920,ass=${assName}`;
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
    jobId = null,
    jobDir = null,
    inputAlreadyNormalized = false,
    trustPreviewTimings = false,
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
    durationSec,
    inputAlreadyNormalized,
    note: inputAlreadyNormalized
      ? 'Burn targets normalized.cfr.mp4 only'
      : 'WARNING: burning non-normalized source'
  });

  const framePtsAtSeek = isDebugExportEnabled()
    ? await probeVideoFramePtsAtSeconds(inputPath, [0, 1, 2, 3, 4])
    : null;
  const speechAnchor = isDebugExportEnabled()
    ? await detectFirstSpeechSec(inputPath, jobId)
    : null;
  if (isDebugExportEnabled()) {
    logBurnInputVerification(timelineTrace, inputPath, framePtsAtSeek, speechAnchor);
  }
  const inputProbe = await probeMediaTimeline(inputPath);
  const preferMinimalCorrection =
    trustPreviewTimings ||
    String(process.env.RENDER_BURN_USE_SOURCE_TIMINGS ?? '1').toLowerCase() !== '0';
  const timelinePlan = buildTimelineBurnPlan(inputProbe, subtitleCues, {
    framePtsAtSeek,
    inputAlreadyNormalized,
    preferMinimalCorrection,
    firstSpeechSec: trustPreviewTimings ? null : speechAnchor?.firstSpeechSec ?? null,
    trustClientSubtitleTiming: trustPreviewTimings
  });
  if (trustPreviewTimings) {
    timelinePlan.assShiftSec = 0;
    timelinePlan.videoPtsShiftSec = 0;
  }
  if (timelinePlan.offsetDetected && isDebugExportEnabled()) {
    logStreamOffsetDetected({
      streamOffsetSec: timelinePlan.streamOffsetSec,
      framePtsLeadSec: timelinePlan.framePtsLeadSec,
      videoStart: timelinePlan.videoStart,
      audioStart: timelinePlan.audioStart,
      videoPtsShiftSec: timelinePlan.videoPtsShiftSec,
      assShiftSec: timelinePlan.assShiftSec,
      skipTimelineCorrection: timelinePlan.skipTimelineCorrection
    });
    traceRenderTimeline(timelineTrace, 'stream_offset_at_burn_input', {
      streamOffsetSec: timelinePlan.streamOffsetSec,
      framePtsLeadSec: timelinePlan.framePtsLeadSec,
      videoStart: timelinePlan.videoStart,
      audioStart: timelinePlan.audioStart,
      inputAlreadyNormalized
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
  } else if (!trustPreviewTimings && !timelinePlan.skipTimelineCorrection && Math.abs(timelinePlan.assShiftSec) > 0.001) {
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
    subtitlesAppliedViaFilter: `ass=${basename(burnAssPath)}`
  });

  const geometry = resolveSubtitleRenderGeometry({
    sourceWidth: renderHints?.sourceWidth,
    sourceHeight: renderHints?.sourceHeight,
    quality,
    renderHints
  });
  const enc = geometry.enc;
  const videoCodec = resolveVideoEncoder();
  const burnHwAccel =
    String(process.env.VIDEO_RENDER_HWACCEL_ON_BURN || '0').toLowerCase() === '1' ||
    isNvencCodec(videoCodec);
  const hwAccel = burnHwAccel ? await detectHardwareAcceleration() : { enabled: false };
  const nvencCudaDecode =
    isNvencCodec(videoCodec) &&
    String(process.env.VIDEO_RENDER_NVENC_CUDA_DECODE || '1').toLowerCase() !== '0';
  const assDir = dirname(resolve(burnAssPath));
  const assName = basename(burnAssPath);
  const skipTimelineFilters = Boolean(timelinePlan.skipTimelineCorrection);
  const vf = buildAlignedVideoFilter(assName, timelinePlan, {
    skipTimelineFilters,
    playResX: geometry.playResX,
    playResY: geometry.playResY
  });
  const audioFilters = buildFfmpegAudioFiltersForBurn(timelinePlan, { skipTimelineFilters });
  const syncFlags = buildFfmpegOutputSyncFlags();
  const inputFlags = buildFfmpegInputFlags();

  const args = [
    '-hide_banner',
    '-y',
    '-nostats',
    '-progress',
    'pipe:2',
    ...inputFlags,
    ...(nvencCudaDecode && hwAccel.methods?.includes('cuda') ? ['-hwaccel', 'cuda'] : []),
    ...(hwAccel.enabled && !nvencCudaDecode ? ['-hwaccel', 'auto'] : []),
    '-i',
    inputPath,
    '-vf',
    vf,
    ...audioFilters,
    ...buildVideoEncodeArgs(videoCodec, enc, quality),
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
    '-r',
    String(Math.max(15, Math.min(60, Number(process.env.RENDER_NORMALIZE_CFR_FPS || 30)))),
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
    audioFilters,
    muxFlags: syncFlags.mux,
    inputFlags,
    subtitleInputSource: `ass=${assName} (file: ${burnAssPath}, cwd-relative basename)`,
    filterComplex: null,
    copyts: false,
    itsoffset: 'none',
    vsync: 'cfr',
    setpts: timelinePlan.videoPtsShiftSec > 0 ? `PTS-STARTPTS-${timelinePlan.videoPtsShiftSec}/TB` : 'PTS-STARTPTS',
    asetpts: 'PTS-STARTPTS',
    scaleStage: `scale=${geometry.playResX}:${geometry.playResY} before ass filter (PlayRes in ASS handles layout)`,
    burnStageInputFile: inputPath,
    burnStageOutputFile: outputPath
  });

  if (isDebugExportEnabled()) {
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
    ffmpegAudioFilters: audioFilters,
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
  }

  const burnAssAbsolute = resolve(burnAssPath);
  const ffmpegCommandExact = ['ffmpeg', ...args]
    .map((part) => {
      const s = String(part);
      return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
    })
    .join(' ');

  if (isDebugExportEnabled()) {
    console.log('[video-render] ffmpeg-burn-ass-path', { burnAssAbsolute });
    console.log('[video-render] ffmpeg-command-exact', {
      cwd: resolve(assDir),
      burnAssAbsolute,
      command: ffmpegCommandExact
    });
  }

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

  if (jobDir && isDebugExportEnabled()) {
    await runRtlBurnForensics({
      burnAssPath: burnAssAbsolute,
      jobDir,
      generatorAssPath: assPath,
      ffmpegCommandExact,
      ffmpegCwd: resolve(assDir)
    });
  }

  if (isDebugExportEnabled()) {
    console.log('[ffmpeg-video-filter]\n' + vf);
  }

  const burnPurpose = 'subtitle-burn-export';
  const burnTrackId = trackFfmpegStart(jobId, burnPurpose, 'ffmpeg', args, resolve(assDir));
  let burnTrackEnded = false;
  const endBurnTrack = () => {
    if (burnTrackEnded) return;
    burnTrackEnded = true;
    trackFfmpegEnd(jobId, burnTrackId, burnPurpose);
  };

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
      endBurnTrack();
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
      if (clamped >= 97 && currentPhase === 'rendering') {
        phase = 'muxing';
      }

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
      endBurnTrack();
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
        endBurnTrack();
        if (!settled) reject(new Error(tail || `FFmpeg exited with code ${code}`));
        return;
      }
      if (!existsSync(outputPath)) {
        endBurnTrack();
        if (!settled) reject(new Error('FFMPEG_OUTPUT_MISSING'));
        return;
      }
      endBurnTrack();
      onProgress?.({
        pct: 100,
        etaSec: 0,
        renderedSec: durationSec || null,
        speed: ffSpeed,
        fps: ffFps,
        phase: 'finalizing'
      });
      console.log('[video-render] ffmpeg completed', { outputPath: basename(outputPath) });
      let finalRenderSyncReport = null;
      if (isDebugExportEnabled()) {
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
          finalRenderSyncReport = emitFinalRenderSyncReport(timelineTrace, {
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
        } catch (syncErr) {
          console.warn('[subtitle-burn-sync] verification skipped', syncErr?.message || syncErr);
        }
      }
      if (!settled) {
        settled = true;
        resolve({
          outputPath,
          quality,
          preset: enc,
          timelinePlan,
          finalRenderSyncReport,
          burnAssPath: burnAssAbsolute,
          ffmpegCommandExact,
          ffmpegCwd: resolve(assDir)
        });
      }
    });
  });
}

export { normalizeVideoForBurn, probeSourceVideoTiming, verifyNormalizedBurnSync } from './normalize-timeline.js';

export async function checkFfmpegAvailable() {
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000, maxBuffer: 65536 });
    return true;
  } catch {
    return false;
  }
}
