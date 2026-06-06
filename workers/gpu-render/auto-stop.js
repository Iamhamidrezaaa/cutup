/**
 * Idle auto-stop for RunPod GPU worker pods.
 * Stops the pod via RunPod REST API when no renders run and no new jobs arrive for 5 minutes.
 */

const IDLE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const RUNPOD_API_BASE = 'https://rest.runpod.io/v1';

let activeRenderJobs = 0;
let lastActivityAt = Date.now();
let stopInFlight = false;
let checker = null;

export function getAutoStopState() {
  return {
    enabled: Boolean(process.env.RUNPOD_API_KEY?.trim() && process.env.RUNPOD_POD_ID?.trim()),
    activeRenderJobs,
    lastActivityAt,
    idleMs: Math.max(0, Date.now() - lastActivityAt),
    idleThresholdMs: IDLE_MS
  };
}

/** New render job accepted — counts as activity and active work. */
export function noteRenderJobStarted() {
  activeRenderJobs += 1;
  lastActivityAt = Date.now();
}

/** Render job finished (success or failure) — idle timer restarts when queue is empty. */
export function noteRenderJobFinished() {
  activeRenderJobs = Math.max(0, activeRenderJobs - 1);
  lastActivityAt = Date.now();
}

async function stopRunPodPod(apiKey, podId) {
  const url = `${RUNPOD_API_BASE}/pods/${encodeURIComponent(podId)}/stop`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `RunPod stop failed (${res.status}): ${body.slice(0, 240) || res.statusText}`
    );
  }
}

async function checkIdleAndStop(apiKey, podId) {
  if (stopInFlight) return;
  if (activeRenderJobs > 0) return;

  const idleMs = Date.now() - lastActivityAt;
  if (idleMs < IDLE_MS) return;

  stopInFlight = true;
  console.log('[auto-stop] idle detected', {
    idleMs,
    idleThresholdMs: IDLE_MS,
    activeRenderJobs
  });

  try {
    console.log('[auto-stop] stopping pod', { podId });
    await stopRunPodPod(apiKey, podId);
    console.log('[auto-stop] stop successful');
    if (checker) {
      clearInterval(checker);
      checker = null;
    }
  } catch (err) {
    stopInFlight = false;
    console.error('[auto-stop] stop failed', err?.message || err);
  }
}

export function startAutoStopScheduler() {
  const apiKey = String(process.env.RUNPOD_API_KEY || '').trim();
  const podId = String(process.env.RUNPOD_POD_ID || '').trim();

  if (!apiKey || !podId) {
    console.log('[auto-stop] disabled (set RUNPOD_API_KEY and RUNPOD_POD_ID to enable)');
    return;
  }

  lastActivityAt = Date.now();
  checker = setInterval(() => {
    checkIdleAndStop(apiKey, podId).catch((err) => {
      console.error('[auto-stop] checker error', err?.message || err);
    });
  }, CHECK_INTERVAL_MS);

  console.log('[auto-stop] enabled', {
    podId,
    idleMinutes: IDLE_MS / 60000,
    checkIntervalSec: CHECK_INTERVAL_MS / 1000
  });
}
