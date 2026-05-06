import type { TokenUsage } from '../types.js';

export interface TokenBudgetConfig {
  /** Max input+output tokens recorded for a single agent run */
  perRunHardCap: number;
  /** Optional global soft cap for concurrent sessions (not enforced across processes) */
  perSessionSoftCap?: number;
}

/**
 * Enforces token ceilings for a single run. Providers report usage after each completion.
 */
export class TokenBudget {
  private sessionUsed = 0;
  private runUsed = 0;

  constructor(
    private readonly config: TokenBudgetConfig,
    private readonly sessionId: string
  ) {}

  get runTotal(): number {
    return this.runUsed;
  }

  canConsume(estimated: TokenUsage): { ok: boolean; reason?: string } {
    const add = estimated.inputTokens + estimated.outputTokens;
    if (this.runUsed + add > this.config.perRunHardCap) {
      return { ok: false, reason: 'per_run_hard_cap_exceeded' };
    }
    const soft = this.config.perSessionSoftCap;
    if (soft != null && this.sessionUsed + add > soft) {
      return { ok: false, reason: 'per_session_soft_cap_exceeded' };
    }
    return { ok: true };
  }

  record(usage: TokenUsage): void {
    const add = usage.inputTokens + usage.outputTokens;
    this.runUsed += add;
    this.sessionUsed += add;
  }

  /** Session id for logging only */
  getSessionId(): string {
    return this.sessionId;
  }
}

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
  perRunHardCap: 120_000,
  perSessionSoftCap: 250_000
};
