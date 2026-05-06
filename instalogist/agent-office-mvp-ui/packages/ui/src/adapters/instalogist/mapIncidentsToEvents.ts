import type { AgentOfficeUiModel, IncidentRow } from '@instalogist/agent-office-adapter';
import type { TimelineEvent } from './timelineTypes';

/** Merge incident + escalation timelines (read-only; chronological). */
export function mergeOperationalTimelineEvents(a: TimelineEvent[], b: TimelineEvent[]): TimelineEvent[] {
  return [...a, ...b].sort((x, y) => (x.at || '').localeCompare(y.at || ''));
}

function rowSeverity(r: IncidentRow): TimelineEvent['severity'] {
  if (r.parse_status !== 'ok' || r.validation_error_count > 0) return 'high';
  if (r.priority?.toUpperCase() === 'P0') return 'critical';
  if (r.priority?.toUpperCase() === 'P1') return 'high';
  return 'medium';
}

function flattenIncidents(model: AgentOfficeUiModel): IncidentRow[] {
  const { critical, active, degraded_parse } = model.views.incidents;
  return [...degraded_parse, ...critical, ...active];
}

function incidentTimestamp(r: IncidentRow, fallbackIso: string | null): string {
  return r.updated_at?.trim() || fallbackIso || '';
}

/**
 * Incidents → timeline events (read-only; sorted ascending by time string).
 */
export function mapIncidentsToEvents(model: AgentOfficeUiModel): TimelineEvent[] {
  const fallback = model.source.generated_at;
  const rows = flattenIncidents(model);
  const events: TimelineEvent[] = rows.map((r) => ({
    id: `inc:${r.item_key}`,
    at: incidentTimestamp(r, fallback),
    kind: 'incident',
    severity: rowSeverity(r),
    headline: r.title,
    detail: [r.owner_agent ? `owner: ${r.owner_agent}` : null, r.status ? `status: ${r.status}` : null, r.source_path]
      .filter(Boolean)
      .join(' · '),
    itemKey: r.item_key,
    parseStatus: r.parse_status
  }));
  events.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  return events;
}
