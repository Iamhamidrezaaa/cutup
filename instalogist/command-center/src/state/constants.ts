/** Default snapshot URL (Vite serves from public/). Override with VITE_OPERATIONAL_STATE_URL. */
export function getOperationalStateUrl(): string {
  const env = import.meta.env.VITE_OPERATIONAL_STATE_URL;
  if (env && env.trim()) return env.trim();
  return `${import.meta.env.BASE_URL}operational-state.json`.replace(/\/+/g, '/');
}

/**
 * Polling interval for snapshot reload (ms). Set VITE_OPERATIONAL_POLL_MS=0 to disable.
 * Default 15000 — no websockets; HTTP polling only.
 */
export function getOperationalPollIntervalMs(): number {
  const raw = import.meta.env.VITE_OPERATIONAL_POLL_MS;
  if (raw === '0' || raw === 'false' || raw === '') return 0;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return 15_000;
}
