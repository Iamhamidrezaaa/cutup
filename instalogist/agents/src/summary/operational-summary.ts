import type {
  AgentKind,
  AgentToolInvocationRecord,
  OperationalRunSummary,
  StructuredAgentResponse,
  TokenUsage
} from '../types.js';

export function buildOperationalSummary(params: {
  agentId: AgentKind;
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  usage: TokenUsage;
  invocations: AgentToolInvocationRecord[];
  dryRun: boolean;
  dangerousApprovalGranted: boolean;
  structured?: StructuredAgentResponse;
}): OperationalRunSummary {
  const dangerous = new Set(['github_search', 'summarize_logs', 'create_task']);
  const dangerousUsed = params.invocations
    .filter((i) => dangerous.has(i.toolId) && i.ok)
    .map((i) => i.toolId);
  return {
    agentId: params.agentId,
    sessionId: params.sessionId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    usage: params.usage,
    toolCalls: params.invocations.length,
    toolFailures: params.invocations.filter((i) => !i.ok).length,
    dangerousToolsUsed: [...new Set(dangerousUsed)],
    humanSupervision: {
      dryRun: params.dryRun,
      dangerousApprovalGranted: params.dangerousApprovalGranted
    },
    structuredPresent: params.structured != null,
    headline: params.structured?.headline,
    risks: params.structured?.risks
  };
}
