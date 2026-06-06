/**
 * Per-export job stage wall-clock timings (single summary block at job end).
 */

/** @type {Map<string, { startedMs: number, stages: Record<string, number>, active: Map<string, number> }>} */
const jobs = new Map();

const STAGE_KEYS = [
  'download_ytdlp_raw',
  'normalize_staged_copy',
  'transcription',
  'translation',
  'caption_generation',
  'ass_generation',
  'subtitle_burn_export',
  'upload_final_mp4'
];

function ensure(jobId) {
  if (!jobId) return null;
  let rec = jobs.get(jobId);
  if (!rec) {
    rec = {
      startedMs: Date.now(),
      stages: Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])),
      active: new Map()
    };
    jobs.set(jobId, rec);
  }
  return rec;
}

export function initExportStageTimings(jobId, upstreamMs = {}) {
  const rec = ensure(jobId);
  if (!rec) return;
  rec.startedMs = Date.now();
  for (const key of STAGE_KEYS) rec.stages[key] = 0;
  rec.active.clear();
  if (upstreamMs && typeof upstreamMs === 'object') {
    if (Number(upstreamMs.transcriptionMs) > 0) {
      rec.stages.transcription = Math.round(Number(upstreamMs.transcriptionMs));
    }
    if (Number(upstreamMs.translationMs) > 0) {
      rec.stages.translation = Math.round(Number(upstreamMs.translationMs));
    }
    if (Number(upstreamMs.captionGenerationMs) > 0) {
      rec.stages.caption_generation = Math.round(Number(upstreamMs.captionGenerationMs));
    }
  }
}

export function beginExportStage(jobId, key) {
  const rec = ensure(jobId);
  if (!rec || !STAGE_KEYS.includes(key)) return;
  rec.active.set(key, Date.now());
}

export function endExportStage(jobId, key) {
  const rec = ensure(jobId);
  if (!rec || !STAGE_KEYS.includes(key)) return;
  const started = rec.active.get(key);
  if (started == null) return;
  rec.active.delete(key);
  rec.stages[key] += Math.max(0, Date.now() - started);
}

export function addExportStageMs(jobId, key, ms) {
  const rec = ensure(jobId);
  if (!rec || !STAGE_KEYS.includes(key)) return;
  const n = Math.round(Number(ms) || 0);
  if (n > 0) rec.stages[key] += n;
}

function formatSec(ms) {
  const sec = Math.max(0, Number(ms) || 0) / 1000;
  return `${sec.toFixed(1)}s`;
}

export function printExportStageTimings(jobId) {
  const rec = jobs.get(jobId);
  if (!rec) return;

  for (const key of rec.active.keys()) {
    endExportStage(jobId, key);
  }

  const s = rec.stages;
  const captionMs = s.caption_generation + s.ass_generation;
  const totalMs =
    s.download_ytdlp_raw +
    s.normalize_staged_copy +
    s.transcription +
    s.translation +
    captionMs +
    s.subtitle_burn_export +
    s.upload_final_mp4;

  const lines = [
    'STAGE TIMINGS',
    `download: ${formatSec(s.download_ytdlp_raw)}`,
    `normalize: ${formatSec(s.normalize_staged_copy)}`,
    `transcription: ${formatSec(s.transcription)}`,
    `translation: ${formatSec(s.translation)}`,
    `caption generation: ${formatSec(captionMs)}`,
    `burn export: ${formatSec(s.subtitle_burn_export)}`,
    `upload: ${formatSec(s.upload_final_mp4)}`,
    '',
    `TOTAL: ${formatSec(totalMs)}`
  ];

  console.log(lines.join('\n'));
  jobs.delete(jobId);
}
