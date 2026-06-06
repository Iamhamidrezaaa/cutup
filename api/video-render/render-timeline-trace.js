/**
 * Export/render pipeline timeline tracing — locate fixed subtitle delay vs preview.
 * Diagnostics only; does not alter subtitle composition or ASS generator output.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { basename, resolve } from 'path';
import { probeMediaTimeline, parseAssDialogueTimes } from './ffmpeg-timeline.js';
import { trackFfmpegStart, trackFfmpegEnd } from './ffmpeg-job-tracker.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 12 * 1024 * 1024;

export function isHardSyncTestEnabled() {
  return String(process.env.RENDER_SUBTITLE_HARD_SYNC_TEST || '').toLowerCase() === '1';
}

export function isTimelineTraceEnabled() {
  const v = String(process.env.RENDER_TIMELINE_TRACE || '1').toLowerCase();
  return v !== '0' && v !== 'false';
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {string} jobId
 * @param {string} [traceId]
 */
export function createRenderTimelineTrace(jobId, traceId = null) {
  return {
    jobId,
    traceId: traceId || jobId,
    startedAt: new Date().toISOString(),
    stages: [],
    files: {},
    subtitleSource: null,
    burnTarget: null,
    intermediateOffsets: [],
    ffmpegInvocations: []
  };
}

export function traceRenderTimeline(ctx, stage, data = {}) {
  if (!ctx || !isTimelineTraceEnabled()) return;
  const entry = {
    stage,
    at: new Date().toISOString(),
    ...data
  };
  ctx.stages.push(entry);
  console.log('[render-timeline-trace]', {
    jobId: ctx.jobId,
    traceId: ctx.traceId,
    stage,
    ...data
  });
}

/**
 * ffprobe snapshot for a file at a pipeline stage.
 */
export async function probeFileTimelineStage(filePath, label) {
  if (!filePath || !existsSync(filePath)) {
    return { label, path: filePath, missing: true };
  }
  let stat = null;
  try {
    const s = statSync(filePath);
    stat = { sizeBytes: s.size, mtimeMs: s.mtimeMs };
  } catch {
    stat = null;
  }
  try {
    const probe = await probeMediaTimeline(filePath);
    return {
      label,
      path: filePath,
      basename: basename(filePath),
      stat,
      formatDuration: probe.format?.duration,
      formatStartTime: probe.format?.start_time,
      video: probe.video,
      audio: probe.audio,
      streamOffsetSec: num(probe.video?.start_time, 0) - num(probe.audio?.start_time, 0),
      timelineStart: {
        video: num(probe.video?.start_time, 0),
        audio: num(probe.audio?.start_time, 0),
        format: num(probe.format?.start_time, 0)
      }
    };
  } catch (err) {
    return { label, path: filePath, probeError: err?.message || String(err) };
  }
}

/**
 * Frame PTS at wall-clock seek positions (detect pre-burn video delay).
 */
export async function probeVideoFramePtsAtSeconds(inputPath, seconds = [0, 1, 2, 3, 4]) {
  const out = [];
  for (const sec of seconds) {
    try {
      const interval = `${Math.max(0, sec)}%+#0.05`;
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-read_intervals',
          interval,
          '-select_streams',
          'v:0',
          '-show_frames',
          '-show_entries',
          'frame=pkt_pts_time,best_effort_timestamp_time,pict_type',
          '-of',
          'json',
          inputPath
        ],
        { timeout: 15000, maxBuffer: MAX_BUFFER }
      );
      const data = JSON.parse(stdout || '{}');
      const frames = Array.isArray(data.frames) ? data.frames : [];
      const first = frames[0] || null;
      out.push({
        seekSec: sec,
        frameCount: frames.length,
        pktPtsTime: first ? num(first.pkt_pts_time, null) : null,
        bestEffortTimestampTime: first ? num(first.best_effort_timestamp_time, null) : null,
        pictType: first?.pict_type || null,
        deltaFromSeek: first
          ? Number((num(first.best_effort_timestamp_time, first.pkt_pts_time) - sec).toFixed(4))
          : null
      });
    } catch (err) {
      out.push({ seekSec: sec, error: err?.message || String(err) });
    }
  }
  return out;
}

/**
 * First audible speech via silencedetect (waveform anchor).
 */
