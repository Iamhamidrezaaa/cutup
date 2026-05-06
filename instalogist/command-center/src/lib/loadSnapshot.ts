import { assertOperationalState } from './validateContract';
import type { LoadError, OperationalState } from '../types/operational-state';

export async function loadOperationalSnapshot(
  url: string
): Promise<{ ok: true; state: OperationalState } | { ok: false; error: LoadError }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'network',
        message: 'Failed to fetch operational snapshot',
        detail: e instanceof Error ? e.message : String(e)
      }
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: {
        kind: 'network',
        message: `HTTP ${res.status} loading snapshot`,
        detail: url
      }
    };
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'not_json',
        message: 'Response is not valid JSON',
        detail: e instanceof Error ? e.message : String(e)
      }
    };
  }

  try {
    const state = assertOperationalState(data);
    return { ok: true, state };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: 'contract',
        message: 'Operational state failed contract validation',
        detail: e instanceof Error ? e.message : String(e)
      }
    };
  }
}
