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
  // Preserve generated ASS and sibling export.ass for production subtitle inspection.
  if (job.assPath && existsSync(job.assPath)) return;
  if (job.exportAssPath && existsSync(job.exportAssPath)) return;
  safeRmDir(job.jobDir);
}