export async function detectFirstSpeechSec(inputPath, jobId = null) {
  const speechArgs = [
    '-hide_banner',
    '-i',
    inputPath,
    '-af',
    'silencedetect=noise=-35dB:d=0.2',
    '-f',
    'null',
    '-'
  ];
  const purpose = 'silencedetect-first-speech';
  const trackId = trackFfmpegStart(jobId, purpose, 'ffmpeg', speechArgs);
  try {
    const { stderr } = await execFileAsync('ffmpeg', speechArgs, {
      timeout: 120000,
      maxBuffer: MAX_BUFFER
    });
    const text = String(stderr || '');
    const silenceEnds = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const silenceStarts = [...text.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const firstSpeech =
      silenceStarts.length && silenceStarts[0] <= 0.05 && silenceEnds.length
        ? silenceEnds[0]
        : silenceEnds.length
          ? silenceEnds[0]
          : 0;
    return {
      firstSpeechSec: Number(firstSpeech.toFixed(4)),
      silenceEndCount: silenceEnds.length,
      silenceStartCount: silenceStarts.length,
      method: 'silencedetect'
    };
  } catch (err) {
    return { firstSpeechSec: null, error: err?.message || String(err), method: 'silencedetect' };
  } finally {
    trackFfmpegEnd(jobId, trackId, purpose);
  }
}

/**
 * Debug-only ASS copy: force first Dialogue to 0:00:00.00 (does not touch generator output).
 */
export function writeHardSyncTestAss(assPath, jobDir) {
  const raw = readFileSync(assPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let patched = false;
  const out = lines.map((line) => {
    if (patched || !line.startsWith('Dialogue:')) return line;
    const parts = line.split(',');
    if (parts.length < 10) return line;
    const end = parts[2];
    parts[1] = '0:00:00.00';
    patched = true;
    return parts.join(',');
  });
  const dest = resolve(jobDir, 'subtitles.hard-sync-test.ass');
  writeFileSync(dest, out.join('\n'), 'utf8');
  console.log('[render-timeline-trace]', {
    stage: 'hard_sync_test_ass',
    originalAss: assPath,
    burnAss: dest,
    firstDialogueForcedStart: '0:00:00.00',
    note: 'If burn still shows ~4s delay, delay is in video pipeline not ASS timestamps'
  });
  return dest;
}

export function logSubtitleBurnTarget(ctx, payload) {
  if (!ctx) return;
  ctx.subtitleSource = payload.subtitleSource || ctx.subtitleSource;
  ctx.burnTarget = payload.burnTarget || ctx.burnTarget;
  traceRenderTimeline(ctx, 'subtitle_burn_target', payload);
}

export function auditFfmpegInvocation(ctx, payload) {
  if (!ctx) return payload;
  const entry = {
    at: new Date().toISOString(),
    ...payload
  };
  ctx.ffmpegInvocations.push(entry);
  console.log('[render-timeline-trace]', {
    jobId: ctx.jobId,
    stage: 'ffmpeg_command_audit',
    inputIndex: payload.inputIndex,
    inputs: payload.inputs,
    maps: payload.maps,
    videoFilter: payload.videoFilter,
    audioFilters: payload.audioFilters,
    muxFlags: payload.muxFlags,
    inputFlags: payload.inputFlags,
    subtitleInputSource: payload.subtitleInputSource,
    filterComplex: payload.filterComplex || null,
    copyts: payload.copyts ?? false,
    itsoffset: payload.itsoffset ?? 'none'
  });
  return entry;
}

export function logBurnInputVerification(ctx, inputPath, framePts, speechAnchor) {
  traceRenderTimeline(ctx, 'burn_input_frame_probe', {
    burnInputFile: inputPath,
    framePtsAtSeek: framePts,
    speechAnchor,
    interpretation:
      framePts?.some((f) => Math.abs(f.deltaFromSeek || 0) > 0.5) || false
        ? 'video_pts_may_not_match_wall_seek'
        : 'frame_pts_align_with_seek'
  });
}

/**
 * @param {object} ctx
 * @param {object} reportParts
 */
export function emitFinalRenderSyncReport(ctx, reportParts) {
  const report = {
    jobId: ctx?.jobId,
    traceId: ctx?.traceId,
    generatedAt: new Date().toISOString(),
    hardSyncTestEnabled: isHardSyncTestEnabled(),
    stages: ctx?.stages?.map((s) => s.stage) || [],
    stageCount: ctx?.stages?.length || 0,
    files: ctx?.files || {},
    subtitleSource: ctx?.subtitleSource || null,
    burnTarget: ctx?.burnTarget || null,
    intermediateFileOffsets: ctx?.intermediateOffsets || [],
    ffmpegInvocationCount: ctx?.ffmpegInvocations?.length || 0,
    ...reportParts
  };
  console.log('[final-render-sync-report]', report);
  return report;
}

/**
 * Compare probe across pipeline stages to find where offset appears.
 */
export function diffTimelineStages(before, after) {
  if (!before?.video || !after?.video) return null;
  return {
    videoStartDelta: Number((num(after.video.start_time, 0) - num(before.video.start_time, 0)).toFixed(4)),
    audioStartDelta: Number((num(after.audio?.start_time, 0) - num(before.audio?.start_time, 0)).toFixed(4)),
    streamOffsetDelta: Number(
      (num(after.streamOffsetSec, 0) - num(before.streamOffsetSec, 0)).toFixed(4)
    ),
    formatDurationDelta: Number(
      (num(after.formatDuration, 0) - num(before.formatDuration, 0)).toFixed(4)
    )
  };
}

export async function recordFileStage(ctx, filePath, stageKey) {
  const snap = await probeFileTimelineStage(filePath, stageKey);
  if (ctx) {
    ctx.files[stageKey] = snap;
    traceRenderTimeline(ctx, stageKey, {
      file: snap.basename,
      path: filePath,
      videoDuration: snap.video?.duration,
      audioDuration: snap.audio?.duration,
      videoStart: snap.video?.start_time,
      audioStart: snap.audio?.start_time,
      streamOffsetSec: snap.streamOffsetSec,
      trimStart: null,
      trimEnd: null,
      concatStart: null,
      concatEnd: null,
      normalization: stageKey.includes('staged') ? 'copy_to_job_source_mp4' : null,
      fpsConversion: false,
      scaleStage: stageKey.includes('burn') ? 'in_ffmpeg_vf' : false
    });
  }
  return snap;
}

export function summarizeSegmentTiming(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) return null;
  const first = list[0];
  const last = list[list.length - 1];
  return {
    cueCount: list.length,
    firstCueStart: num(first?.start, null),
    firstCueEnd: num(first?.end, null),
    firstCueText: String(first?.text || '').slice(0, 60),
    lastCueEnd: num(last?.end, null)
  };
}
