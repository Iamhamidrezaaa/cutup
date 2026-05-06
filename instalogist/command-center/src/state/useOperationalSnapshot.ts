import { useCallback, useEffect, useState } from 'react';
import { loadOperationalSnapshot } from '../lib/loadSnapshot';
import type { LoadError, OperationalState } from '../types/operational-state';
import { getOperationalPollIntervalMs, getOperationalStateUrl } from './constants';

export type SnapshotPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface UseOperationalSnapshotResult {
  phase: SnapshotPhase;
  state: OperationalState | null;
  error: LoadError | null;
  url: string;
  reload: () => void;
  reloadToken: number;
  lastLoadedAt: string | null;
  pollIntervalMs: number;
}

export function useOperationalSnapshot(options?: {
  pollIntervalMs?: number;
}): UseOperationalSnapshotResult {
  const url = getOperationalStateUrl();
  const pollIntervalMs = options?.pollIntervalMs ?? getOperationalPollIntervalMs();
  const [phase, setPhase] = useState<SnapshotPhase>('idle');
  const [state, setState] = useState<OperationalState | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!pollIntervalMs) return;
    const t = window.setInterval(() => {
      setReloadToken((x) => x + 1);
    }, pollIntervalMs);
    return () => window.clearInterval(t);
  }, [pollIntervalMs]);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);

    void (async () => {
      const result = await loadOperationalSnapshot(url);
      if (cancelled) return;
      if (result.ok) {
        setState(result.state);
        setLastLoadedAt(new Date().toISOString());
        setPhase('ready');
      } else {
        setState(null);
        setError(result.error);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, reloadToken]);

  return { phase, state, error, url, reload, reloadToken, lastLoadedAt, pollIntervalMs };
}
