/**
 * @param {string | undefined} updatedAtRaw
 * @param {string | undefined} status
 * @param {Date} now
 * @returns {{ stale: boolean, blocked_stale: boolean, days_since_update: number | null }}
 */
export function deriveStale(updatedAtRaw, status, now) {
  const MS_DAY = 86_400_000;
  let days = null;
  let stale = false;
  let blockedStale = false;

  if (typeof updatedAtRaw !== 'string' || updatedAtRaw.trim() === '') {
    return { stale: false, blocked_stale: false, days_since_update: null };
  }

  const d = Date.parse(updatedAtRaw);
  if (Number.isNaN(d)) {
    return { stale: false, blocked_stale: false, days_since_update: null };
  }

  days = Math.floor((now.getTime() - d) / MS_DAY);
  const terminal = new Set(['done', 'cancelled', 'blocked']);

  if (status !== 'blocked' && !terminal.has(status || '') && days > 14) {
    stale = true;
  }

  if (status === 'blocked' && days > 7) {
    blockedStale = true;
  }

  return { stale, blocked_stale: blockedStale, days_since_update: days };
}
