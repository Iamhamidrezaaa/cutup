/**
 * Temp directory cleanup for render jobs.
 * Disk deletion is owned by storage-lifecycle; this module handles guarded purge requests.
 */
import { rmSync, existsSync, unlinkSync } from 'fs';
import {
  canDeleteRenderJobStorage,
  readJobMetadata,
  markRenderJobStorageDeleted
} from '../infrastructure/storage-lifecycle.js';

export function safeRmDir(dir) {
  if (!dir || !existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn('[video-render] cleanup failed:', dir, err?.message);
  }
}

export function safeUnlink(filePath) {
  if (!filePath || !existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch (err) {
    console.warn('[video-render] cleanup failed:', filePath, err?.message);
  }
}

export function resolveCleanupRoots() {
  return [];
}

export function isJobProcessingActive(job) {
  if (!job || job.cancelled) return false;
  if (Number(job.activeStreams || 0) > 0) return true;
  const activeStages = new Set([
    'queued',
    'preparing',
    'subtitle_layout',
    'rendering',
    'muxing',
    'finalizing',
    'generating_captions'
  ]);
  return activeStages.has(job.stageKey);
}

export function purgeJobStorage(job) {
  if (!job?.jobDir) return;
  if (isJobProcessingActive(job)) {
    console.log('[video-render] cleanup deferred — job still active', { jobId: job.id });
    return;
  }

  const metadata = readJobMetadata(job.jobDir);
  if (metadata) {
    const decision = canDeleteRenderJobStorage(metadata, job.jobDir);
    if (!decision.ok) {
      console.log('[video-render] cleanup deferred — storage lifecycle', {
        jobId: job.id,
        reason: decision.reason
      });
      return;
    }
    try {
      markRenderJobStorageDeleted(job.jobDir);
    } catch {
      /* best effort */
    }
  }

  console.log('[video-render] purge job storage', {
    jobId: job.id,
    jobDir: job.jobDir
  });

  safeRmDir(job.jobDir);
  if (job.downloadJobDir && job.downloadJobDir !== job.jobDir) {
    safeRmDir(job.downloadJobDir);
  }

  job.outputPath = null;
  job.assPath = null;
  job.exportAssPath = null;
  job.assDebugPath = null;
}

export function schedulePostDownloadCleanup(job) {
  if (!job) return;
  job.downloadCompletedAt = Date.now();
  console.log('[video-render] download complete — disk retention managed by storage lifecycle', {
    jobId: job.id,
    jobDir: job.jobDir || null
  });
}

export function cleanupJobArtifacts(job) {
  purgeJobStorage(job);
}
