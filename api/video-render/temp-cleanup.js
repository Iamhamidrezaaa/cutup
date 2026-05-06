/**
 * Temp directory cleanup for render jobs.
 */
import { rmSync, existsSync } from 'fs';

export function safeRmDir(dir) {
  if (!dir || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn('[video-render] cleanup failed:', dir, err?.message);
  }
}

export function cleanupJobArtifacts(job) {
  if (!job) return;
  safeRmDir(job.jobDir);
  if (job.assPath && job.assPath !== job.jobDir) {
    try {
      if (existsSync(job.assPath)) rmSync(job.assPath, { force: true });
    } catch {
      /* noop */
    }
  }
}
