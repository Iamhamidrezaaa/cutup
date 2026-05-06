import type { RateLimitConfig, ToolId } from './types.js';

type Bucket = { count: number; windowStart: number };

export class ToolRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly config: RateLimitConfig) {}

  private key(principalId: string, toolId: ToolId): string {
    return `${principalId}:${toolId}`;
  }

  /** Returns true if call is allowed (and consumes one slot). */
  tryConsume(principalId: string, toolId: ToolId): boolean {
    const k = this.key(principalId, toolId);
    const now = Date.now();
    let b = this.buckets.get(k);
    if (!b || now - b.windowStart >= this.config.windowMs) {
      b = { count: 0, windowStart: now };
    }
    if (b.count >= this.config.maxCallsPerWindow) {
      return false;
    }
    b.count += 1;
    this.buckets.set(k, b);
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxCallsPerWindow: 60,
  windowMs: 60_000
};
