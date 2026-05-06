import type { OperationalItemLoose, OperationalStateLoose } from '@instalogist/agent-office-adapter';
import type { TimelineEvent } from './timelineTypes';

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function itemTitle(item: OperationalItemLoose): string {
  const f = item.fields ?? {};
  return str(f.title) ?? (typeof item.source_path === 'string' ? item.source_path : '(no title)');
}

function itemKey(item: OperationalItemLoose): string {
  const f = item.fields ?? {};
  return str(f.task_id) ?? str(f.incident_id) ?? (typeof item.source_path === 'string' ? item.source_path : 'unknown');
}

/**
 * Escalation reasons from task/growth items → cinematic timeline events (read-only).
 */
export function mapEscalations(raw: OperationalStateLoose): TimelineEvent[] {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const events: TimelineEvent[] = [];
  for (const item of items) {
    const et = typeof item.entity_type === 'string' ? item.entity_type : '';
    if (et !== 'task' && et !== 'growth') continue;
    const f = item.fields ?? {};
    const esc = f.escalation;
    if (esc == null || typeof esc !== 'object' || Array.isArray(esc)) continue;
    const e = esc as Record<string, unknown>;
    const reason = str(e.reason);
    if (!reason) continue;
    const at = str(e.escalated_at) ?? '';
    const from = str(e.from_agent);
    const title = itemTitle(item);
    events.push({
      id: `esc:${itemKey(item)}:${at}:${reason}`,
      at,
      kind: 'escalation',
      severity: 'high',
      headline: `Escalation: ${reason}`,
      detail: [from ? `from ${from}` : null, title, typeof item.source_path === 'string' ? item.source_path : null]
        .filter(Boolean)
        .join(' — '),
      itemKey: itemKey(item)
    });
  }
  events.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  return events;
}
