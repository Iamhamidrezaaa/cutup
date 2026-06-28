import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  canDeleteRenderJobStorage,
  createRenderJobStorage,
  markRenderJobStorageCompleted,
  markRenderJobStorageFailed,
  metadataPath,
  runStorageLifecycleCleanup,
  mapRenderStageToStorageStatus
} from './storage-lifecycle.js';

test('createRenderJobStorage creates standard layout + metadata', () => {
  const prev = process.env.CUTUP_STORAGE_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'cutup-slm-test-'));
  process.env.CUTUP_STORAGE_ROOT = root;

  try {
    const layout = createRenderJobStorage({ jobId: 'vr_test123', userId: 'user-1' });
    assert.equal(existsSync(metadataPath(layout.root)), true);
    assert.equal(existsSync(layout.input), true);
    assert.equal(existsSync(layout.audio), true);
    assert.equal(existsSync(layout.subtitles), true);
    assert.equal(existsSync(layout.output), true);
    assert.equal(existsSync(layout.logs), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CUTUP_STORAGE_ROOT;
    else process.env.CUTUP_STORAGE_ROOT = prev;
  }
});

test('only completed expired jobs are deletable', () => {
  const jobRoot = '/tmp/job';
  assert.equal(canDeleteRenderJobStorage({ status: 'running' }, jobRoot).ok, false);
  assert.equal(canDeleteRenderJobStorage({ status: 'queued' }, jobRoot).ok, false);
  assert.equal(canDeleteRenderJobStorage({ status: 'failed', hasDiagnostics: false }, jobRoot).ok, false);
  assert.equal(
    canDeleteRenderJobStorage(
      { status: 'completed', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      jobRoot
    ).ok,
    false
  );
  assert.equal(
    canDeleteRenderJobStorage(
      { status: 'completed', expiresAt: new Date(Date.now() - 60_000).toISOString() },
      jobRoot
    ).ok,
    true
  );
});

test('markRenderJobStorageCompleted sets 2h expiry', () => {
  const prev = process.env.CUTUP_STORAGE_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'cutup-slm-test-'));
  process.env.CUTUP_STORAGE_ROOT = root;
  process.env.CUTUP_JOB_EXPIRY_MS = String(2 * 60 * 60 * 1000);

  try {
    const layout = createRenderJobStorage({ jobId: 'vr_expiry', userId: 'u1' });
    const meta = markRenderJobStorageCompleted(layout.root);
    const expiresMs = Date.parse(meta.expiresAt);
    const completedMs = Date.parse(meta.renderCompletedAt);
    assert.equal(meta.status, 'completed');
    assert.ok(expiresMs - completedMs >= 2 * 60 * 60 * 1000 - 1000);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CUTUP_STORAGE_ROOT;
    else process.env.CUTUP_STORAGE_ROOT = prev;
  }
});

test('runStorageLifecycleCleanup deletes expired completed job', async () => {
  const prevRoot = process.env.CUTUP_STORAGE_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'cutup-slm-test-'));
  process.env.CUTUP_STORAGE_ROOT = root;

  try {
    const layout = createRenderJobStorage({ jobId: 'vr_delete_me', userId: 'u1' });
    writeFileSync(
      metadataPath(layout.root),
      JSON.stringify({
        jobId: 'vr_delete_me',
        userId: 'u1',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'completed',
        cleanupStatus: 'active'
      }),
      'utf8'
    );
    const result = await runStorageLifecycleCleanup();
    assert.equal(result.deletedJobs, 1);
    assert.equal(existsSync(layout.root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CUTUP_STORAGE_ROOT;
    else process.env.CUTUP_STORAGE_ROOT = prevRoot;
  }
});

test('mapRenderStageToStorageStatus maps render stages', () => {
  assert.equal(mapRenderStageToStorageStatus('queued'), 'queued');
  assert.equal(mapRenderStageToStorageStatus('rendering'), 'running');
  assert.equal(mapRenderStageToStorageStatus('ready_to_download'), 'completed');
  assert.equal(mapRenderStageToStorageStatus('failed'), 'failed');
});

test('failed jobs with diagnostics are preserved', async () => {
  const prev = process.env.CUTUP_STORAGE_ROOT;
  const root = mkdtempSync(join(tmpdir(), 'cutup-slm-test-'));
  process.env.CUTUP_STORAGE_ROOT = root;

  try {
    const layout = createRenderJobStorage({ jobId: 'vr_failed', userId: 'u1' });
    mkdirSync(layout.logs, { recursive: true });
    writeFileSync(join(layout.logs, 'render-diagnostics.json'), '{}', 'utf8');
    markRenderJobStorageFailed(layout.root, { error: 'boom', hasDiagnostics: true });
    const result = await runStorageLifecycleCleanup();
    assert.equal(result.deletedJobs, 0);
    assert.equal(existsSync(layout.root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CUTUP_STORAGE_ROOT;
    else process.env.CUTUP_STORAGE_ROOT = prev;
  }
});
