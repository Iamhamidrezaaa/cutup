import { Link } from 'react-router-dom';
import type { OperationalState, SnapshotStatus } from '../../types/operational-state';

function statusClass(s: SnapshotStatus): string {
  return s === 'ok' ? 'cc-badge cc-badge--ok' : 'cc-badge cc-badge--warn';
}

export interface AppHeaderProps {
  state: OperationalState | null;
  loading: boolean;
  onRefresh: () => void;
  lastLoadedAt: string | null;
  pollIntervalMs: number;
}

export function AppHeader({ state, loading, onRefresh, lastLoadedAt, pollIntervalMs }: AppHeaderProps) {
  return (
    <header className="cc-header">
      <div className="cc-header__brand">
        <strong>Instalogist</strong>
        <span className="cc-header__subtitle">Command Center</span>
      </div>
      <nav className="cc-header__nav cc-header__nav--wrap">
        <Link to="/workforce">AI Workforce</Link>
        <Link to="/activity">Agent Activity</Link>
        <Link to="/decisions">Decisions</Link>
        <Link to="/risk">Risk Signals</Link>
        <Link to="/budget">Budget</Link>
        <Link to="/health">Health</Link>
      </nav>
      <div className="cc-header__meta">
        {state ? (
          <>
            <span className="cc-header__time" title="Parser snapshot time">
              Snapshot: {state.generated_at}
            </span>
            <span className={statusClass(state.snapshot_status)}>{state.snapshot_status}</span>
          </>
        ) : (
          <span className="cc-header__time muted">No snapshot loaded</span>
        )}
        {pollIntervalMs > 0 ? (
          <span className="cc-header__pill" title="HTTP polling (no websocket)">
            Poll {pollIntervalMs / 1000}s
          </span>
        ) : (
          <span className="cc-header__pill cc-header__pill--off">Poll off</span>
        )}
        {lastLoadedAt ? (
          <span className="cc-header__time muted" title="Last successful client fetch">
            Fetch: {lastLoadedAt}
          </span>
        ) : null}
        <button type="button" className="cc-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}
