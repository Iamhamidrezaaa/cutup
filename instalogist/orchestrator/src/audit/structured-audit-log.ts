import type { AuditLogEntry } from '../types.js';

export type AuditSink = (entry: AuditLogEntry) => void;

export class StructuredAuditLog {
  private readonly entries: AuditLogEntry[] = [];
  private readonly sinks: AuditSink[] = [];

  constructor(sinks: AuditSink[] = []) {
    this.sinks = sinks;
  }

  addSink(sink: AuditSink): void {
    this.sinks.push(sink);
  }

  emit(entry: Omit<AuditLogEntry, 'ts'> & { ts?: string }): void {
    const full: AuditLogEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      level: entry.level,
      event: entry.event,
      executionId: entry.executionId,
      taskId: entry.taskId,
      agentId: entry.agentId,
      approvalId: entry.approvalId,
      detail: entry.detail
    };
    this.entries.push(full);
    for (const s of this.sinks) {
      try {
        s(full);
      } catch {
        /* sink must not break orchestration */
      }
    }
  }

  /** In-memory tail for tests / admin UI (not for production scale). */
  getRecent(limit = 500): AuditLogEntry[] {
    return this.entries.slice(-limit);
  }
}
