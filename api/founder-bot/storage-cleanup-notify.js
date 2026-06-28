/**
 * Founder Bot — Telegram notification after storage lifecycle cleanup.
 */
import { queueTelegramMessage } from './telegram.js';
import { CUTUP_STORAGE_ROOT } from '../infrastructure/storage-lifecycle.js';
import { formatBytes, getDiskUsageForPath } from '../infrastructure/disk-usage.js';

export function formatStorageCleanupMessage(cleanupResult, disk = {}) {
  const deletedJobs = Number(cleanupResult?.deletedJobs || 0);
  const freedSpace = formatBytes(cleanupResult?.freedBytes || 0);
  const executionMs = Number(cleanupResult?.executionMs || 0);

  const diskLines = disk?.ok
    ? [
        'Disk Usage:',
        `${disk.usedPct}% (${disk.usedGb} GB / ${disk.totalGb} GB)`,
        '',
        'Free Space:',
        `${disk.freeGb} GB`
      ]
    : ['Disk Usage:', disk?.label || 'Unavailable'];

  return [
    '🧹 Storage Cleanup',
    '',
    `Deleted Jobs: ${deletedJobs}`,
    `Freed Space: ${freedSpace}`,
    '',
    ...diskLines,
    '',
    'Execution Time:',
    `${executionMs} ms`
  ].join('\n');
}

/**
 * Send one Telegram message per cleanup cycle when jobs were deleted.
 * Never throws — notification failures must not interrupt cleanup.
 */
export function notifyStorageCleanupIfNeeded(cleanupResult) {
  try {
    if (!cleanupResult || cleanupResult.skipped) return { sent: false, reason: 'skipped' };
    if (Number(cleanupResult.deletedJobs || 0) <= 0) {
      return { sent: false, reason: 'no_deleted_jobs' };
    }

    const disk = getDiskUsageForPath(CUTUP_STORAGE_ROOT);
    const text = formatStorageCleanupMessage(cleanupResult, disk);
    queueTelegramMessage(text);
    return { sent: true, deletedJobs: cleanupResult.deletedJobs };
  } catch (err) {
    console.warn('[storage-cleanup-notify]', err?.message || String(err));
    return { sent: false, reason: 'notify_failed' };
  }
}
