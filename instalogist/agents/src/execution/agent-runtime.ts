import { buildCaller } from '@instalogist/tools';
import type { ToolExecutionOptions } from '@instalogist/tools';
import type { SecureToolExecutor } from '@instalogist/tools';
import { buildAgentSystemPrompt, defaultToolRoles } from '../agents/presets.js';
import type { TokenBudgetConfig } from '../budget/token-budget.js';
import { DEFAULT_TOKEN_BUDGET, TokenBudget } from '../budget/token-budget.js';
import type { InternalMessage } from './internal-messages.js';
import { safeParseStructured } from './structured-parse.js';
import type { MemoryRetriever } from '../memory/memory-retriever.js';
import { AgentLogger, type AgentLogSink } from '../logging/agent-logger.js';
import type { LlmClient } from '../providers/llm-client.js';
import { INSTALOGIST_LLM_TOOLS } from '../tools/llm-tool-schemas.js';
import { invokeInstalogistTool } from '../tools/tool-bridge.js';
import { buildOperationalSummary } from '../summary/operational-summary.js';
import type {
  AgentRunOptions,
  AgentRunResult,
  AgentStreamEvent,
  AgentToolInvocationRecord,
  OperationalContext,
  TokenUsage
} from '../types.js';

function resolveModel(clientKind: 'openai' | 'anthropic', override?: string): string {
  if (override?.trim()) return override.trim();
  if (clientKind === 'openai') return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  return process.env.ANTHROPIC_MODEL?.trim() || 'claude-3-5-sonnet-20241022';
}

function formatOperationalBlock(ctx: OperationalContext): string {
  try {
    return JSON.stringify(ctx, null, 2);
  } catch {
    return String(ctx);
  }
}

function enrichUserMessage(userMessage: string, memoryBlock: string): string {
  if (!memoryBlock) return userMessage;
  return `${userMessage}\n\n### Retrieved memory\n${memoryBlock}`;
}

export class InstalogistAgentRuntime {
  private readonly log: AgentLogger;

  constructor(
    private readonly llm: LlmClient,
    private readonly executor: SecureToolExecutor,
    private readonly memory: MemoryRetriever,
    private readonly budgetConfig: TokenBudgetConfig,
    sink?: AgentLogSink
  ) {
    this.log = new AgentLogger(`instalogist.agent.${llm.kind}`, sink);
  }

