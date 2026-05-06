import type { AgentOfficeUiModel, BoardCard } from '@instalogist/agent-office-adapter';
import { CardBadges, parseClass, priorityClass } from './Badges';

function flattenBoardCards(model: AgentOfficeUiModel): BoardCard[] {
  const { board } = model.views;
  const out: BoardCard[] = [];
  for (const col of board.columns) out.push(...col.cards);
  out.push(...board.orphan_cards);
  return out;
}

export function OperationalRail({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const cards = flattenBoardCards(model);
  const escalated = cards.filter((c) => c.escalation_reason != null);
  const stale = cards.filter((c) => c.stale || c.blocked_stale);
  const { summary } = model.views;

  return (
    <div className="rail-grid" role="region" aria-label="Operational signals">
      <div className="metric">
        Items
        <strong>{summary.item_count}</strong>
      </div>
      <div className="metric">
        Stale (summary)
        <strong>{summary.stale_count}</strong>
      </div>
      <div className="metric">
        Degraded / bad parse
        <strong>{summary.degraded_items}</strong>
      </div>
      <div className="metric">
        Scan errors
        <strong>{summary.scan_errors}</strong>
      </div>
      <div className="metric">
        Escalations (board)
        <strong>{escalated.length}</strong>
      </div>
      <div className="metric">
        Stale cards (board)
        <strong>{stale.length}</strong>
      </div>
    </div>
  );
}

export function EscalationStrip({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const cards = flattenBoardCards(model).filter((c) => c.escalation_reason != null);
  if (cards.length === 0) {
    return (
      <p className="empty-hint" role="status">
        No escalated tasks on the board.
      </p>
    );
  }
  return (
    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
      {cards.map((c) => (
        <li key={c.item_key + c.source_path} style={{ marginBottom: '0.35rem' }}>
          <strong>{c.title}</strong> — <span className="badge badge-escalation">{c.escalation_reason}</span>
          <div className="badges" style={{ marginTop: '0.25rem' }}>
            <CardBadges card={c} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StaleTasksList({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const cards = flattenBoardCards(model).filter((c) => c.stale || c.blocked_stale);
  if (cards.length === 0) {
    return (
      <p className="empty-hint" role="status">
        No stale or blocked-stale tasks on the board.
      </p>
    );
  }
  return (
    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
      {cards.map((c) => (
        <li key={c.item_key + c.source_path} style={{ marginBottom: '0.35rem' }}>
          <strong>{c.title}</strong>
          <div className="badges" style={{ marginTop: '0.25rem' }}>
            <CardBadges card={c} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DegradedPanel({ model }: { model: AgentOfficeUiModel }): JSX.Element {
  const lines: string[] = [];
  const { summary } = model.views;
  if (summary.snapshot_status === 'degraded') {
    lines.push('Snapshot status is degraded.');
  }
  if (summary.degraded_items > 0) {
    lines.push(`${summary.degraded_items} item(s) with parse or validation issues.`);
  }
  if (summary.unparsed_count > 0) {
    lines.push(`${summary.unparsed_count} unparsed path(s) in snapshot.`);
  }
  if (summary.scan_errors > 0) {
    lines.push(`${summary.scan_errors} scan error(s) in snapshot.`);
  }
  for (const w of model.warnings) lines.push(`Adapter: ${w}`);

  if (lines.length === 0) {
    return <p className="empty-hint">No degraded warnings.</p>;
  }
  return (
    <ul className="adapter-warnings" style={{ color: 'var(--text)' }}>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** Incidents: adapter row omits risk/escalation; show priority + parse health + validation. */
export function IncidentRowBadges({
  priority,
  parse_status,
  validation_error_count
}: {
  priority: string | null;
  parse_status: string;
  validation_error_count: number;
}): JSX.Element {
  return (
    <div className="badges">
      {priority != null && <span className={priorityClass(priority)}>{priority}</span>}
      <span className={parseClass(parse_status)}>{parse_status}</span>
      {validation_error_count > 0 && <span className="badge badge-parse-bad">val:{validation_error_count}</span>}
    </div>
  );
}
