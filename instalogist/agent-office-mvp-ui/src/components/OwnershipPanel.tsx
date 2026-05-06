import type { OwnershipView } from '@instalogist/agent-office-adapter';
import { parseClass, priorityClass } from './Badges';

export function OwnershipPanel({ ownership }: { ownership: OwnershipView }): JSX.Element {
  return (
    <div role="region" aria-label="Ownership">
      {ownership.agents.length === 0 && ownership.unassigned.length === 0 ? (
        <p className="empty-hint">No open items.</p>
      ) : null}
      {ownership.agents.map((agent) => (
        <details key={agent.id} className="ownership-agent" open={agent.open_items <= 8}>
          <summary>
            {agent.id} — {agent.open_items} open
            <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: '0.5rem' }}>
              {Object.entries(agent.by_priority)
                .map(([k, v]) => `${k}:${v}`)
                .join(' · ') || 'no priority breakdown'}
            </span>
          </summary>
          <div className="agent-body">
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {agent.items.map((it) => (
                <li key={it.item_key + it.source_path} style={{ marginBottom: '0.5rem' }}>
                  <div>{it.title}</div>
                  <div className="card-path">{it.source_path}</div>
                  <div className="badges" style={{ marginTop: '0.25rem' }}>
                    {it.priority != null && <span className={priorityClass(it.priority)}>{it.priority}</span>}
                    <span className={parseClass(it.parse_status)}>{it.parse_status}</span>
                    <span className="badge badge-punset">{it.status ?? 'no status'}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
      {ownership.unassigned.length > 0 && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <h2>Unassigned (open)</h2>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
            {ownership.unassigned.map((u) => (
              <li key={u.item_key + u.source_path} style={{ marginBottom: '0.35rem' }}>
                <strong>{u.title}</strong>
                <div className="card-path">{u.source_path}</div>
                <span className={parseClass(u.parse_status)}>{u.parse_status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
