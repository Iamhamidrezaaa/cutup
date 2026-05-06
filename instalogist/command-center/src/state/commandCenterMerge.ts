import type {
  CommandCenterData,
  CommandCenterEscalation,
  CommandCenterRecommendation
} from '../types/command-center';
import { emptyCommandCenterData } from '../types/command-center';
import type { OperationalItem, OperationalState } from '../types/operational-state';

/** Normalized command_center block (defaults when snapshot omits extension). */
export function resolveCommandCenter(state: OperationalState): CommandCenterData {
  const base = emptyCommandCenterData();
  const cc = state.command_center;
  if (!cc) return base;
  return {
    agents: cc.agents ?? base.agents,
    executions: cc.executions ?? base.executions,
    escalations_feed: cc.escalations_feed ?? base.escalations_feed,
    decisions: cc.decisions ?? base.decisions,
    token_budget: { ...base.token_budget, ...cc.token_budget },
    audit_log: cc.audit_log ?? base.audit_log,
    recommendations: cc.recommendations ?? base.recommendations,
    risk_signals: cc.risk_signals ?? base.risk_signals
  };
}

export function deriveIncidentItems(state: OperationalState): OperationalItem[] {
  return state.items.filter((it) => {
    const p = it.fields?.priority;
    const r = it.fields?.risk_class;
    return p === 'P0' || p === 'P1' || r === 'H';
  });
}

export function deriveEscalationsFromTasks(state: OperationalState): CommandCenterEscalation[] {
  const out: CommandCenterEscalation[] = [];
  for (const it of state.items) {
    const esc = it.fields?.escalation;
    if (!esc || typeof esc !== 'object' || Array.isArray(esc)) continue;
    const e = esc as Record<string, unknown>;
    out.push({
      id: `task:${it.source_path}`,
      ts: String(e.escalated_at ?? ''),
      from_agent: String(e.from_agent ?? ''),
      reason: String(e.reason ?? ''),
      task_ref: typeof it.fields?.task_id === 'string' ? it.fields.task_id : undefined
    });
  }
  return out;
}

export function mergedEscalations(state: OperationalState): CommandCenterEscalation[] {
  const cc = resolveCommandCenter(state);
  const fromTasks = deriveEscalationsFromTasks(state);
  const byId = new Map<string, CommandCenterEscalation>();
  for (const e of fromTasks) byId.set(e.id, e);
  for (const e of cc.escalations_feed) byId.set(e.id, e);
  return [...byId.values()].filter((e) => e.ts).sort((a, b) => b.ts.localeCompare(a.ts));
}

export function mergedRecommendations(state: OperationalState): CommandCenterRecommendation[] {
  const cc = resolveCommandCenter(state);
  const extra: CommandCenterRecommendation[] = [];
  for (const it of deriveIncidentItems(state)) {
    const tid =
      typeof it.fields?.task_id === 'string' ? it.fields.task_id : it.source_path.slice(-40);
    const title = typeof it.fields?.title === 'string' ? it.fields.title : 'Operational item';
    extra.push({
      id: `parser-${tid}`,
      priority: typeof it.fields?.priority === 'string' ? it.fields.priority : undefined,
      text: `Triage / own: ${title}`,
      source: 'parser'
    });
  }
  return [...cc.recommendations, ...extra];
}

export function parserOwnerAgents(state: OperationalState): { id: string; label: string }[] {
  const owners = new Set<string>();
  for (const it of state.items) {
    const o = it.fields?.owner_agent;
    if (typeof o === 'string' && o.trim()) owners.add(o.trim());
  }
  return [...owners].sort().map((id) => ({ id, label: id }));
}
