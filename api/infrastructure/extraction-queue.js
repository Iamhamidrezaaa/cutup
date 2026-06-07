/**
 * Lightweight in-memory job queue for yt-dlp downloads and transcription workloads.
 */
import { normalizeSourceUrl } from './url-cache-key.js';
import { queueDebug } from './observability.js';
import { isBillingDbConfigured, getSubscriptionRowByEmail } from '../billing-repository.js';
import { hasPermission, resolvePlanKey } from '../plans/permissions.js';

const MAX_DOWNLOADS = Math.max(1, Number(process.env.MAX_CONCURRENT_DOWNLOADS || 2));
const MAX_TRANSCRIBES = Math.max(1, Number(process.env.MAX_CONCURRENT_TRANSCRIBES || 1));

/** @type {Map<string, { id: string, state: string, promise: Promise<unknown>, waiters: number, meta: object }>} */
const dedupeByKey = new Map();

let jobSeq = 0;
const downloadQueue = [];
const transcribeQueue = [];
let activeDownloads = 0;
let activeTranscribes = 0;

function nextJobId() {
  jobSeq += 1;
  return `q_${Date.now()}_${jobSeq}`;
}

/**
 * @param {string|null|undefined} userEmail
 */
export async function resolveQueuePriority(userEmail) {
  if (!userEmail) return 0;
  if (!isBillingDbConfigured()) return 1;
  try {
    const row = await getSubscriptionRowByEmail(userEmail);
    const plan = resolvePlanKey(row?.plan || 'free');
    if (hasPermission(plan, 'canUsePriorityQueue')) return 20;
    if (plan && plan !== 'free') return 10;
  } catch {
    /* noop */
  }
  return 0;
}

function sortQueue(queue) {
  queue.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = Number(a.durationSec) || 999999;
    const db = Number(b.durationSec) || 999999;
    if (da !== db) return da - db;
    return a.enqueuedAt - b.enqueuedAt;
  });
}

function logQueue(traceId, jobType, extra = {}) {
  const waitTimes = [...downloadQueue, ...transcribeQueue].map((j) => Date.now() - j.enqueuedAt);
  const avgWait = waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
  queueDebug(traceId, {
    queueLength: downloadQueue.length + transcribeQueue.length,
    activeJobs: activeDownloads + activeTranscribes,
    activeDownloads,
    activeTranscribes,
    waitTime: avgWait,
    estimatedStart: avgWait,
    jobType,
    ...extra
  });
}

function pump(type) {
  if (type === 'download') {
    while (activeDownloads < MAX_DOWNLOADS && downloadQueue.length) {
      const job = downloadQueue.shift();
      runJob(job, 'download');
    }
    return;
  }
  while (activeTranscribes < MAX_TRANSCRIBES && transcribeQueue.length) {
    const job = transcribeQueue.shift();
    runJob(job, 'transcribe');
  }
}

async function runJob(job, type) {
  const isDownload = type === 'download';
  if (isDownload) activeDownloads += 1;
  else activeTranscribes += 1;

  job.state = 'processing';
  job.startedAt = Date.now();
  const dedupe = job.dedupeKey ? dedupeByKey.get(job.dedupeKey) : null;
  if (dedupe) dedupe.state = 'processing';

  logQueue(job.traceId, type, { jobId: job.id, state: 'processing', dedupeKey: job.dedupeKey });

  try {
    const result = await job.fn();
    job.state = 'completed';
    job.resolve(result);
    if (dedupe) {
      dedupe.state = 'completed';
      dedupe.promise = Promise.resolve(result);
    }
  } catch (err) {
    job.state = 'failed';
    job.reject(err);
    if (dedupe) {
      dedupe.state = 'failed';
      dedupe.promise = Promise.reject(err);
    }
  } finally {
    if (isDownload) activeDownloads -= 1;
    else activeTranscribes -= 1;
    if (dedupe) {
      setTimeout(() => dedupeByKey.delete(job.dedupeKey), 5000);
    }
    logQueue(job.traceId, type, { jobId: job.id, state: job.state });
    pump(type);
  }
}

/**
 * @param {object} opts
 * @param {'download'|'transcribe'} opts.type
 * @param {string} [opts.dedupeKey] normalized URL or custom key
 * @param {() => Promise<unknown>} opts.fn
 * @param {string} [opts.traceId]
 * @param {number} [opts.priority]
 * @param {number} [opts.durationSec]
 */
export function enqueueJob(opts) {
  const { type, fn, traceId, priority = 0, durationSec = null, dedupeKey = null } = opts;

  if (dedupeKey) {
    const existing = dedupeByKey.get(dedupeKey);
    if (existing && (existing.state === 'processing' || existing.state === 'queued')) {
      existing.waiters += 1;
      logQueue(traceId, type, {
        jobId: existing.id,
        state: existing.state,
        dedupeKey,
        attached: true,
        waiters: existing.waiters
      });
      return existing.promise;
    }
  }

  const id = nextJobId();
  let resolveJob;
  let rejectJob;
  const promise = new Promise((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });

  const job = {
    id,
    type,
    fn,
    traceId,
    priority,
    durationSec,
    dedupeKey,
    enqueuedAt: Date.now(),
    state: 'queued',
    resolve: resolveJob,
    reject: rejectJob
  };

  if (dedupeKey) {
    dedupeByKey.set(dedupeKey, {
      id,
      state: 'queued',
      promise,
      waiters: 0,
      meta: { type, traceId }
    });
  }

  logQueue(traceId, type, { jobId: id, state: 'queued', dedupeKey });

  if (type === 'download') {
    downloadQueue.push(job);
    sortQueue(downloadQueue);
    pump('download');
  } else {
    transcribeQueue.push(job);
    sortQueue(transcribeQueue);
    pump('transcribe');
  }

  return promise;
}

/**
 * @param {string} url
 */
export function dedupeKeyForUrl(url) {
  return normalizeSourceUrl(url) || null;
}

export function getQueueMetrics() {
  return {
    downloadQueueLength: downloadQueue.length,
    transcribeQueueLength: transcribeQueue.length,
    activeDownloads,
    activeTranscribes,
    maxDownloads: MAX_DOWNLOADS,
    maxTranscribes: MAX_TRANSCRIBES
  };
}

/**
 * Mark URL in cooldown after YouTube block (optional hook).
 */
export function markUrlCooldown(url, ms = 60000) {
  const key = dedupeKeyForUrl(url);
  if (!key) return;
  dedupeByKey.set(key, {
    id: `cooldown_${key}`,
    state: 'cooldown',
    promise: Promise.reject(Object.assign(new Error('Source in cooldown'), { code: 'YTDLP_TEMP_BLOCK' })),
    waiters: 0,
    meta: { until: Date.now() + ms }
  });
  setTimeout(() => {
    const e = dedupeByKey.get(key);
    if (e?.state === 'cooldown') dedupeByKey.delete(key);
  }, ms);
}
