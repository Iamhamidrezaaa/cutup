/**
 * Wake RunPod GPU worker from VPS before dispatching render jobs.
 */
import nodeFetch from 'node-fetch';

const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : nodeFetch;

const POLL_MS = 5000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 10000;
const RUNPOD_API_BASE = 'https://rest.runpod.io/v1';

let ensureReadyPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gpuRenderUrl() {
  return String(process.env.GPU_RENDER_URL || '').trim().replace(/\/$/, '');
}

function runpodApiKey() {
  return String(process.env.RUNPOD_API_KEY || '').trim();
}

function runpodPodId() {
  return String(process.env.RUNPOD_POD_ID || '').trim();
}

export async function checkGpuWorkerHealth() {
  const base = gpuRenderUrl();
  if (!base) return false;

  try {
    const res = await fetchFn(`${base}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body?.ok === true;
  } catch {
    return false;
  }
}

async function startRunPodPod(apiKey, podId) {
  const url = `${RUNPOD_API_BASE}/pods/${encodeURIComponent(podId)}/start`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `RunPod start failed (${res.status}): ${body.slice(0, 240) || res.statusText}`
    );
  }
}

async function wakeGpuWorker() {
  if (await checkGpuWorkerHealth()) {
    return;
  }

  console.log('[gpu-start] pod offline');

  const apiKey = runpodApiKey();
  const podId = runpodPodId();
  if (!apiKey || !podId) {
    throw new Error(
      'GPU worker is offline; set RUNPOD_API_KEY and RUNPOD_POD_ID on the VPS to auto-start the pod'
    );
  }

  console.log('[gpu-start] starting pod', { podId });
  await startRunPodPod(apiKey, podId);

  console.log('[gpu-start] waiting for worker');
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await checkGpuWorkerHealth()) {
      console.log('[gpu-start] worker ready');
      return;
    }
    await sleep(POLL_MS);
  }

  throw new Error('GPU worker did not become ready within 5 minutes');
}

/**
 * Ensure RunPod GPU worker is online before dispatching a render job.
 * Concurrent callers share one wake sequence.
 */
export async function ensureGpuWorkerReady() {
  if (await checkGpuWorkerHealth()) {
    return;
  }

  if (!ensureReadyPromise) {
    ensureReadyPromise = wakeGpuWorker().finally(() => {
      ensureReadyPromise = null;
    });
  }

  await ensureReadyPromise;
}
