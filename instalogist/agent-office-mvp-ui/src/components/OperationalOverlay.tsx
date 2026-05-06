import type { AgentOfficeUiModel } from '@instalogist/agent-office-adapter';

export function OperationalOverlay({
  model,
  onOpenTimeline
}: {
  model: AgentOfficeUiModel;
  onOpenTimeline?: () => void;
}): JSX.Element {
  const s = model.views.summary;
  const inc = model.views.incidents;
  const activeIncidents = inc.critical.length + inc.active.length + inc.degraded_parse.length;
  return (
    <aside className="operational-overlay" aria-label="Operational snapshot summary">
      <div className="operational-overlay-title">Live ops</div>
      <div className="operational-overlay-metrics">
        <span title="Tasks + growth on board">
          Board items: <strong>{s.item_count}</strong>
        </span>
        <span title="Incidents (all groups)">
          Incidents: <strong>{activeIncidents}</strong>
        </span>
        <span title="From summary">
          Stale: <strong>{s.stale_count}</strong>
        </span>
        <span title="Parse / validation">
          Degraded items: <strong>{s.degraded_items}</strong>
        </span>
      </div>
      {onOpenTimeline && (
        <button type="button" className="btn-overlay-link" onClick={onOpenTimeline}>
          Open timeline
        </button>
      )}
    </aside>
  );
}
