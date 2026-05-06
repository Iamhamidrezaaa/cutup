import type { OrchestratorTask } from '../types.js';

/** Simple in-memory priority queue (higher priority first, then FIFO). */
export class TaskQueue {
  private readonly items: OrchestratorTask[] = [];

  enqueue(task: OrchestratorTask): void {
    this.items.push(task);
    this.items.sort((a, b) => b.priority - a.priority);
  }

  dequeue(): OrchestratorTask | undefined {
    return this.items.shift();
  }

  peek(): OrchestratorTask | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  /** Snapshot for observability */
  list(): OrchestratorTask[] {
    return [...this.items];
  }
}
