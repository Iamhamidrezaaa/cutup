/**
 * In-memory upload transcription jobs — short polls avoid proxy timeouts on long ASR runs.
 */
const JOB_TTL_MS = 45 * 60 * 1000;

/** @type {Map<string, object>} */
const jobs = new Map();

function scheduleJobEviction(jobId) {
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
}

export function createUploadJob({ traceId, userEmail }) {
  const jobId = `upj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    traceId,
    userEmail,
    status: 'processing',
    phase: 'queued',
    progress: 12,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null,
    error: null
  };
  jobs.set(jobId, job);
  scheduleJobEviction(jobId);
  return job;
}

export function patchUploadJob(jobId, patch = {}) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

export function getUploadJob(jobId) {
  return jobs.get(jobId) || null;
}

export function completeUploadJob(jobId, result) {
  return patchUploadJob(jobId, {
    status: 'completed',
    phase: 'done',
    progress: 100,
    result
  });
}

export function failUploadJob(jobId, err = {}) {
  const errorCode = String(err.errorCode || err.code || 'UNKNOWN_ERROR').toUpperCase();
  return patchUploadJob(jobId, {
    status: 'failed',
    phase: 'failed',
    progress: 0,
    error: {
      success: false,
      errorCode,
      message: err.message || 'Upload processing failed.',
      retryable: err.retryable !== false,
      traceId: err.traceId || null,
      phase: err.phase || 'transcription'
    }
  });
}
