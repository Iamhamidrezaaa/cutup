import type { IncidentsView } from '@instalogist/agent-office-adapter';
import { IncidentRowBadges } from './OperationalRail';

function IncidentTable({ rows, empty }: { rows: IncidentsView['critical']; empty: string }): JSX.Element {
  if (rows.length === 0) {
    return <p className="empty-hint">{empty}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Signals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item_key + r.source_path}>
              <td>
                <div>{r.title}</div>
                <div className="card-path">{r.source_path}</div>
              </td>
              <td>{r.owner_agent ?? '—'}</td>
              <td>{r.status ?? '—'}</td>
              <td>
                {r.updated_at ?? '—'}
                {r.days_since_update != null && (
                  <div className="card-path">{r.days_since_update}d since update</div>
                )}
              </td>
              <td>
                <IncidentRowBadges
                  priority={r.priority}
                  parse_status={r.parse_status}
                  validation_error_count={r.validation_error_count}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IncidentsPanel({ incidents }: { incidents: IncidentsView }): JSX.Element {
  return (
    <div role="region" aria-label="Incidents">
      <div className="incident-section">
        <h3>Critical (P0, healthy parse)</h3>
        <IncidentTable rows={incidents.critical} empty="None." />
      </div>
      <div className="incident-section">
        <h3>Active</h3>
        <IncidentTable rows={incidents.active} empty="None." />
      </div>
      <div className="incident-section">
        <h3>Degraded parse / validation</h3>
        <IncidentTable rows={incidents.degraded_parse} empty="None." />
      </div>
    </div>
  );
}
