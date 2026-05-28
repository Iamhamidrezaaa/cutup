/**
 * Export-time A/V timeline probe, normalization, and subtitle burn sync diagnostics.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync } from 'fs';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;
const STREAM_OFFSET_WARN_SEC = 0.1;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function streamSummary(stream) {
  if (!stream) return null;
  return {
    index: stream.index,
    codec_type: stream.codec_type,
    codec_name: stream.codec_name,
    start_time: num(stream.start_time, 0),
    start_pts: stream.start_pts != null ? num(stream.start_pts, 0) : null,
    duration: num(stream.duration, 0),
    time_base: stream.time_base || null,
    avg_frame_rate: stream.avg_frame_rate || null,
    nb_frames: stream.nb_frames != null ? num(stream.nb_frames, 0) : null
  };
}

/**
 * Full ffprobe for export timeline alignment.
 * @param {string} inputPath
 */
export async function probeMediaTimeline(inputPath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath],
    { timeout: 20000, maxBuffer: MAX_BUFFER }
  );
  const data = JSON.parse(stdout || '{}');
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((s) => s.codec_type === 'video') || null;
  const audio = streams.find((s) => s.codec_type === 'audio') || null;
  return {
    format: {
      filename: data.format?.filename || inputPath,
      duration: num(data.format?.duration, 0),
      start_time: num(data.format?.start_time, 0),
      format_name: data.format?.format_name || null
    },
    video: streamSummary(video),
    audio: streamSummary(audio),
    streams: streams.map(streamSummary).filter(Boolean)
  };
}

/**
 * Build burn plan: zero-base PTS + optional corrective shifts (audio-anchored subtitles).
 * @param {Awaited<ReturnType<typeof probeMediaTimeline>>} probe
 */
export function buildTimelineBurnPlan(probe, subtitleCues = []) {
  const videoStart = num(probe?.video?.start_time, 0);
  const audioStart = num(probe?.audio?.start_time, 0);
  const formatStart = num(probe?.format?.start_time, 0);
  const streamOffsetSec = videoStart - audioStart;
  const absOffset = Math.abs(streamOffsetSec);
  const offsetDetected = absOffset > STREAM_OFFSET_WARN_SEC;

  const firstCue = subtitleCues[0];
  const lastCue = subtitleCues[subtitleCues.length - 1];

  /** Pull video PTS earlier when video track starts after audio (common YouTube edit list). */
  const videoPtsShiftSec = streamOffsetSec > STREAM_OFFSET_WARN_SEC ? streamOffsetSec : 0;
  /** Fallback: shift ASS earlier when video normalization alone is insufficient. */
  const assShiftSec = streamOffsetSec > STREAM_OFFSET_WARN_SEC ? -streamOffsetSec : 0;

  return {
    videoStart,
    audioStart,
    formatStart,
    streamOffsetSec: Number(streamOffsetSec.toFixed(4)),
    absStreamOffsetSec: Number(absOffset.toFixed(4)),
    offsetDetected,
    videoPtsShiftSec: Number(videoPtsShiftSec.toFixed(4)),
    assShiftSec: Number(assShiftSec.toFixed(4)),
    subtitleSourceStart: firstCue ? num(firstCue.start, 0) : null,
    subtitleSourceEnd: lastCue ? num(lastCue.end, 0) : null,
    presentationAnchor: 'audio_zero',
    outputTimelineOffsetSec: 0
  };
}

export function logFfmpegTimelineDebug(payload) {
  console.log('[ffmpeg-timeline-debug]', payload);
}

export function logStreamOffsetDetected(payload) {
  console.log('[stream-offset-detected]', payload);
}

export function logSubtitleBurnSync(entries) {
  console.log('[subtitle-burn-sync]', entries);
}

/**
 * Shift ASS Dialogue timestamps (export-only alignment).
 * @param {string} assPath
 * @param {number} shiftSec negative = show earlier
 */
