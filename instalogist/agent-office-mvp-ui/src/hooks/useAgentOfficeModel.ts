import { useCallback, useEffect, useState } from 'react';
import type { AgentOfficeUiModel } from '@instalogist/agent-office-adapter';
import { loadOperationalState, type LoadedOperational } from '@agent-office-ui/adapters/instalogist';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadState {
  status: LoadStatus;
  model: AgentOfficeUiModel | null;
  operational: LoadedOperational | null;
  fetchError: string | null;
  lastFetchedAt: string | null;
  snapshotUrl: string;
}

export function useAgentOfficeModel(snapshotUrl: string): LoadState & { refresh: () => void } {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [model, setModel] = useState<AgentOfficeUiModel | null>(null);
  const [operational, setOperational] = useState<LoadedOperational | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setFetchError(null);
    const result = await loadOperationalState(snapshotUrl);
    if (!result.ok) {
      setStatus('error');
      setFetchError([result.error, result.detail].filter(Boolean).join(' — '));
      setModel(null);
      setOperational(null);
      return;
    }
    setOperational(result.data);
    setModel(result.data.model);
    setLastFetchedAt(new Date().toISOString());
    setStatus('ready');
  }, [snapshotUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    status,
    model,
    operational,
    fetchError,
    lastFetchedAt,
    snapshotUrl,
    refresh: load
  };
}
