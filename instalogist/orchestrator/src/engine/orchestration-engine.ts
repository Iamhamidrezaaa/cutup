import type { AuditLogEntry, OrchestratorAgentId, OrchestratorTask } from '../types.js';
import { StructuredAuditLog } from '../audit/structured-audit-log.js';
import { TokenBudgetLimiter } from '../budget/token-budget-limiter.js';
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_TOKEN_BUDGET,
  type RetryPolicy,
  type TokenBudgetConfig
} from '../types.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import { TaskQueue } from '../queue/task-queue.js';
import { ExecutionStateManager } from '../state/execution-state-manager.js';
import { computeRetryDelayMs, shouldRetry } from '../retry/retry-policy.js';
import { needsHumanCheckpoint, mergeDangerousHints } from '../policy/dangerous-actions.js';
import type { AgentRunner } from '../runner/agent-runner.js';
import { buildEscalationRecord } from '../escalation/escalation-support.js';

export interface OrchestrationEngineOptions {
  registry?: AgentRegistry;
  retryPolicy?: RetryPolicy;
  tokenBudget?: TokenBudgetConfig;
  audit?: StructuredAuditLog;
}

/**
 * Cooperative orchestrator (explicit `tick`). No autonomous deployment.
 * No self-modifying loops: one runner call per step; retries are capped and delayed.
 */
export class OrchestrationEngine {
  readonly queue: TaskQueue;
  readonly registry: AgentRegistry;
  readonly state: ExecutionStateManager;
  readonly audit: StructuredAuditLog;
  readonly budget: TokenBudgetLimiter;
  readonly retryPolicy: RetryPolicy;
  private readonly runners = new Map<string, AgentRunner>();
  private readonly executionTasks = new Map<string, OrchestratorTask>();
  private readonly runningExecutions = new Set<string>();

