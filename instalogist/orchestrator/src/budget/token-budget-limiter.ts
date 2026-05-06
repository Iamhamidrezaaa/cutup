import type { TokenBudgetConfig } from '../types.js';

/**
 * Tracks token usage per tick and per execution. Runners must report actual usage;
 * this layer enforces caps only (no LLM calls here).
 */
export class TokenBudgetLimiter {
  private tickUsed = 0;
  private readonly perExecutionTotals = new Map<string, number>();

  constructor(private readonly config: TokenBudgetConfig) {}

  get perExecutionHardCap(): number {
    return this.config.perExecutionHardCap;
  }

  resetTick(): void {
    this.tickUsed = 0;
  }

  canStartExecution(estimatedTokens = 0): { ok: boolean; reason?: string } {
    if (this.tickUsed + estimatedTokens > this.config.perTickSoftCap) {
      return { ok: false, reason: 'per_tick_soft_cap_exceeded' };
    }
    return { ok: true };
  }

  /** Returns false if execution would exceed hard cap for this step. */
  canConsumeForExecution(executionId: string, additionalTokens: number): { ok: boolean; reason?: string } {
    const prev = this.perExecutionTotals.get(executionId) ?? 0;
    if (prev + additionalTokens > this.config.perExecutionHardCap) {
      return { ok: false, reason: 'per_execution_hard_cap_exceeded' };
    }
    if (this.tickUsed + additionalTokens > this.config.perTickSoftCap) {
      return { ok: false, reason: 'per_tick_soft_cap_exceeded' };
    }
    return { ok: true };
  }

  recordUsage(executionId: string, tokens: number): void {
    const prev = this.perExecutionTotals.get(executionId) ?? 0;
    this.perExecutionTotals.set(executionId, prev + tokens);
    this.tickUsed += tokens;
  }

  getExecutionTotal(executionId: string): number {
    return this.perExecutionTotals.get(executionId) ?? 0;
  }

  clearExecution(executionId: string): void {
    this.perExecutionTotals.delete(executionId);
  }
}
