/** Optional extension embedded in operational-state.json for Command Center agent views. */

export type AgentKind = 'cto' | 'developer' | 'support' | 'other';

export type AgentWorkerStatus = 'idle' | 'running' | 'awaiting_approval' | 'error' | 'offline';

export interface CommandCenterAgent {
  id: string;
  kind: AgentKind;
  label: string;
  status: AgentWorkerStatus;
  session_id?: string;
  last_heartbeat_at?: string;
  current_task_hint?: string;
}

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CommandCenterExecution {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at?: string | null;
  status: ExecutionStatus;
  tokens_input: number;
  tokens_output: number;
  tool_calls: number;
  headline?: string;
  requires_human?: boolean;
}

export interface CommandCenterEscalation {
  id: string;
  ts: string;
  from_agent: string;
  reason: string;
  task_ref?: string;
}

export type DecisionStatus = 'draft' | 'awaiting_human' | 'approved' | 'rejected' | 'superseded';

export interface CommandCenterDecision {
  id: string;
  ts: string;
  title: string;
  status: DecisionStatus;
  proposed_by: string;
  risk?: 'low' | 'medium' | 'high';
  detail?: string;
}

export interface CommandCenterTokenBudget {
  per_run_cap: number;
  session_soft_cap: number;
  used_session: number;
  used_tick: number;
  tick_label?: string;
}

export interface CommandCenterAuditEntry {
  ts: string;
  principal_id: string;
  tool_id: string;
  ok: boolean;
  code?: string;
  dry_run: boolean;
  approval_granted?: boolean;
}

export interface CommandCenterRecommendation {
  id: string;
  priority?: string;
  text: string;
  source: 'agent' | 'system' | 'parser';
}

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface CommandCenterRiskSignal {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail?: string;
  related_task?: string;
}

export interface CommandCenterData {
  agents: CommandCenterAgent[];
  executions: CommandCenterExecution[];
  escalations_feed: CommandCenterEscalation[];
  decisions: CommandCenterDecision[];
  token_budget: CommandCenterTokenBudget;
  audit_log: CommandCenterAuditEntry[];
  recommendations: CommandCenterRecommendation[];
  risk_signals: CommandCenterRiskSignal[];
}

export function emptyCommandCenterData(): CommandCenterData {
  return {
    agents: [],
    executions: [],
    escalations_feed: [],
    decisions: [],
    token_budget: {
      per_run_cap: 0,
      session_soft_cap: 0,
      used_session: 0,
      used_tick: 0
    },
    audit_log: [],
    recommendations: [],
    risk_signals: []
  };
}
