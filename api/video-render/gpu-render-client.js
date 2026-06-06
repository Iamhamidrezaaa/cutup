/**
 * Dispatch FFmpeg burn to dedicated RunPod GPU worker.
 */
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import nodeFetch from 'node-fetch';
import { ensureGpuWorkerReady } from './gpu-start.js';

const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : nodeFetch;

export function isGpuRenderEnabled() {
  return String(process.env.GPU_RENDER_ENABLED || '0').trim() === '1';
}

function gpuRenderUrl() {
  const url = String(process.env.GPU_RENDER_URL || '').trim();
  if (!url) throw new Error('GPU_RENDER_URL is not configured');
  return url.replace(/\/$/, '');
}

function gpuRenderToken() {
  const token = String(process.env.GPU_RENDER_TOKEN || '').trim();
  if (!token) throw new Error('GPU_RENDER_TOKEN is not configured');
  return token;
}

function gpuTimeoutMs() {
  return Number(process.env.GPU_RENDER_TIMEOUT_MS || 600000);
}

/**
 * @param {object} payload
 */
export async function dispatchGpuRenderJob(payload) {
  await ensureGpuWorkerReady();

  const base = gpuRenderUrl();
  const res = await fetchFn(`${base}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gpuRenderToken()}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(gpuTimeoutMs())
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.success) {
    const msg = body?.message || body?.error || `GPU render failed (${res.status})`;
    const err = new Error(msg);
    err.httpStatus = res.status;
    throw err;
  }
  return body;
}

/**
 * @param {string} outputUrl
 * @param {string} destPath
 */
export async function downloadGpuRenderOutput(outputUrl, destPath) {
  const res = await fetchFn(outputUrl, {
    headers: { Authorization: `Bearer ${gpuRenderToken()}` },
    signal: AbortSignal.timeout(gpuTimeoutMs())
  });
  if (!res.ok) {
    throw new Error(`GPU output download failed (${res.status})`);
  }
  const nodeStream =
    typeof res.body?.pipe === 'function'
      ? res.body
      : Readable.fromWeb(res.body);
  await pipeline(nodeStream, createWriteStream(destPath));
}
