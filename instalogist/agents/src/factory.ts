import { createDefaultToolkit } from '@instalogist/tools';
import { createInstalogistAgentRuntime } from './execution/agent-runtime.js';
import type { AgentLogSink } from './logging/agent-logger.js';
import { InMemoryRetriever } from './memory/memory-retriever.js';
import { AnthropicClient, OpenAiClient } from './providers/llm-client.js';
import type { LlmProviderKind } from './types.js';
import type { TokenBudgetConfig } from './budget/token-budget.js';

export function createLlmClient(kind: LlmProviderKind): OpenAiClient | AnthropicClient {
  if (kind === 'openai') {
    const k = process.env.OPENAI_API_KEY?.trim();
    if (!k) throw new Error('OPENAI_API_KEY is not set');
    return new OpenAiClient(k);
  }
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set');
  return new AnthropicClient(k);
}

/**
 * Opinionated wiring: default secure toolkit + in-memory memory + supervised runtime.
 * Swap `memory` in your orchestrator for Prisma/vector backends.
 */
export function createSupervisedAgentStack(
  kind: LlmProviderKind,
  options?: { logSink?: AgentLogSink; budget?: TokenBudgetConfig }
) {
  const toolkit = createDefaultToolkit();
  const llm = createLlmClient(kind);
  const memory = new InMemoryRetriever();
  const runtime = createInstalogistAgentRuntime({
    llm,
    executor: toolkit.executor,
    memory,
    budget: options?.budget,
    logSink: options?.logSink
  });
  return { toolkit, llm, memory, runtime };
}
