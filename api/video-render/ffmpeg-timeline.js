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
 * First-frame / seek PTS lead (edit list often hidden from stream start_time).
 * @param {import('./render-timeline-trace.js').probeVideoFramePtsAtSeconds extends Function ? Awaited<ReturnType<...>> : any[]} framePtsAtSeek
 */
export function computeFramePtsLeadSec(framePtsAtSeek) {
  if (!Array.isArray(framePtsAtSeek) || !framePtsAtSeek.length) return 0;
  const atZero = framePtsAtSeek.find((f) => f.seekSec === 0);
  const zeroPts = num(
    atZero?.bestEffortTimestampTime,
    atZero?.pktPtsTime,
    null
  );
  if (zeroPts != null && zeroPts > STREAM_OFFSET_WARN_SEC) {
    return Number(zeroPts.toFixed(4));
  }
  const deltas = framePtsAtSeek
    .map((f) => num(f.deltaFromSeek, null))
    .filter((d) => d != null && d > STREAM_OFFSET_WARN_SEC);
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Number(median.toFixed(4));
}

/**
 * Build burn plan: zero-base PTS + optional corrective shifts (audio-anchored subtitles).
 * @param {Awaited<ReturnType<typeof probeMediaTimeline>>} probe
 * @param {object[]} subtitleCues
 * @param {object} [opts]
 * @param {object[]} [opts.framePtsAtSeek]
 * @param {boolean} [opts.inputAlreadyNormalized]
 * @param {boolean} [opts.preferMinimalCorrection] source-aligned ASS — avoid guessed shifts
 * @param {number|null} [opts.firstSpeechSec] silencedetect anchor for ASS-only correction
 * @param {boolean} [opts.trustClientSubtitleTiming] skip guessed ASS shifts (preview/exportDoc timings)
 */
export function buildTimelineBurnPlan(probe, subtitleCues = [], opts = {}) {
  const {
    framePtsAtSeek = null,
    inputAlreadyNormalized = false,
    preferMinimalCorrection = false,
    firstSpeechSec = null,
    trustClientSubtitleTiming = false
  } = opts;
  const videoStart = num(probe?.video?.start_time, 0);
  const audioStart = num(probe?.audio?.start_time, 0);
  const formatStart = num(probe?.format?.start_time, 0);
  const streamOffsetSec = videoStart - audioStart;
  const absOffset = Math.abs(streamOffsetSec);
  const framePtsLeadSec = computeFramePtsLeadSec(framePtsAtSeek);
  const offsetDetected =
    absOffset > STREAM_OFFSET_WARN_SEC || framePtsLeadSec > STREAM_OFFSET_WARN_SEC;

  const firstCue = subtitleCues[0];
  const lastCue = subtitleCues[subtitleCues.length - 1];

  /**
   * Video late vs audio (positive stream offset OR positive frame PTS at t=0):
   * advance video timeline and/or pull ASS earlier.
   */
  let videoPtsShiftSec = 0;
  let assShiftSec = 0;

  if (!inputAlreadyNormalized && !trustClientSubtitleTiming) {
    const useFramePtsShift =
      String(process.env.RENDER_USE_FRAME_PTS_SHIFT || '0').toLowerCase() === '1';
    const streamLate = streamOffsetSec > STREAM_OFFSET_WARN_SEC ? streamOffsetSec : 0;
    const frameLate =
      useFramePtsShift && framePtsLeadSec > STREAM_OFFSET_WARN_SEC ? framePtsLeadSec : 0;
    const videoLateSec = preferMinimalCorrection
      ? streamLate
      : Math.max(streamLate, frameLate);

    const cueStart = firstCue ? num(firstCue.start, null) : null;
    const speech = num(firstSpeechSec, null);
    const speechLeadSec =
      cueStart != null && speech != null && speech >= 0 && cueStart - speech > 0.25
        ? Number((cueStart - speech).toFixed(4))
        : 0;

    if (speechLeadSec > 0.25 && speechLeadSec < 10) {
      const speechDelta = speech - cueStart;
      const envBlend = Number(process.env.RENDER_BURN_SPEECH_ANCHOR_BLEND);
      const anchorBlend = Number.isFinite(envBlend)
        ? Math.max(0.25, Math.min(1, envBlend))
        : speechLeadSec >= 1.2
          ? 1
          : speechLeadSec >= 0.6
            ? 0.92
            : 0.75;
      videoPtsShiftSec = 0;
      assShiftSec = Number((speechDelta * anchorBlend).toFixed(4));
      logFfmpegTimelineDebug({
        speechAnchoredAssShift: true,
        firstSpeechSec: speech,
        firstCueStart: cueStart,
        speechDeltaSec: Number(speechDelta.toFixed(4)),
        anchorBlend,
        assShiftSec,
        reason: 'Partial speech anchor — avoid pulling all cues too early'
      });
    } else if (videoLateSec > STREAM_OFFSET_WARN_SEC) {
      if (preferMinimalCorrection) {
        videoPtsShiftSec = 0;
        assShiftSec = -videoLateSec;
      } else {
        videoPtsShiftSec = videoLateSec;
        assShiftSec = 0;
      }
    } else if (!preferMinimalCorrection && streamOffsetSec < -STREAM_OFFSET_WARN_SEC) {
      assShiftSec = -streamOffsetSec;
    }
  }

  return {
    videoStart,
    audioStart,
    formatStart,
    streamOffsetSec: Number(streamOffsetSec.toFixed(4)),
    framePtsLeadSec: Number(framePtsLeadSec.toFixed(4)),
    absStreamOffsetSec: Number(absOffset.toFixed(4)),
    offsetDetected,
    videoPtsShiftSec: Number(videoPtsShiftSec.toFixed(4)),
    assShiftSec: Number(assShiftSec.toFixed(4)),
    subtitleSourceStart: firstCue ? num(firstCue.start, 0) : null,
    subtitleSourceEnd: lastCue ? num(lastCue.end, 0) : null,
    presentationAnchor: 'audio_zero',
    outputTimelineOffsetSec: 0,
    inputAlreadyNormalized: Boolean(inputAlreadyNormalized),
    skipTimelineCorrection: Boolean(inputAlreadyNormalized),
    correctionsSkippedBecauseNormalized: Boolean(inputAlreadyNormalized)
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
 * @param {string} assName basename for ass filter (cwd-relative; enables libass complex/HarfBuzz shaper)
 * @param {object} [opts]
 * @param {boolean} [opts.skipTimelineFilters] normalized CFR input — no setpts (avoids double reset)
 */
export function buildAlignedVideoFilter(assName, plan, opts = {}) {
  const parts = [];
  const skipPts = opts.skipTimelineFilters || plan?.skipTimelineCorrection;
  if (!skipPts) {
    if (plan?.videoPtsShiftSec > 0.001) {
      parts.push(`setpts=PTS-STARTPTS-${plan.videoPtsShiftSec}/TB`);
    } else {
      parts.push('setpts=PTS-STARTPTS');
    }
  }
  const w = Math.max(2, Number(opts.playResX || 1080));
  const h = Math.max(2, Number(opts.playResY || 1920));
  parts.push(`scale=${w}:${h}`, `ass=${assName}`);
  return parts.join(',');
}

export function buildFfmpegAudioFiltersForBurn(plan, opts = {}) {
  const skip = opts.skipTimelineFilters || plan?.skipTimelineCorrection;
  if (skip) return [];
  return ['-af', 'asetpts=PTS-STARTPTS'];
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
