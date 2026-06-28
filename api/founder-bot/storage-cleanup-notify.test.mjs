import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes } from '../infrastructure/disk-usage.js';
import {
  formatStorageCleanupMessage,
  notifyStorageCleanupIfNeeded
} from '../founder-bot/storage-cleanup-notify.js';

test('formatBytes chooses GB or MB automatically', () => {
  assert.equal(formatBytes(3.6 * 1024 ** 3), '3.6 GB');
  assert.equal(formatBytes(512 * 1024 ** 2), '512 MB');
});

test('formatStorageCleanupMessage matches founder bot layout', () => {
  const text = formatStorageCleanupMessage(
    { deletedJobs: 14, freedBytes: 3.6 * 1024 ** 3, executionMs: 184 },
    { ok: true, usedPct: 61, usedGb: 35, totalGb: 58, freeGb: 23 }
  );
  assert.match(text, /Deleted Jobs: 14/);
  assert.match(text, /Freed Space: 3\.6 GB/);
  assert.match(text, /61% \(35 GB \/ 58 GB\)/);
  assert.match(text, /Free Space:\n23 GB/);
  assert.match(text, /Execution Time:\n184 ms/);
});

test('notifyStorageCleanupIfNeeded skips when deletedJobs is zero', () => {
  const out = notifyStorageCleanupIfNeeded({ deletedJobs: 0, freedBytes: 0, executionMs: 10 });
  assert.equal(out.sent, false);
  assert.equal(out.reason, 'no_deleted_jobs');
});