  async run(options: AgentRunOptions, stream?: (e: AgentStreamEvent) => void): Promise<AgentRunResult> {
    const startedAt = new Date().toISOString();
    const budget = new TokenBudget(this.budgetConfig, options.sessionId);
    const maxToolRounds = options.maxToolRounds ?? 6;
    const maxLlmRounds = options.maxLlmRounds ?? 10;
    const dryRun = options.toolDryRun ?? false;
    const approval = options.dangerousToolApprovalGranted ?? false;

    const memoryHits = await this.memory.retrieve({
      query: options.userMessage,
      sessionId: options.sessionId,
      limit: 8
    });
    const memoryBlock = memoryHits.map((h) => `- (${h.id}) ${h.text}`).join('\n');

    const system = `${buildAgentSystemPrompt(options.agentId)}\n\n### Operational context (trusted)\n${formatOperationalBlock(options.operationalContext)}`;
    const userText = enrichUserMessage(options.userMessage, memoryBlock);

    const internal: InternalMessage[] = [{ role: 'user', text: userText }];

    const principalId = options.principalId ?? `agent:${options.agentId}:${options.sessionId}`;
    const roles = options.toolRoles ?? defaultToolRoles(options.agentId);
    const caller = buildCaller(principalId, roles);
    const toolOptions: ToolExecutionOptions = {
      dryRun,
      approvalGranted: approval,
      caller
    };

    const invocations: AgentToolInvocationRecord[] = [];
    const cumulative: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let llmRound = 0;
    let toolIterations = 0;
    let lastFingerprint = '';
    let repeatStreak = 0;
    let finalAssistantText = '';
    let stoppedReason: string | undefined;

    const model = resolveModel(this.llm.kind, options.modelOverride);
    const maxOut = 4096;

    this.log.info('run_start', {
      agentId: options.agentId,
      sessionId: options.sessionId,
      provider: this.llm.kind,
      model,
      dryRun,
      approval
    });

    while (llmRound < maxLlmRounds) {
      llmRound += 1;
      stream?.({ type: 'round', llmRound, toolRound: toolIterations });

      const reserve = { inputTokens: 8000, outputTokens: 4000 };
      const pre = budget.canConsume(reserve);
      if (!pre.ok) {
        this.log.warn('budget_block', { reason: pre.reason, llmRound });
        stream?.({ type: 'budget', phase: 'exceeded', detail: pre.reason });
        stoppedReason = pre.reason;
        break;
      }

      const turn = await this.llm.completeTurn({
        system,
        internalMessages: internal,
        tools: INSTALOGIST_LLM_TOOLS,
        maxOutputTokens: maxOut,
        model,
        stream: options.stream ?? false,
        onTextDelta: options.stream
          ? (chunk) => stream?.({ type: 'llm_text_delta', text: chunk, provider: this.llm.kind })
          : undefined
      });

      budget.record(turn.usage);
      cumulative.inputTokens += turn.usage.inputTokens;
      cumulative.outputTokens += turn.usage.outputTokens;
      stream?.({ type: 'usage', usage: turn.usage, cumulative: { ...cumulative } });

      if (turn.toolInvocations.length > 0) {
        toolIterations += 1;
        if (toolIterations > maxToolRounds) {
          this.log.warn('max_tool_rounds', { toolIterations });
          stoppedReason = 'max_tool_rounds_exceeded';
          finalAssistantText = turn.text;
          break;
        }

        const fp = JSON.stringify(
          turn.toolInvocations.map((t) => ({ name: t.name, input: t.input })).sort((a, b) => a.name.localeCompare(b.name))
        );
        if (fp === lastFingerprint) repeatStreak += 1;
        else repeatStreak = 0;
        lastFingerprint = fp;
        if (repeatStreak >= 2) {
          this.log.warn('tool_repeat_loop_break');
          stoppedReason = 'repeated_tool_signature';
          finalAssistantText = turn.text;
          break;
        }

        internal.push({
          role: 'assistant',
          text: turn.text || undefined,
          toolInvocations: turn.toolInvocations
        });

        for (const t of turn.toolInvocations) {
          stream?.({ type: 'tool_invocation', toolId: t.name, phase: 'start' });
          this.log.info('tool_start', { toolId: t.name, dryRun, approval });
          const exec = await invokeInstalogistTool(this.executor, t.name, t.input, toolOptions);
          invocations.push({
            toolId: exec.toolId === '__unknown__' ? t.name : exec.toolId,
            input: t.input,
            ok: exec.ok,
            code: exec.code,
            error: exec.error,
            dryRun
          });
          stream?.({ type: 'tool_invocation', toolId: t.name, phase: 'end', ok: exec.ok });
          this.log.info('tool_end', { toolId: t.name, ok: exec.ok, code: exec.code });
          internal.push({
            role: 'tool',
            toolCallId: t.id,
            name: t.name,
            resultJson: exec.resultJson
          });
        }
        continue;
      }

      finalAssistantText = turn.text;
      break;
    }

    if (llmRound >= maxLlmRounds && !stoppedReason) {
      stoppedReason = 'max_llm_rounds_exceeded';
      this.log.warn('max_llm_rounds');
    }

    const finishedAt = new Date().toISOString();
    const parsed = safeParseStructured(options.agentId, finalAssistantText);
    const summary = buildOperationalSummary({
      agentId: options.agentId,
      sessionId: options.sessionId,
      startedAt,
      finishedAt,
      usage: cumulative,
      invocations,
      dryRun,
      dangerousApprovalGranted: approval,
      structured: parsed.structured
    });

    this.log.info('run_end', {
      ok: !parsed.parseError && !stoppedReason,
      toolCalls: invocations.length,
      usage: cumulative,
      stoppedReason
    });

    stream?.({ type: 'done', ok: !parsed.parseError && !stoppedReason });

    const ok = !parsed.parseError && !stoppedReason;
    return {
      ok,
      agentId: options.agentId,
      structured: parsed.structured,
      rawAssistantText: finalAssistantText,
      parseError: parsed.parseError ?? stoppedReason,
      usage: cumulative,
      toolInvocations: invocations,
      summary
    };
  }
}

export function createInstalogistAgentRuntime(params: {
  llm: LlmClient;
  executor: SecureToolExecutor;
  memory: MemoryRetriever;
  budget?: TokenBudgetConfig;
  logSink?: AgentLogSink;
}): InstalogistAgentRuntime {
  return new InstalogistAgentRuntime(
    params.llm,
    params.executor,
    params.memory,
    params.budget ?? DEFAULT_TOKEN_BUDGET,
    params.logSink
  );
}
