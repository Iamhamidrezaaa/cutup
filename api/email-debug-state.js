/**
 * In-memory diagnostics for admin email debug endpoints.
 */

let lastRenderError = null;
let lastSendResult = null;

export function setLastRenderError(err) {
  if (!err) {
    lastRenderError = null;
    return;
  }
  lastRenderError = {
    message: err.message || String(err),
    stack: err.stack || null,
    at: new Date().toISOString(),
    ...(err.details && typeof err.details === 'object' ? err.details : {}),
  };
}

export function getLastRenderError() {
  return lastRenderError;
}

export function setLastSendResult(result) {
  lastSendResult = {
    ...(result && typeof result === 'object' ? result : { value: result }),
    at: new Date().toISOString(),
  };
}

export function getLastSendResult() {
  return lastSendResult;
}
