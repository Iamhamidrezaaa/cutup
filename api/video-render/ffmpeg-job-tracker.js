/**
 * Per-export FFmpeg invocation tracking.
 */

/** @type {Map<string, { startTime: string, startMs: number, ffmpegCount: number, ffmpegLog: Array<{ index: number, purpose: string, durationMs: number, durationSec: number }>, active: Map<string, { purpose: string, startedMs: number, command: string, index: number }> }>} */
const exportJobs = new Map();

export function formatFfmpegCommand(binary, args = [], cwd = null) {
  const parts = [binary, ...args].map((part) => {
    const s = String(part);
    return /[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  });
  const cmd = parts.join(' ');
  return cwd ? `(cwd=${cwd}) ${cmd}` : cmd;
}

function ensureJobRecord(jobId) {
  if (!jobId) return null;
  let rec = exportJobs.get(jobId);
  if (!rec) {
    rec = {
      startTime: new Date().toISOString(),
      startMs: Date.now(),
      ffmpegCount: 0,
      ffmpegLog: [],
      active: new Map()
    };
    exportJobs.set(jobId, rec);
  }
  return rec;
}

function formatDurationSec(durationMs) {
  return `${(durationMs / 1000).toFixed(3)}s`;
}

function printExportSummary(jobId, rec, endTime) {
  const lines = [
    '=========================',
    'EXPORT SUMMARY',
    '=========================',
    '',
    `jobId: ${jobId}`,
    ''
  ];

  const log = rec?.ffmpegLog || [];
  if (!log.length) {
    lines.push('(no ffmpeg invocations recorded)', '');
  } else {
    for (const entry of log) {
      lines.push(`FFMPEG #${entry.index}`);
      lines.push(`purpose: ${entry.purpose}`);
      lines.push(`duration: ${formatDurationSec(entry.durationMs)}`);
      lines.push('');
    }
  }

  const totalFfmpegMs = log.reduce((sum, entry) => sum + entry.durationMs, 0);
  const exportDurationMs = rec?.startMs ? Date.now() - rec.startMs : 0;

  lines.push('TOTAL:');
  lines.push(`ffmpeg invocations: ${log.length}`);
  lines.push(`ffmpeg time: ${formatDurationSec(totalFfmpegMs)}`);
  lines.push(`export wall time: ${formatDurationSec(exportDurationMs)}`);
  lines.push(`startTime: ${rec?.startTime ?? 'unknown'}`);
  lines.push(`endTime: ${endTime}`);
  lines.push('=========================');

  console.log(lines.join('\n'));
}

export function trackExportStart(jobId) {
  if (!jobId) return;
  const startTime = new Date().toISOString();
  exportJobs.set(jobId, {
    startTime,
    startMs: Date.now(),
    ffmpegCount: 0,
    ffmpegLog: [],
    active: new Map()
  });
  console.log('[export]', JSON.stringify({ jobId, startTime }));
}

export function trackExportEnd(jobId) {
  if (!jobId) return;
  const rec = exportJobs.get(jobId);
  const endTime = new Date().toISOString();
  printExportSummary(jobId, rec, endTime);
  console.log(
    '[export]',
    JSON.stringify({
      jobId,
      startTime: rec?.startTime ?? null,
      endTime,
      ffmpegCount: rec?.ffmpegLog?.length ?? rec?.ffmpegCount ?? 0
    })
  );
  exportJobs.delete(jobId);
}

/**
 * @returns {string} trackId for trackFfmpegEnd
 */
export function trackFfmpegStart(jobId, purpose, binary, args = [], cwd = null) {
  const command = formatFfmpegCommand(binary, args, cwd);
  const rec = ensureJobRecord(jobId);
  const index = rec ? ++rec.ffmpegCount : null;
  const trackId = `${index ?? 'na'}:${purpose}:${Date.now()}`;
  if (rec) {
    rec.active.set(trackId, { purpose, startedMs: Date.now(), command, index: index ?? 0 });
  }
  console.log(
    '[FFMPEG START]',
    JSON.stringify({
      jobId: jobId || null,
      purpose,
      index,
      command
    })
  );
  return trackId;
}

export function trackFfmpegEnd(jobId, trackId, purpose) {
  const rec = jobId ? exportJobs.get(jobId) : null;
  const active = rec?.active?.get(trackId);
  if (!active) return;
  const durationMs = Date.now() - active.startedMs;
  const durationSec = Number((durationMs / 1000).toFixed(3));
  rec.active.delete(trackId);
  if (rec) {
    rec.ffmpegLog.push({
      index: active.index,
      purpose: active.purpose || purpose,
      durationMs,
      durationSec
    });
  }
  console.log(
    '[FFMPEG END]',
    JSON.stringify({
      jobId: jobId || null,
      purpose,
      index: active.index,
      durationMs,
      durationSec,
      ffmpegCount: rec?.ffmpegCount ?? null
    })
  );
}
