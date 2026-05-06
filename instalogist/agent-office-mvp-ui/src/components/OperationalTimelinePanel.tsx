import type { TimelineEvent } from '@agent-office-ui/adapters/instalogist';

function eventClass(ev: TimelineEvent): string {
  const base = 'timeline-event';
  const sev =
    ev.severity === 'critical'
      ? 'timeline-sev-critical'
      : ev.severity === 'high'
        ? 'timeline-sev-high'
        : ev.severity === 'medium'
          ? 'timeline-sev-medium'
          : 'timeline-sev-low';
  const kind = ev.kind === 'escalation' ? 'timeline-kind-escalation' : 'timeline-kind-incident';
  return `${base} ${sev} ${kind}`;
}

export function OperationalTimelinePanel({ events }: { events: TimelineEvent[] }): JSX.Element {
  if (events.length === 0) {
    return <p className="empty-hint">No incidents or escalations in the current snapshot.</p>;
  }
  return (
    <ol className="timeline-list" aria-label="Operational timeline">
      {events.map((ev) => (
        <li key={ev.id} className={eventClass(ev)}>
          <div className="timeline-time">{ev.at || '—'}</div>
          <div className="timeline-kind">{ev.kind}</div>
          <div className="timeline-headline">{ev.headline}</div>
          <div className="timeline-detail">{ev.detail}</div>
          {ev.parseStatus != null && <div className="timeline-parse">parse: {ev.parseStatus}</div>}
        </li>
      ))}
    </ol>
  );
}
