import type { RetryPolicy } from '../types.js';

export function computeRetryDelayMs(policy: RetryPolicy, attemptZeroBased: number): number {
  const raw = policy.baseDelayMs * Math.pow(policy.multiplier, attemptZeroBased);
  return Math.min(policy.maxDelayMs, Math.floor(raw));
}

export function shouldRetry(policy: RetryPolicy, attemptCount: number): boolean {
  return attemptCount < policy.maxAttempts;
}
