import type { ReactNode } from 'react';
import type { LoadError, OperationalState } from '../../types/operational-state';
import type { SnapshotPhase } from '../../state/useOperationalSnapshot';

export interface OperationalPageShellProps {
  phase: SnapshotPhase;
  state: OperationalState | null;
  error: LoadError | null;
  url: string;
  children: (state: OperationalState) => ReactNode;
}

export function OperationalPageShell({
  phase,
  state,
  error,
  url,
  children
}: OperationalPageShellProps) {
  if (phase === 'loading' || phase === 'idle') {
    return (
      <div className="cc-panel cc-panel--loading">
        <p>Loading operational snapshot…</p>
        <p className="muted small">{url}</p>
      </div>
    );
  }

  if (phase === 'error' && error) {
    return (
      <div className="cc-panel cc-panel--error">
        <h2>Could not load snapshot</h2>
        <p>
          <strong>{error.message}</strong>
        </p>
        {error.detail ? <pre className="cc-pre">{error.detail}</pre> : null}
        <p className="muted small">Requested URL: {url}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="cc-panel cc-panel--error">
        <p>No data</p>
      </div>
    );
  }

  return <>{children(state)}</>;
}
