/**
 * Structured production logs with shared traceId across pipeline stages.
 */

export function infraLog(tag, payload = {}) {
  const data = payload && typeof payload === 'object' ? payload : { detail: payload };
  console.log(tag, data);
}

export function extractionDebug(traceId, data = {}) {
  infraLog('[extraction-debug]', { traceId, ...data });
}

export function transcribeDebug(traceId, data = {}) {
  infraLog('[transcribe-debug]', { traceId, ...data });
}

export function gpuDebug(traceId, data = {}) {
  infraLog('[gpu-debug]', { traceId, ...data });
}

export function cacheDebug(traceId, data = {}) {
  infraLog('[cache-debug]', { traceId, ...data });
}

export function queueDebug(traceId, data = {}) {
  infraLog('[queue-debug]', { traceId, ...data });
}

export function rateLimitDebug(traceId, data = {}) {
  infraLog('[rate-limit-debug]', { traceId, ...data });
}
