import type { ToolAuditEntry } from '../types.js';

export type ToolAuditSink = (entry: ToolAuditEntry) => void;

export class ToolAuditLog {
  private readonly entries: ToolAuditEntry[] = [];
  private readonly sinks: ToolAuditSink[] = [];

  constructor(sinks: ToolAuditSink[] = []) {
    this.sinks = sinks;
  }

  emit(entry: ToolAuditEntry): void {
    this.entries.push(entry);
    for (const s of this.sinks) {
      try {
        s(entry);
      } catch {
        /* ignore */
      }
    }
  }

  getRecent(limit = 500): ToolAuditEntry[] {
    return this.entries.slice(-limit);
  }
}
