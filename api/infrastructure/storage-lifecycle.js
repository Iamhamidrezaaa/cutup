/**
 * CutUp Storage Lifecycle Manager — standardized temp storage, expiration, cleanup.
 * Does not alter subtitle/render logic; only paths, metadata, and retention.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync
} from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';

export const CUTUP_STORAGE_ROOT = process.env.CUTUP_STORAGE_ROOT || join(tmpdir(), 'cutup');
export const JOB_EXPIRY_MS = Number(process.env.CUTUP_JOB_EXPIRY_MS || 2 * 60 * 60 * 1000);
export const DIAGNOSTICS_RETENTION_MS = Number(
  process.env.CUTUP_DIAGNOSTICS_RETENTION_MS || 30 * 24 * 60 * 60 * 1000
);
export const CLEANUP_INTERVAL_MS = Number(process.env.CUTUP_CLEANUP_INTERVAL_MS || 10 * 60 * 1000);

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const TERMINAL_PROTECTED_STATUSES = new Set(['failed', 'cancelled']);

const JOB_SUBDIRS = ['input', 'audio', 'subtitles', 'output', 'logs'];
const DIAGNOSTIC_KINDS = ['asr', 'subtitle-integrity'];

let schedulerHandle = null;
let cleanupRunning = false;

function sanitizeId(value, fallback = 'unknown') {
  const id = String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
  return id || fallback;
}

function jobFolderName(jobId) {
  const id = sanitizeId(jobId);
  return id.startsWith('job_') ? id : `job_${id}`;
}

export function getJobsRoot() {
  return join(CUTUP_STORAGE_ROOT, 'jobs');
}

export function getDiagnosticsRoot() {
  return join(CUTUP_STORAGE_ROOT, 'diagnostics');
}

export function jobStorageRoot(jobId) {
  return join(getJobsRoot(), jobFolderName(jobId));
}

export function metadataPath(jobRoot) {
  return join(jobRoot, 'metadata.json');
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, data) {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function readJobMetadata(jobRoot) {
  if (!jobRoot || !existsSync(metadataPath(jobRoot))) return null;
  return readJsonFile(metadataPath(jobRoot));
}

export function writeJobMetadata(jobRoot, metadata) {
  if (!jobRoot) return null;
  mkdirSync(jobRoot, { recursive: true });
  writeJsonFile(metadataPath(jobRoot), metadata);
  return metadata;
}

export function patchJobMetadata(jobRoot, patch = {}) {
  const current = readJobMetadata(jobRoot) || {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  return writeJobMetadata(jobRoot, next);
}

/**
 * Standard layout under /tmp/cutup/jobs/job_xxx/
 */
export function getJobStorageLayout(jobRoot) {
  const structured = Boolean(jobRoot && existsSync(metadataPath(jobRoot)));
  if (structured) {
    return {
      root: jobRoot,
      input: join(jobRoot, 'input'),
      audio: join(jobRoot, 'audio'),
      subtitles: join(jobRoot, 'subtitles'),
      output: join(jobRoot, 'output'),
      logs: join(jobRoot, 'logs'),
      structured: true
    };
  }
  return {
    root: jobRoot,
    input: jobRoot,
    audio: jobRoot,
    subtitles: jobRoot,
    output: jobRoot,
    logs: jobRoot,
    structured: false
  };
}

export function resolveJobStoragePath(jobRoot, category, filename) {
  const layout = getJobStorageLayout(jobRoot);
  const dir = layout[category] || layout.root;
  return join(dir, filename);
}

/**
 * Create render job storage + metadata.json
 */
export function createRenderJobStorage({ jobId, userId = null, userEmail = null }) {
  const root = jobStorageRoot(jobId);
  const layout = {
    root,
    input: join(root, 'input'),
    audio: join(root, 'audio'),
    subtitles: join(root, 'subtitles'),
    output: join(root, 'output'),
    logs: join(root, 'logs')
  };

  for (const dir of Object.values(layout)) {
    mkdirSync(dir, { recursive: true });
  }

  const metadata = {
    jobId,
    userId: userId || null,
    userEmail: userEmail || null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    status: 'queued',
    cleanupStatus: 'active',
    renderCompletedAt: null,
    hasDiagnostics: false
  };
  writeJobMetadata(root, metadata);
  return layout;
}

export function mapRenderStageToStorageStatus(stageKey) {
  const stage = String(stageKey || '').toLowerCase();
  if (stage === 'queued') return 'queued';
  if (stage === 'failed') return 'failed';
  if (stage === 'cancelled') return 'cancelled';
  if (stage === 'ready_to_download' || stage === 'completed') return 'completed';
  return 'running';
}

export function syncRenderJobStorageStatus(job) {
  if (!job?.jobDir || !job?.id) return null;
  const status = mapRenderStageToStorageStatus(job.stageKey);
  const patch = { jobId: job.id, status };
  if (job.userId) patch.userId = job.userId;
  return patchJobMetadata(job.jobDir, patch);
}

