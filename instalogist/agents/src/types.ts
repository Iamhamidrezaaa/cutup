/** Instalogist supervised agents — no autonomous deploy or payment actions. */
export type AgentKind = 'cto' | 'developer' | 'support';

export type LlmProviderKind = 'anthropic' | 'openai';

export interface OperationalContext {
  /** e.g. deployment-127 */
  deploymentLabel?: string;
  /** Free-form operational snapshot (JSON-serializable). */
  operationalState?: Record<string, unknown>;
  /** Recent incidents, SLO breaches, etc. */
  incidentsSummary?: string;
  /** Correlation / ticket ids */
  traceIds?: string[];
  /** Extra notes from orchestrator or human */
  notes?: string;
}

export interface StructuredAgentResponse {
  agentId: AgentKind;
  headline: string;
  bullets: string[];
  recommendedActions: string[];
  risks: string[];
  /** Must stay true for any destructive/external-high-risk recommendation */
  requiresHumanApproval: boolean;
  executiveSummary?: string;
  technicalNotes?: string;
  customerFacingDraft?: string;
  codeRefs?: string[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentToolInvocationRecord {
  toolId: string;
  input: unknown;
  ok: boolean;
  code?: string;
  error?: string;
  dryRun: boolean;
}

export type AgentStreamEvent =
  | { type: 'llm_text_delta'; text: string; provider: LlmProviderKind }
  | { type: 'tool_invocation'; toolId: string; phase: 'start' | 'end'; ok?: boolean }
  | { type: 'usage'; usage: TokenUsage; cumulative: TokenUsage }
  | { type: 'budget'; phase: 'check' | 'exceeded'; detail?: string }
  | { type: 'round'; llmRound: number; toolRound: number }
  | { type: 'done'; ok: boolean }
  | { type: 'error'; message: string };

export interface AgentRunOptions {
  agentId: AgentKind;
  userMessage: string;
  operationalContext: OperationalContext;
  sessionId: string;
  /** Principal forwarded to tool layer */
  principalId?: string;
  /** Role names for @instalogist/tools permission expansion */
  toolRoles?: string[];
  toolDryRun?: boolean;
  /**
   * Human gate for dangerous tools (summarize_logs, github_search, create_task) in non-dry-run.
   */
  dangerousToolApprovalGranted?: boolean;
  maxToolRounds?: number;
  /** Hard cap on LLM API round-trips (includes tool follow-ups). */
  maxLlmRounds?: number;
  /** Emit streaming events (text deltas when provider supports stream for that round). */
  stream?: boolean;
  modelOverride?: string;
}

export interface OperationalRunSummary {
  agentId: AgentKind;
  sessionId: string;
  startedAt: string;
  finishedAt: string;
  usage: TokenUsage;
  toolCalls: number;
  toolFailures: number;
  dangerousToolsUsed: string[];
  humanSupervision: {
    dryRun: boolean;
    dangerousApprovalGranted: boolean;
  };
  structuredPresent: boolean;
  headline?: string;
  risks?: string[];
}

export interface AgentRunResult {
  ok: boolean;
  agentId: AgentKind;
  structured?: StructuredAgentResponse;
  rawAssistantText?: string;
  parseError?: string;
  usage: TokenUsage;
  toolInvocations: AgentToolInvocationRecord[];
  summary: OperationalRunSummary;
}
