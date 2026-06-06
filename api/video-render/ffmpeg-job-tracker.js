/**
 * Per-export FFmpeg invocation tracking.
 */

/** @type {Map<string, { startTime: string, startMs: number, ffmpegCount: number, active: Map<string, { purpose: string, startedMs: number, command: string }> }>} */
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
      active: new Map()
    };
    exportJobs.set(jobId, rec);
  }
  return rec;
}

export function trackExportStart(jobId) {
  if (!jobId) return;
  const startTime = new Date().toISOString();
  exportJobs.set(jobId, {
    startTime,
    startMs: Date.now(),
    ffmpegCount: 0,
    active: new Map()
  });
  console.log('[export]', JSON.stringify({ jobId, startTime }));
}

export function trackExportEnd(jobId) {
  if (!jobId) return;
  const rec = exportJobs.get(jobId);
  const endTime = new Date().toISOString();
  console.log(
    '[export]',
    JSON.stringify({
      jobId,
      startTime: rec?.startTime ?? null,
      endTime,
      ffmpegCount: rec?.ffmpegCount ?? 0
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
    rec.active.set(trackId, { purpose, startedMs: Date.now(), command });
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
  rec.active.delete(trackId);
  console.log(
    '[FFMPEG END]',
    JSON.stringify({
      jobId: jobId || null,
      purpose,
      index: active ? Number(String(trackId).split(':')[0]) || null : null,
      durationMs,
      durationSec: durationMs != null ? Number((durationMs / 1000).toFixed(3)) : null,
      ffmpegCount: rec?.ffmpegCount ?? null
    })
  );
}
