/**
 * Subtitle timing audit — export burn path.
 * Enable: TIMING_FORENSIC=1
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { isDebugExportEnabled } from './export-debug.js';

const DEFAULT_MAX = Math.min(
  30,
  Math.max(10, Number(process.env.TIMING_FORENSIC_MAX || 12) || 12)
);

export function isTimingForensicEnabled(sampleText = '') {
  if (!isDebugExportEnabled()) return false;
  const flag = String(process.env.TIMING_FORENSIC || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  return false;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function driftMs(a, b) {
  return Math.round((num(a) - num(b)) * 1000);
}

/**
 * @param {object} opts
 * @param {{ id?: string, text: string, start: number, end: number }[]} opts.rawInputSegments
 * @param {{ id?: string, text: string, start: number, end: number, sourceStart?: number, sourceEnd?: number }[]} opts.normalizedCues
 * @param {{ id?: string, text: string, assStart: number, assEnd: number, styleName?: string }[]} opts.assDialogues
 * @param {object} [opts.timelinePlan]
 * @param {string} [opts.jobDir]
 * @param {string} [opts.jobId]
 */
export function logTimingForensics(opts) {
  const raw = Array.isArray(opts.rawInputSegments) ? opts.rawInputSegments : [];
  const normalized = Array.isArray(opts.normalizedCues) ? opts.normalizedCues : [];
  const ass = Array.isArray(opts.assDialogues) ? opts.assDialogues : [];
  const max = DEFAULT_MAX;
  const assShiftSec = num(opts.timelinePlan?.assShiftSec, 0);

  const rows = [];
  const leadDrifts = [];
  const lagDrifts = [];

  for (let i = 0; i < max; i++) {
    const r = raw[i];
    const n = normalized[i];
    const a = ass[i];
    if (!r && !n && !a) break;

    const originalStart = num(r?.start, null);
    const originalEnd = num(r?.end, null);
    const normalizedStart = num(n?.start ?? n?.sourceStart, null);
    const normalizedEnd = num(n?.end ?? n?.sourceEnd, null);
    const finalAssStart = num(a?.assStart, null);
    const finalAssEnd = num(a?.assEnd, null);

    const startDriftMs =
      originalStart != null && finalAssStart != null
        ? driftMs(finalAssStart, originalStart)
        : null;
    const endDriftMs =
      originalEnd != null && finalAssEnd != null
        ? driftMs(finalAssEnd, originalEnd)
        : null;

    if (startDriftMs != null) {
      if (startDriftMs > 0) lagDrifts.push(startDriftMs);
      else if (startDriftMs < 0) leadDrifts.push(Math.abs(startDriftMs));
    }

    rows.push({
      index: i,
      text: String((a?.text || n?.text || r?.text || '')).slice(0, 80),
      originalStart,
      originalEnd,
      normalizedStart,
      normalizedEnd,
      finalAssStart,
      finalAssEnd,
      assShiftSecApplied: assShiftSec || undefined,
      videoFrameTime: null,
      note:
        'videoFrameTime requires ffprobe frame PTS at cue time (see render-diagnostics timelinePlan)',
      startDriftMs,
      endDriftMs,
      normalizeStartDeltaMs:
        originalStart != null && normalizedStart != null
          ? driftMs(normalizedStart, originalStart)
          : null,
      normalizeEndDeltaMs:
        originalEnd != null && normalizedEnd != null ? driftMs(normalizedEnd, originalEnd) : null
    });
  }

  const allDrifts = rows
    .flatMap((row) => [row.startDriftMs, row.endDriftMs])
    .filter((v) => v != null);
  const absDrifts = allDrifts.map((v) => Math.abs(v));

  const summary = {
    cueCount: Math.max(raw.length, normalized.length, ass.length),
    logged: rows.length,
    assShiftSec,
    averageTimingDriftMs:
      absDrifts.length > 0
        ? Math.round(absDrifts.reduce((a, b) => a + b, 0) / absDrifts.length)
        : 0,
    maximumTimingDriftMs: absDrifts.length ? Math.max(...absDrifts) : 0,
    averageSubtitleLeadMs:
      leadDrifts.length > 0
        ? Math.round(leadDrifts.reduce((a, b) => a + b, 0) / leadDrifts.length)
        : 0,
    averageSubtitleLagMs:
      lagDrifts.length > 0 ? Math.round(lagDrifts.reduce((a, b) => a + b, 0) / lagDrifts.length) : 0,
    pipelineNote:
      'Whisper timestamps → client segments → buildSourceAlignedSubtitles (merge/coalesce/stabilize) → ASS Dialogue → ffmpeg ass filter (optional assShiftSec)'
  };

  const payload = { summary, segments: rows, timelinePlan: opts.timelinePlan || null };

  console.log('[timing-forensics]', JSON.stringify(payload, null, 0));

  if (opts.jobDir) {
    try {
      mkdirSync(opts.jobDir, { recursive: true });
      writeFileSync(join(opts.jobDir, 'timing-forensics.json'), JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn('[timing-forensics] write failed:', err?.message);
    }
  }

  return payload;
}
