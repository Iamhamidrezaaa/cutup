/**
 * Founder Bot — Telegram connection health state.
 */

let online = true;
let hadFailure = false;
let lastSuccessAt = null;
let lastFailureAt = null;
let failureCount = 0;

export function formatTelegramTimestamp(ms) {
  if (ms == null) return '—';
  try {
    return new Date(ms).toISOString();
  } catch {
    return '—';
  }
}

export function recordTelegramSuccess() {
  if (!online && hadFailure) {
    console.log('[founder-bot] telegram connection restored');
  }
  online = true;
  lastSuccessAt = Date.now();
}

export function recordTelegramFailure() {
  hadFailure = true;
  online = false;
  lastFailureAt = Date.now();
  failureCount += 1;
}

export function getTelegramHealthSnapshot() {
  return {
    online,
    lastSuccessAt,
    lastFailureAt,
    failureCount
  };
}

export function buildTelegramStatusText() {
  const s = getTelegramHealthSnapshot();
  return [
    '🤖 Telegram',
    '',
    `Status: ${s.online ? 'Online' : 'Offline'}`,
    '',
    'Last Success:',
    formatTelegramTimestamp(s.lastSuccessAt),
    '',
    'Last Failure:',
    formatTelegramTimestamp(s.lastFailureAt),
    '',
    'Failure Count:',
    String(s.failureCount)
  ].join('\n');
}