  constructor(options: OrchestrationEngineOptions = {}) {
    this.queue = new TaskQueue();
    this.registry = options.registry ?? new AgentRegistry();
    this.state = new ExecutionStateManager();
    this.audit = options.audit ?? new StructuredAuditLog();
    this.budget = new TokenBudgetLimiter(options.tokenBudget ?? DEFAULT_TOKEN_BUDGET);
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  registerRunner(runner: AgentRunner): void {
    this.runners.set(runner.agentId, runner);
  }

  submitTask(task: Omit<OrchestratorTask, 'createdAt'> & { createdAt?: string }): OrchestratorTask {
    const full: OrchestratorTask = {
      ...task,
      createdAt: task.createdAt ?? new Date().toISOString()
    };
    this.queue.enqueue(full);
    this.audit.emit({
      level: 'info',
      event: 'task_enqueued',
      taskId: full.id,
      detail: { kind: full.kind, dangerClass: full.dangerClass }
    });
    return full;
  }

  resolveApproval(approvalId: string, approved: boolean, resolvedBy: string): void {
    const ap = this.state.getApproval(approvalId);
    if (!ap) throw new Error(`approval_not_found:${approvalId}`);
    this.state.resolveApproval(approvalId, approved ? 'approved' : 'rejected', resolvedBy);
    const ex = this.state.getExecution(ap.executionId);
    if (!ex) throw new Error(`execution_not_found:${ap.executionId}`);

    this.audit.emit({
      level: approved ? 'info' : 'warn',
      event: approved ? 'human_approval_granted' : 'human_approval_denied',
      executionId: ex.id,
      taskId: ex.taskId,
      approvalId,
      detail: { resolvedBy }
    });

    if (approved) {
      this.state.updateExecution(ex.id, { status: 'completed', approvalRequestId: undefined });
      this.budget.clearExecution(ex.id);
      this.executionTasks.delete(ex.id);
      this.state.finalizeExecution(ex.id, 'completed');
    } else {
      this.state.updateExecution(ex.id, {
        status: 'failed',
        lastError: 'human_rejected_dangerous_action',
        approvalRequestId: undefined
      });
      this.budget.clearExecution(ex.id);
      this.executionTasks.delete(ex.id);
      this.state.finalizeExecution(ex.id, 'failed');
    }
  }

  async tick(maxTasks = 5): Promise<void> {
    this.budget.resetTick();
    let n = 0;
    while (n < maxTasks && this.queue.size() > 0) {
      const task = this.queue.dequeue();
      if (!task) break;

      const budgetGate = this.budget.canStartExecution(256);
      if (!budgetGate.ok) {
        this.queue.enqueue(task);
        this.audit.emit({
          level: 'warn',
          event: 'tick_deferred_token_budget',
          taskId: task.id,
          detail: { reason: budgetGate.reason }
        });
        break;
      }

      const agentId = this.registry.resolveAgentForTask(task.kind, task.preferredAgentId);
      let execution;
      try {
        execution = this.state.createExecution(task, agentId);
      } catch (e) {
        this.queue.enqueue(task);
        this.audit.emit({
          level: 'warn',
          event: 'task_skip_active_duplicate',
          taskId: task.id,
          detail: { message: e instanceof Error ? e.message : String(e) }
        });
        continue;
      }

      this.executionTasks.set(execution.id, task);

      this.audit.emit({
        level: 'info',
        event: 'execution_created',
        executionId: execution.id,
        taskId: task.id,
        agentId,
        detail: { kind: task.kind }
      });

      await this.runExecutionStep(task, execution.id, agentId);
      n += 1;
    }
  }

  private async runExecutionStep(task: OrchestratorTask, executionId: string, agentId: OrchestratorAgentId): Promise<void> {
    if (this.runningExecutions.has(executionId)) {
      this.audit.emit({
        level: 'warn',
        event: 'execution_reentrancy_blocked',
        executionId,
        taskId: task.id,
        detail: {}
      });
      return;
    }
    this.runningExecutions.add(executionId);

    const runner = this.runners.get(agentId);
    if (!runner) {
      this.state.updateExecution(executionId, {
        status: 'failed',
        lastError: `no_runner_registered:${agentId}`
      });
      this.audit.emit({
        level: 'error',
        event: 'runner_missing',
        executionId,
        taskId: task.id,
        agentId,
        detail: {}
      });
      this.runningExecutions.delete(executionId);
      this.executionTasks.delete(executionId);
      this.state.finalizeExecution(executionId, 'failed');
      return;
    }

    const exBefore = this.state.getExecution(executionId);
    const attempt = (exBefore?.attempt ?? 0) + 1;
    this.state.updateExecution(executionId, { status: 'running', attempt });

    let result;
    try {
      const ex = this.state.getExecution(executionId);
      const used = ex?.tokensUsed ?? 0;
      const remaining = Math.max(0, this.budget.perExecutionHardCap - used);
      result = await runner.run({
        executionId,
        task,
        agentId,
        tokenBudgetRemaining: remaining
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.handleFailure(executionId, task, agentId, msg);
      return;
    }

    const consume = this.budget.canConsumeForExecution(executionId, result.tokensUsed);
    if (!consume.ok) {
      this.state.updateExecution(executionId, {
        status: 'failed',
        lastError: consume.reason ?? 'budget_exceeded'
      });
      this.audit.emit({
        level: 'error',
        event: 'token_cap_exceeded',
        executionId,
        taskId: task.id,
        detail: { reason: consume.reason }
      });
      this.runningExecutions.delete(executionId);
      this.executionTasks.delete(executionId);
      this.state.finalizeExecution(executionId, 'failed');
      return;
    }

    this.budget.recordUsage(executionId, result.tokensUsed);
    const exCur = this.state.getExecution(executionId);
    this.state.updateExecution(executionId, {
      tokensUsed: (exCur?.tokensUsed ?? 0) + result.tokensUsed,
      structuredOutput: result.structuredOutput
    });

    if (!result.ok) {
      await this.handleFailure(executionId, task, agentId, result.errorMessage ?? 'runner_returned_not_ok');
      return;
    }

    if (result.suggestEscalation) {
      const patch = buildEscalationRecord(result.suggestEscalation.reason, result.suggestEscalation.targetAgent);
      this.state.updateExecution(executionId, patch);
      this.audit.emit({
        level: 'warn',
        event: 'execution_escalated',
        executionId,
        taskId: task.id,
        agentId,
        detail: { reason: result.suggestEscalation.reason }
      });
      this.runningExecutions.delete(executionId);
      this.executionTasks.delete(executionId);
      this.state.finalizeExecution(executionId, 'escalated');
      return;
    }

    const hints = mergeDangerousHints(task.dangerClass, result.dangerousActionHints);
    const checkpoint = needsHumanCheckpoint(task.dangerClass, hints) || result.requiresHumanApproval;

    if (checkpoint) {
      const apr = this.state.createApprovalRequest(
        executionId,
        task.id,
        'dangerous_or_high_risk_action_requires_human',
        hints
      );
      this.state.updateExecution(executionId, {
        status: 'awaiting_approval',
        approvalRequestId: apr.id
      });
      this.audit.emit({
        level: 'info',
        event: 'awaiting_human_approval',
        executionId,
        taskId: task.id,
        approvalId: apr.id,
        agentId,
        detail: { dangerous: hints }
      } satisfies Omit<AuditLogEntry, 'ts'>);
      this.runningExecutions.delete(executionId);
      return;
    }

    this.state.updateExecution(executionId, { status: 'completed' });
    this.audit.emit({
      level: 'info',
      event: 'execution_completed',
      executionId,
      taskId: task.id,
      agentId,
      detail: {}
    });
    this.budget.clearExecution(executionId);
    this.executionTasks.delete(executionId);
    this.state.finalizeExecution(executionId, 'completed');
    this.runningExecutions.delete(executionId);
  }

  private async handleFailure(executionId: string, task: OrchestratorTask, agentId: OrchestratorAgentId, message: string): Promise<void> {
    const ex = this.state.getExecution(executionId);
    const attempt = ex?.attempt ?? 0;
    this.state.updateExecution(executionId, { lastError: message });

    if (shouldRetry(this.retryPolicy, attempt)) {
      const delay = computeRetryDelayMs(this.retryPolicy, attempt);
      this.audit.emit({
        level: 'warn',
        event: 'execution_retry_scheduled',
        executionId,
        taskId: task.id,
        agentId,
        detail: { attempt, delayMs: delay, message }
      });
      this.state.updateExecution(executionId, { status: 'pending' });
      this.runningExecutions.delete(executionId);
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      const t = this.executionTasks.get(executionId) ?? task;
      await this.runExecutionStep(t, executionId, agentId);
      return;
    }

    this.audit.emit({
      level: 'error',
      event: 'execution_failed',
      executionId,
      taskId: task.id,
      agentId,
      detail: { message }
    });
    this.state.updateExecution(executionId, { status: 'failed' });
    this.budget.clearExecution(executionId);
    this.executionTasks.delete(executionId);
    this.state.finalizeExecution(executionId, 'failed');
    this.runningExecutions.delete(executionId);
  }
}
