/**
 * Temp directory cleanup for render jobs.
 */
import { rmSync, existsSync, unlinkSync, readdirSync, lstatSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';

const POST_DOWNLOAD_CLEANUP_MS = Number(process.env.VIDEO_RENDER_POST_DOWNLOAD_CLEANUP_MS || 10 * 60 * 1000);

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
  const cwd = process.cwd();
  const raw = String(process.env.VIDEO_RENDER_CLEANUP_PATHS || 'exports,jobs,render-artifacts').trim();
  const roots = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith('/') || /^[A-Za-z]:[\\/]/.test(part) ? part : join(cwd, part)));
  roots.unshift(tmpdir());
  return [...new Set(roots)];
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
    'finalizing'
  ]);
  return activeStages.has(job.stageKey);
}

function entryMatchesJob(entryName, job) {
  if (!job?.id) return false;
  if (entryName.includes(job.id)) return true;
  const jobBase = job.jobDir ? basename(job.jobDir) : '';
  const downloadBase = job.downloadJobDir ? basename(job.downloadJobDir) : '';
  return (jobBase && entryName === jobBase) || (downloadBase && entryName === downloadBase);
}

function purgeRootEntries(root, job) {
  if (!root || !existsSync(root)) return;
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch (err) {
    console.warn('[video-render] cleanup scan failed:', root, err?.message);
    return;
  }

  for (const entry of entries) {
    if (!entryMatchesJob(entry, job)) continue;
    const fullPath = join(root, entry);
    try {
      const st = lstatSync(fullPath);
      if (st.isDirectory()) safeRmDir(fullPath);
      else safeUnlink(fullPath);
    } catch (err) {
      console.warn('[video-render] cleanup entry failed:', fullPath, err?.message);
    }
  }
}

export function purgeJobStorage(job) {
  if (!job) return;

  console.log('[video-render] post-download cleanup', {
    jobId: job.id,
    jobDir: job.jobDir || null,
    outputPath: job.outputPath || null
  });

  safeUnlink(job.outputPath);
  safeRmDir(job.jobDir);
  safeRmDir(job.downloadJobDir);

  for (const root of resolveCleanupRoots()) {
    purgeRootEntries(root, job);
  }

  job.outputPath = null;
  job.assPath = null;
  job.exportAssPath = null;
  job.assDebugPath = null;
}

export function schedulePostDownloadCleanup(job) {
  if (!job) return;
  if (job.postDownloadCleanupTimer) {
    clearTimeout(job.postDownloadCleanupTimer);
  }

  job.downloadCompletedAt = Date.now();
  job.postDownloadCleanupTimer = setTimeout(() => {
    job.postDownloadCleanupTimer = null;
    if (isJobProcessingActive(job)) {
      console.log('[video-render] cleanup deferred — job still active', { jobId: job.id });
      return;
    }
    purgeJobStorage(job);
  }, POST_DOWNLOAD_CLEANUP_MS);
  job.postDownloadCleanupTimer.unref?.();
}

export function cleanupJobArtifacts(job) {
  if (!job) return;
  if (isJobProcessingActive(job)) return;
  purgeJobStorage(job);
}
