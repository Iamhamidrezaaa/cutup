import type { BoardCard } from '@instalogist/agent-office-adapter';

export function priorityClass(p: string | null): string {
  if (!p) return 'badge badge-punset';
  const u = p.toUpperCase();
  if (u === 'P0') return 'badge badge-p0';
  if (u === 'P1') return 'badge badge-p1';
  if (u === 'P2') return 'badge badge-p2';
  if (u === 'P3') return 'badge badge-p3';
  return 'badge badge-punset';
}

export function riskClass(r: string | null): string {
  if (!r) return 'badge badge-punset';
  const u = r.toUpperCase();
  if (u === 'H' || u === 'C') return 'badge badge-risk-h';
  if (u === 'M') return 'badge badge-risk-m';
  if (u === 'L') return 'badge badge-risk-l';
  return 'badge badge-punset';
}

export function parseClass(status: string): string {
  return status === 'ok' ? 'badge badge-parse-ok' : 'badge badge-parse-bad';
}

export function CardBadges({ card }: { card: BoardCard }): JSX.Element {
  return (
    <div className="badges">
      {card.priority != null && <span className={priorityClass(card.priority)}>{card.priority}</span>}
      {card.risk_class != null && (
        <span className={riskClass(card.risk_class)} title="risk_class">
          R:{card.risk_class}
        </span>
      )}
      <span className={parseClass(card.parse_status)} title="parse health">
        {card.parse_status}
      </span>
      {card.validation_error_count > 0 && (
        <span className="badge badge-parse-bad" title="validation errors">
          val:{card.validation_error_count}
        </span>
      )}
      {card.validation_warning_count > 0 && (
        <span className="badge badge-parse-bad" title="validation warnings">
          vw:{card.validation_warning_count}
        </span>
      )}
      {card.stale && (
        <span className="badge badge-stale" title="stale">
          stale
        </span>
      )}
      {card.blocked_stale && (
        <span className="badge badge-blocked-stale" title="blocked stale">
          blocked∆
        </span>
      )}
      {card.escalation_reason != null && (
        <span className="badge badge-escalation" title={card.escalation_reason}>
          esc:{card.escalation_reason}
        </span>
      )}
      {card.owner_agent != null && (
        <span className="badge badge-owner" title="owner">
          {card.owner_agent}
        </span>
      )}
    </div>
  );
}
