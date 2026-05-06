/** Fine-grained capabilities granted to a principal (roles expand to these). */
export type ToolPermission =
  | 'tool:read_workspace'
  | 'tool:search_codebase'
  | 'tool:write_workspace'
  | 'tool:read_operational'
  | 'tool:read_deploy'
  | 'tool:external_github'
  | 'tool:summarize';

export type ToolId =
  | 'read_workspace'
  | 'search_codebase'
  | 'create_task'
  | 'read_operational_state'
  | 'get_deployment_status'
  | 'github_search'
  | 'summarize_logs';

export interface ToolCaller {
  principalId: string;
  /** Resolved permission set (caller + role expansion done before invoke). */
  permissions: ReadonlySet<ToolPermission>;
}

export interface ToolExecutionOptions {
  dryRun: boolean;
  /**
   * Dangerous tools require explicit approval in non-dry-run mode.
   * Set only after human/orchestrator checkpoint.
   */
  approvalGranted: boolean;
  caller: ToolCaller;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  toolId: ToolId;
  dryRun: boolean;
  data?: T;
  error?: string;
  /** Machine-stable codes for orchestration */
  code?: 'ok' | 'permission_denied' | 'rate_limited' | 'approval_required' | 'validation_error' | 'execution_error';
}

export interface ToolAuditEntry {
  ts: string;
  toolId: ToolId;
  principalId: string;
  dryRun: boolean;
  approvalGranted: boolean;
  ok: boolean;
  code?: string;
  detail?: Record<string, unknown>;
}

export interface RateLimitConfig {
  maxCallsPerWindow: number;
  windowMs: number;
}
