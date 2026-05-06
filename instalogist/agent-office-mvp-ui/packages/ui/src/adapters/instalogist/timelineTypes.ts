export type TimelineEventKind = 'incident' | 'escalation' | 'parse_warning';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineEventKind;
  severity: 'critical' | 'high' | 'medium' | 'low';
  headline: string;
  detail: string;
  itemKey?: string;
  parseStatus?: string;
}
