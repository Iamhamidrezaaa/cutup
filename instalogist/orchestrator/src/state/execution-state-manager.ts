import { randomBytes } from 'node:crypto';
import type {
  ApprovalRequest,
  ApprovalStatus,
  ExecutionRecord,
  ExecutionStatus,
  OrchestratorAgentId,
  OrchestratorTask
} from '../types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export class ExecutionStateManager {
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly approvals = new Map<string, ApprovalRequest>();
  private readonly taskIndex = new Map<string, string>(); // taskId -> active execution id (single-flight)

  createExecution(task: OrchestratorTask, agentId: OrchestratorAgentId): ExecutionRecord {
    const existing = this.taskIndex.get(task.id);
    if (existing) {
      const rec = this.executions.get(existing);
      if (rec && rec.status !== 'completed' && rec.status !== 'failed' && rec.status !== 'cancelled') {
        throw new Error(`task_already_active:${task.id}:${existing}`);
      }
    }
    const id = genId('exe');
    const rec: ExecutionRecord = {
      id,
      taskId: task.id,
      agentId,
      status: 'pending',
      attempt: 0,
      tokensUsed: 0,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.executions.set(id, rec);
    this.taskIndex.set(task.id, id);
    return rec;
  }

  getExecution(id: string): ExecutionRecord | undefined {
    return this.executions.get(id);
  }

  getExecutionByTaskId(taskId: string): ExecutionRecord | undefined {
    const eid = this.taskIndex.get(taskId);
    return eid ? this.executions.get(eid) : undefined;
  }

  updateExecution(id: string, patch: Partial<ExecutionRecord>): ExecutionRecord {
    const cur = this.executions.get(id);
    if (!cur) throw new Error(`execution_not_found:${id}`);
    const next: ExecutionRecord = { ...cur, ...patch, updatedAt: nowIso() };
    this.executions.set(id, next);
    return next;
  }

  createApprovalRequest(
    executionId: string,
    taskId: string,
    reason: string,
    dangerousActions: ApprovalRequest['dangerousActions']
  ): ApprovalRequest {
    const id = genId('apr');
    const req: ApprovalRequest = {
      id,
      executionId,
      taskId,
      reason,
      dangerousActions,
      status: 'pending'
    };
    this.approvals.set(id, req);
    return req;
  }

  getApproval(id: string): ApprovalRequest | undefined {
    return this.approvals.get(id);
  }

  resolveApproval(id: string, status: Extract<ApprovalStatus, 'approved' | 'rejected'>, resolvedBy: string): ApprovalRequest {
    const cur = this.approvals.get(id);
    if (!cur) throw new Error(`approval_not_found:${id}`);
    if (cur.status !== 'pending') throw new Error(`approval_already_resolved:${id}`);
    const next: ApprovalRequest = {
      ...cur,
      status,
      resolvedBy,
      resolvedAt: nowIso()
    };
    this.approvals.set(id, next);
    return next;
  }

  listPendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].filter((a) => a.status === 'pending');
  }

  listExecutionsByStatus(status: ExecutionStatus): ExecutionRecord[] {
    return [...this.executions.values()].filter((e) => e.status === status);
  }

  /** Terminal cleanup — does not delete audit trail responsibility of caller */
  finalizeExecution(id: string, status: ExecutionStatus): void {
    const cur = this.executions.get(id);
    if (!cur) return;
    this.updateExecution(id, { status });
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'escalated') {
      this.taskIndex.delete(cur.taskId);
    }
  }
}