export function shiftAssFileTimestamps(assPath, shiftSec) {
  if (!shiftSec || Math.abs(shiftSec) < 0.001) return assPath;
  const raw = readFileSync(assPath, 'utf8');
  const shifted = shiftAssContentTimestamps(raw, shiftSec);
  const outPath = assPath.replace(/\.ass$/i, '.timeline-aligned.ass');
  writeFileSync(outPath, shifted, 'utf8');
  return outPath;
}

function parseAssTime(t) {
  const m = String(t).trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
}

function formatAssTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.min(99, Math.floor((s % 1) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function shiftAssContentTimestamps(content, shiftSec) {
  const shift = Number(shiftSec) || 0;
  if (!shift) return content;
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith('Dialogue:')) return line;
      const parts = line.split(',');
      if (parts.length < 10) return line;
      const start = parseAssTime(parts[1]);
      const end = parseAssTime(parts[2]);
      if (start == null || end == null) return line;
      parts[1] = formatAssTime(start + shift);
      parts[2] = formatAssTime(end + shift);
      return parts.join(',');
    })
    .join('\n');
}

export function parseAssDialogueTimes(assPath, limit = 10) {
  const raw = readFileSync(assPath, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('Dialogue:')) continue;
    const parts = line.split(',');
    if (parts.length < 10) continue;
    const start = parseAssTime(parts[1]);
    const end = parseAssTime(parts[2]);
    const text = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').trim();
    out.push({ start, end, text: text.slice(0, 80) });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {object} plan from buildTimelineBurnPlan
 * @param {string} assName basename for subtitles filter
 */
export function buildAlignedVideoFilter(assName, plan) {
  const parts = [];
  if (plan?.videoPtsShiftSec > 0.001) {
    parts.push(`setpts=PTS-STARTPTS-${plan.videoPtsShiftSec}/TB`);
  } else {
    parts.push('setpts=PTS-STARTPTS');
  }
  parts.push('scale=1080:1920', `subtitles=${assName}`);
  return parts.join(',');
}

export function buildFfmpegInputFlags() {
  return ['-ignore_editlist', '1', '-fflags', '+genpts'];
}

export function buildFfmpegOutputSyncFlags() {
  return {
    video: [],
    audio: ['-af', 'asetpts=PTS-STARTPTS'],
    mux: ['-vsync', 'cfr', '-max_interleave_delta', '0']
  };
}

/**
 * Post-export verification vs source cues and output stream starts.
 */
export function buildSubtitleBurnSyncReport({
  plan,
  sourceCues,
  assDialogues,
  outputProbe
}) {
  const outVideoStart = num(outputProbe?.video?.start_time, 0);
  const outAudioStart = num(outputProbe?.audio?.start_time, 0);
  const detectedStreamOffset = outVideoStart - outAudioStart;
  const burnOffsetSec = plan?.videoPtsShiftSec || 0;
  const assShiftSec = plan?.assShiftSec || 0;

  const entries = [];
  const count = Math.min(10, sourceCues.length, assDialogues.length);
  for (let i = 0; i < count; i++) {
    const src = sourceCues[i];
    const ass = assDialogues[i] || {};
    entries.push({
      text: String(src?.text || ass?.text || '').slice(0, 80),
      subtitleStart: num(src?.start, ass?.start),
      subtitleEnd: num(src?.end, ass?.end),
      assBurnStart: ass?.start ?? null,
      assBurnEnd: ass?.end ?? null,
      firstWord: null,
      lastWord: null,
      firstWordStart: null,
      lastWordEnd: null,
      finalCaptionStart: num(src?.start, ass?.start),
      finalCaptionEnd: num(src?.end, ass?.end),
      actualBurnOffsetSec: Number((burnOffsetSec + assShiftSec).toFixed(4)),
      detectedStreamOffset: Number(detectedStreamOffset.toFixed(4)),
      normalizedTimestamp: Number((num(src?.start, ass?.start) + burnOffsetSec + assShiftSec).toFixed(4)),
      driftCorrectionApplied: plan?.assShiftSec ? plan.assShiftSec : 0
    });
  }
  return entries;
}
