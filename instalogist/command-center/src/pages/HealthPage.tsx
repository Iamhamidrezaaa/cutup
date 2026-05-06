import { DegradedBanner } from '../components/layout/DegradedBanner';
import type { LoadError, OperationalState } from '../types/operational-state';
import { computeHealthMetrics } from '../state/healthMetrics';
import type { SnapshotPhase } from '../state/useOperationalSnapshot';

export interface HealthPageProps {
  phase: SnapshotPhase;
  state: OperationalState | null;
  error: LoadError | null;
  url: string;
}

export function HealthPage({ phase, state, error, url }: HealthPageProps) {
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
        <p className="muted small">
          Place <code>operational-state.json</code> in <code>public/</code> or set{' '}
          <code>VITE_OPERATIONAL_STATE_URL</code>. Run the Instalogist parser to generate the file.
        </p>
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

  const m = computeHealthMetrics(state);

  return (
    <div className="cc-health">
      <DegradedBanner state={state} />

      <section className="cc-section">
        <h2>Snapshot</h2>
        <dl className="cc-dl">
          <dt>Status</dt>
          <dd>
            <span
              className={
                state.snapshot_status === 'ok' ? 'cc-badge cc-badge--ok' : 'cc-badge cc-badge--warn'
              }
            >
              {state.snapshot_status}
            </span>
          </dd>
          <dt>Generated at</dt>
          <dd>{state.generated_at}</dd>
          <dt>Parser version</dt>
          <dd>{state.parser_version}</dd>
          <dt>Contract</dt>
          <dd>
            <code>{state.contract_id}</code>
          </dd>
          <dt>Workspace root (from snapshot)</dt>
          <dd>
            <code className="cc-break">{state.workspace_root}</code>
          </dd>
        </dl>
      </section>

      <section className="cc-section">
        <h2>Item counts</h2>
        <dl className="cc-dl">
          <dt>Total items</dt>
          <dd>{m.itemCount}</dd>
          <dt>Stale (from summary)</dt>
          <dd>{m.staleCountFromSummary}</dd>
          <dt>Unparsed frontmatter (items)</dt>
          <dd>{m.unparsedItems}</dd>
          <dt>Non-ok parse status</dt>
          <dd>{m.degradedItems}</dd>
          <dt>Items with validation errors</dt>
          <dd>{m.itemsWithValidationErrors}</dd>
          <dt>Items with validation warnings</dt>
          <dd>{m.itemsWithValidationWarnings}</dd>
        </dl>
      </section>

      <section className="cc-section">
        <h2>Summary (parser)</h2>
        <pre className="cc-pre">{JSON.stringify(state.summary, null, 2)}</pre>
      </section>

      <section className="cc-section">
        <h2>Scan errors</h2>
        {state.errors.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul className="cc-list">
            {state.errors.map((e, i) => (
              <li key={i}>
                {e.message}
                {e.path ? (
                  <>
                    {' '}
                    <code>{e.path}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cc-section">
        <h2>Parse / validation (per item)</h2>
        <p className="muted small">
          Rows shown when parse status is not ok or validation is non-empty.
        </p>
        <table className="cc-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Parse</th>
              <th>Errors</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((item) => {
              const errN = item.validation.errors.length;
              const warnN = item.validation.warnings.length;
              if (item.parse_status === 'ok' && errN === 0 && warnN === 0) {
                return null;
              }
              return (
                <tr key={item.source_path}>
                  <td>
                    <code className="cc-break">{item.source_path}</code>
                  </td>
                  <td>{item.parse_status}</td>
                  <td>{errN}</td>
                  <td>{warnN}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {state.items.every(
          (i) =>
            i.parse_status === 'ok' &&
            i.validation.errors.length === 0 &&
            i.validation.warnings.length === 0
        ) ? (
          <p className="muted">All items clean</p>
        ) : null}
      </section>
    </div>
  );
}
