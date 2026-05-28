/**
 * GPU memory guards, process timeouts, and child cleanup for heavy jobs.
 */
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { gpuDebug } from './observability.js';

const execAsync = promisify(exec);
const GPU_MEM_THRESHOLD_PCT = Math.min(98, Math.max(50, Number(process.env.GPU_MEM_THRESHOLD_PCT || 88)));
const PROCESS_TIMEOUT_MS = Math.max(30000, Number(process.env.PROCESS_JOB_TIMEOUT_MS || Number(process.env.YTDLP_TIMEOUT_MS || 120000)));
const GPU_CHECK_ENABLED = String(process.env.GPU_GUARD_ENABLED || 'true').toLowerCase() !== 'false';

/** @type {Set<import('child_process').ChildProcess>} */
const activeChildren = new Set();

let gpuUnhealthyUntil = 0;
let consecutiveGpuFailures = 0;

export function isGpuInCooldown() {
  return Date.now() < gpuUnhealthyUntil;
}

export function markGpuFailure(traceId, reason) {
  consecutiveGpuFailures += 1;
  const cooldownMs = Math.min(300000, 15000 * consecutiveGpuFailures);
  gpuUnhealthyUntil = Date.now() + cooldownMs;
  gpuDebug(traceId, {
    event: 'gpu_unhealthy',
    reason,
    consecutiveGpuFailures,
    cooldownMs,
    forceCpu: true
  });
}

export function markGpuSuccess(traceId) {
  consecutiveGpuFailures = 0;
  gpuUnhealthyUntil = 0;
  gpuDebug(traceId, { event: 'gpu_ok' });
}

/**
 * Best-effort NVIDIA memory check; returns true if safe to run GPU work.
 */
export async function checkGpuMemoryAvailable(traceId) {
  if (!GPU_CHECK_ENABLED) return { ok: true, skipped: true };
  if (isGpuInCooldown()) {
    gpuDebug(traceId, { ok: false, reason: 'cooldown', forceCpu: true });
    return { ok: false, reason: 'cooldown', forceCpu: true };
  }

  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 5000 }
    );
    const line = String(stdout || '')
      .split(/\r?\n/)
      .find(Boolean);
    if (!line) return { ok: true, skipped: true };
    const [used, total] = line.split(',').map((n) => Number(String(n).trim()));
    if (!total || !Number.isFinite(used)) return { ok: true, skipped: true };
    const pct = (used / total) * 100;
    const ok = pct < GPU_MEM_THRESHOLD_PCT;
    gpuDebug(traceId, { usedMb: used, totalMb: total, usagePct: Math.round(pct), threshold: GPU_MEM_THRESHOLD_PCT, ok });
    if (!ok) {
      markGpuFailure(traceId, 'memory_threshold');
      return { ok: false, reason: 'memory_threshold', usagePct: pct, forceCpu: true };
    }
    return { ok: true, usagePct: pct };
  } catch {
    gpuDebug(traceId, { ok: true, skipped: true, reason: 'nvidia_smi_unavailable' });
    return { ok: true, skipped: true };
  }
}

/**
 * Before local Whisper / GPU transcribe.
 */
export async function assertGpuOrCpuFallback(traceId, opts = {}) {
  const check = await checkGpuMemoryAvailable(traceId);
  if (check.ok) return { useGpu: true, forceCpu: false };
  if (opts.allowCpuFallback !== false) {
    return { useGpu: false, forceCpu: true, reason: check.reason || 'gpu_busy' };
  }
  const err = new Error('GPU is busy; try again shortly.');
  err.code = 'GPU_OVERLOAD';
  throw err;
}

export function registerChild(proc) {
  if (proc) activeChildren.add(proc);
  const cleanup = () => activeChildren.delete(proc);
  proc?.on?.('exit', cleanup);
  proc?.on?.('close', cleanup);
  return proc;
}

export function killAllChildren(traceId, signal = 'SIGKILL') {
  for (const p of activeChildren) {
    try {
      if (!p.killed) p.kill(signal);
    } catch {
      /* noop */
    }
  }
  activeChildren.clear();
  gpuDebug(traceId, { event: 'children_killed', signal });
}

/**
 * Spawn with timeout and guaranteed cleanup (yt-dlp, ffmpeg, whisper).
 */
export function spawnWithTimeout(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = PROCESS_TIMEOUT_MS,
    traceId = null,
    label = command
  } = options;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    registerChild(proc);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* noop */
      }
      gpuDebug(traceId, { event: 'process_timeout', label, timeoutMs });
      reject(
        Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), {
          code: 'PROCESS_TIMEOUT',
          stdout,
          stderr
        })
      );
    }, timeoutMs);

    proc.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(err, { stdout, stderr }));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          Object.assign(new Error(stderr.slice(-600) || `${label} exit ${code}`), {
            code: 'PROCESS_FAILED',
            stdout,
            stderr,
            exitCode: code
          })
        );
      }
    });
  });
}
