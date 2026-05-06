/** Registered Instalogist orchestration agents (OpenClaw-style roles). */
export type OrchestratorAgentId = 'cto-agent' | 'developer-agent' | 'support-agent';

export type DangerousActionKind =
  | 'deploy'
  | 'payment'
  | 'auth_change'
  | 'database_write'
  | 'migration'
  | 'secret_access'
  | 'destructive_infra';

export type TaskDangerClass = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export type ExecutionStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'escalated';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface OrchestratorTask {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  priority: number;
  dangerClass: TaskDangerClass;
  preferredAgentId?: OrchestratorAgentId;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionRecord {
  id: string;
  taskId: string;
  agentId: OrchestratorAgentId;
  status: ExecutionStatus;
  attempt: number;
  tokensUsed: number;
  structuredOutput?: Record<string, unknown>;
  lastError?: string;
  approvalRequestId?: string;
  escalationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  executionId: string;
  taskId: string;
  reason: string;
  dangerousActions: DangerousActionKind[];
  status: ApprovalStatus;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  multiplier: 2,
  maxDelayMs: 30_000
};

export interface TokenBudgetConfig {
  /** Max tokens per single execution step (runner must respect). */
  perExecutionHardCap: number;
  /** Soft cap per orchestration tick across all work. */
  perTickSoftCap: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
  perExecutionHardCap: 100_000,
  perTickSoftCap: 250_000
};

export interface AuditLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  executionId?: string;
  taskId?: string;
  agentId?: string;
  approvalId?: string;
  detail?: Record<string, unknown>;
}

export interface AgentRegistryEntry {
  id: OrchestratorAgentId;
  displayName: string;
  capabilities: string[];
  maxConcurrency: number;
}
