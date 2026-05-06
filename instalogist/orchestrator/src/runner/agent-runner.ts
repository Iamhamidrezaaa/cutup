import type { DangerousActionKind, OrchestratorAgentId, OrchestratorTask } from '../types.js';

/**
 * Context for a single agent invocation. Runners must be idempotent side-effect free
 * regarding orchestration state (no self-enqueue, no modifying engine from background).
 */
export interface AgentRunContext {
  executionId: string;
  task: OrchestratorTask;
  agentId: OrchestratorAgentId;
  /** Remaining token budget for this execution step (informational). */
  tokenBudgetRemaining: number;
}

export interface AgentRunResult {
  ok: boolean;
  structuredOutput: Record<string, unknown>;
  tokensUsed: number;
  /** If true, engine moves to awaiting_approval — no autonomous continuation. */
  requiresHumanApproval: boolean;
  dangerousActionHints?: DangerousActionKind[];
  errorMessage?: string;
  /** Support / CTO escalation suggestion — engine may transition to escalated. */
  suggestEscalation?: { reason: string; targetAgent?: OrchestratorAgentId };
}

/**
 * Abstraction for LLM-backed or rule-backed agents. Implementations must not deploy, pay, or mutate prod.
 */
export interface AgentRunner {
  readonly agentId: OrchestratorAgentId;
  run(ctx: AgentRunContext): Promise<AgentRunResult>;
}
