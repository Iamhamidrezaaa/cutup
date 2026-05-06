/** Same pattern as command-center: VITE_OPERATIONAL_STATE_URL or bundled public file. */
export function getOperationalStateUrl(): string {
  const env = import.meta.env.VITE_OPERATIONAL_STATE_URL?.trim();
  if (env) return env;
  return `${import.meta.env.BASE_URL}operational-state.json`.replace(/\/+/g, '/');
}
