/**
 * OS disk usage helpers — statfs-based, shared by Founder Bot and storage lifecycle.
 */
import { statfsSync } from 'fs';

function resolveStatPath(path) {
  const raw = String(path || '').trim();
  if (process.platform === 'win32') {
    if (/^[A-Za-z]:[\\/]/.test(raw)) return raw.slice(0, 3);
    return process.cwd().slice(0, 3);
  }
  return raw || '/';
}

export function getDiskUsageForPath(path = '/') {
  try {
    const target = resolveStatPath(path);
    const s = statfsSync(target);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bfree) * Number(s.bsize);
    const used = Math.max(0, total - free);
    const usedPct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    const toGb = (n) => Math.round((n / 1024 / 1024 / 1024) * 10) / 10;
    return {
      ok: true,
      path: target,
      usedPct,
      usedGb: toGb(used),
      freeGb: toGb(free),
      totalGb: toGb(total),
      usedBytes: used,
      freeBytes: free,
      totalBytes: total
    };
  } catch (err) {
    return { ok: false, label: err?.message || 'Unavailable' };
  }
}

export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1024 ** 3) {
    const gb = n / 1024 ** 3;
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  }
  if (n >= 1024 ** 2) {
    const mb = n / 1024 ** 2;
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  if (n >= 1024) {
    const kb = n / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  return `${Math.round(n)} B`;
}