/**
 * Mark successful render — expire 2 hours after completion (all plans).
 */
export function markRenderJobStorageCompleted(jobRoot, { userId = null } = {}) {
  const completedAt = new Date();
  const expiresAt = new Date(completedAt.getTime() + JOB_EXPIRY_MS);
  return patchJobMetadata(jobRoot, {
    status: 'completed',
    cleanupStatus: 'active',
    renderCompletedAt: completedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(userId ? { userId } : {})
  });
}

export function markRenderJobStorageFailed(jobRoot, { error = null, hasDiagnostics = false } = {}) {
  return patchJobMetadata(jobRoot, {
    status: 'failed',
    cleanupStatus: hasDiagnostics ? 'diagnostics_preserved' : 'awaiting_diagnostics',
    failedAt: new Date().toISOString(),
    error: error ? String(error).slice(0, 500) : null,
    hasDiagnostics: Boolean(hasDiagnostics),
    expiresAt: null
  });
}

export function markRenderJobStorageDeleted(jobRoot) {
  return patchJobMetadata(jobRoot, {
    cleanupStatus: 'deleted',
    deletedAt: new Date().toISOString()
  });
}

function dirSizeBytes(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return 0;
  let total = 0;
  let entries = [];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else if (entry.isFile()) total += statSync(full).size;
    } catch {
      /* skip unreadable entries */
    }
  }
  return total;
}

function safeRmDir(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return 0;
  const bytes = dirSizeBytes(dirPath);
  try {
    rmSync(dirPath, { recursive: true, force: true });
    return bytes;
  } catch (err) {
    console.warn('[storage-lifecycle] delete failed', { dirPath, message: err?.message || String(err) });
    return 0;
  }
}

function jobHasDiagnostics(jobRoot) {
  const layout = getJobStorageLayout(jobRoot);
  const candidates = [
    join(layout.logs, 'render-diagnostics.json'),
    join(layout.root, 'render-diagnostics.json'),
    join(layout.logs, 'subtitle_integrity_report.json'),
    join(layout.root, 'subtitle_integrity_report.json')
  ];
  return candidates.some((p) => existsSync(p));
}

export function canDeleteRenderJobStorage(metadata, jobRoot) {
  if (!metadata || !jobRoot) return { ok: false, reason: 'missing_metadata' };
  const status = String(metadata.status || '').toLowerCase();

  if (ACTIVE_JOB_STATUSES.has(status)) {
    return { ok: false, reason: 'active_job' };
  }
  if (status === 'running') {
    return { ok: false, reason: 'running_job' };
  }
  if (TERMINAL_PROTECTED_STATUSES.has(status)) {
    const hasDiag = metadata.hasDiagnostics || jobHasDiagnostics(jobRoot);
    if (!hasDiag) return { ok: false, reason: 'failed_without_diagnostics' };
    return { ok: false, reason: 'failed_preserved' };
  }
  if (status !== 'completed') {
    return { ok: false, reason: 'not_completed' };
  }

  const expiresAtMs = Date.parse(metadata.expiresAt || '');
  if (!Number.isFinite(expiresAtMs)) {
    return { ok: false, reason: 'missing_expires_at' };
  }
  if (Date.now() < expiresAtMs) {
    return { ok: false, reason: 'not_expired' };
  }

  return { ok: true, reason: 'expired_completed_job' };
}

function listJobDirectories() {
  const root = getJobsRoot();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

function diagnosticsMetadataPath(kind, traceId) {
  return join(getDiagnosticsRoot(), kind, sanitizeId(traceId), 'metadata.json');
}

export function createDiagnosticsStorage(kind, traceId, extra = {}) {
  const safeKind = DIAGNOSTIC_KINDS.includes(kind) ? kind : 'asr';
  const dir = join(getDiagnosticsRoot(), safeKind, sanitizeId(traceId));
  mkdirSync(dir, { recursive: true });
  const createdAt = new Date();
  const metadata = {
    kind: safeKind,
    traceId: sanitizeId(traceId),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + DIAGNOSTICS_RETENTION_MS).toISOString(),
    cleanupStatus: 'active',
    ...extra
  };
  writeJsonFile(join(dir, 'metadata.json'), metadata);
  return dir;
}

export function resolveAsrDiagnosticsStorageDir(traceId) {
  return join(getDiagnosticsRoot(), 'asr', sanitizeId(traceId));
}

export function resolveSubtitleIntegrityStorageDir(traceId) {
  return join(getDiagnosticsRoot(), 'subtitle-integrity', sanitizeId(traceId));
}

function listDiagnosticsDirectories(kind) {
  const root = join(getDiagnosticsRoot(), kind);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

function canDeleteDiagnosticsDir(dirPath) {
  const meta = readJsonFile(join(dirPath, 'metadata.json'));
  if (meta?.expiresAt) {
    const expiresAtMs = Date.parse(meta.expiresAt);
    if (Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs) {
      return { ok: true, reason: 'diagnostics_expired' };
    }
    return { ok: false, reason: 'diagnostics_not_expired' };
  }
  try {
    const ageMs = Date.now() - statSync(dirPath).mtimeMs;
    if (ageMs >= DIAGNOSTICS_RETENTION_MS) return { ok: true, reason: 'diagnostics_mtime_expired' };
  } catch {
    return { ok: false, reason: 'diagnostics_unreadable' };
  }
  return { ok: false, reason: 'diagnostics_not_expired' };
}

function scanLegacyRenderDirs() {
  const root = tmpdir();
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && /^cutup_render_/i.test(e.name))
    .map((e) => join(root, e.name));
}

/**
 * One cleanup cycle — jobs + diagnostics + legacy orphans.
 */
export function runStorageLifecycleCleanup() {
  if (cleanupRunning) {
    return Promise.resolve({ skipped: true, reason: 'cleanup_in_progress' });
  }
  cleanupRunning = true;
  const startedAt = Date.now();

  const result = {
    scannedJobs: 0,
    deletedJobs: 0,
    scannedDiagnostics: 0,
    deletedDiagnostics: 0,
    scannedLegacyDirs: 0,
    deletedLegacyDirs: 0,
    freedBytes: 0,
    deletedJobIds: [],
    errors: []
  };

  try {
    mkdirSync(getJobsRoot(), { recursive: true });
    mkdirSync(getDiagnosticsRoot(), { recursive: true });

    for (const jobRoot of listJobDirectories()) {
      result.scannedJobs += 1;
      const metadata = readJobMetadata(jobRoot);
      if (!metadata) continue;

      const decision = canDeleteRenderJobStorage(metadata, jobRoot);
      if (!decision.ok) continue;

      try {
        markRenderJobStorageDeleted(jobRoot);
      } catch {
        /* best effort metadata update before delete */
      }
      const freed = safeRmDir(jobRoot);
      result.freedBytes += freed;
      result.deletedJobs += 1;
      result.deletedJobIds.push(metadata.jobId || basename(jobRoot));
    }

    for (const kind of DIAGNOSTIC_KINDS) {
      for (const dirPath of listDiagnosticsDirectories(kind)) {
        result.scannedDiagnostics += 1;
        const decision = canDeleteDiagnosticsDir(dirPath);
        if (!decision.ok) continue;
        result.freedBytes += safeRmDir(dirPath);
        result.deletedDiagnostics += 1;
      }
    }

    for (const legacyDir of scanLegacyRenderDirs()) {
      result.scannedLegacyDirs += 1;
      let ageMs = 0;
      try {
        ageMs = Date.now() - statSync(legacyDir).mtimeMs;
      } catch {
        continue;
      }
      if (ageMs < JOB_EXPIRY_MS) continue;
      result.freedBytes += safeRmDir(legacyDir);
      result.deletedLegacyDirs += 1;
    }
  } catch (err) {
    result.errors.push(err?.message || String(err));
  } finally {
    cleanupRunning = false;
  }

  result.executionMs = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      event: 'storage_lifecycle_cleanup',
      ...result,
      freedMb: Math.round((result.freedBytes / (1024 * 1024)) * 100) / 100
    })
  );

  void import('../founder-bot/storage-cleanup-notify.js')
    .then((m) => m.notifyStorageCleanupIfNeeded(result))
    .catch(() => {});

  return Promise.resolve(result);
}

export function getStorageLifecycleSnapshot() {
  const jobs = listJobDirectories();
  const byStatus = {};
  for (const jobRoot of jobs) {
    const meta = readJobMetadata(jobRoot) || { status: 'unknown' };
    const key = String(meta.status || 'unknown');
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  return {
    root: CUTUP_STORAGE_ROOT,
    jobsRoot: getJobsRoot(),
    diagnosticsRoot: getDiagnosticsRoot(),
    jobExpiryMs: JOB_EXPIRY_MS,
    diagnosticsRetentionMs: DIAGNOSTICS_RETENTION_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
    jobCount: jobs.length,
    jobsByStatus: byStatus,
    schedulerActive: Boolean(schedulerHandle)
  };
}

export function startStorageLifecycleScheduler() {
  if (schedulerHandle) return schedulerHandle;
  if (String(process.env.CUTUP_STORAGE_LIFECYCLE_ENABLED ?? '1') === '0') {
    console.log('[storage-lifecycle] scheduler disabled (CUTUP_STORAGE_LIFECYCLE_ENABLED=0)');
    return null;
  }

  void runStorageLifecycleCleanup();
  schedulerHandle = setInterval(() => {
    void runStorageLifecycleCleanup();
  }, CLEANUP_INTERVAL_MS);
  schedulerHandle.unref?.();

  console.log('[storage-lifecycle] scheduler started', {
    intervalMs: CLEANUP_INTERVAL_MS,
    jobsRoot: getJobsRoot(),
    jobExpiryMs: JOB_EXPIRY_MS
  });
  return schedulerHandle;
}

export function stopStorageLifecycleScheduler() {
  if (!schedulerHandle) return;
  clearInterval(schedulerHandle);
  schedulerHandle = null;
}
