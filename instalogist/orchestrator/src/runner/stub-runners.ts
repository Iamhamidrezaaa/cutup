import type { AgentRunner, AgentRunContext, AgentRunResult } from './agent-runner.js';
import type { OrchestratorAgentId } from '../types.js';

function baseResult(ctx: AgentRunContext, extra: Record<string, unknown>): AgentRunResult {
  return {
    ok: true,
    structuredOutput: {
      agent: ctx.agentId,
      taskKind: ctx.task.kind,
      note: 'stub_runner_no_llm',
      ...extra
    },
    tokensUsed: 120,
    requiresHumanApproval: false
  };
}

export class StubCtoRunner implements AgentRunner {
  readonly agentId: OrchestratorAgentId = 'cto-agent';

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    return baseResult(ctx, { lens: 'strategy', recommendation: 'review_with_human_cto' });
  }
}

export class StubDeveloperRunner implements AgentRunner {
  readonly agentId: OrchestratorAgentId = 'developer-agent';

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const deployHint = String(ctx.task.payload?.simulate_deploy ?? '');
    if (deployHint === 'true') {
      return {
        ok: true,
        structuredOutput: { agent: this.agentId, simulated: 'deploy_plan_draft_only' },
        tokensUsed: 200,
        requiresHumanApproval: true,
        dangerousActionHints: ['deploy']
      };
    }
    return baseResult(ctx, { lens: 'engineering' });
  }
}

export class StubSupportRunner implements AgentRunner {
  readonly agentId: OrchestratorAgentId = 'support-agent';

  async run(ctx: AgentRunContext): Promise<AgentRunResult> {
    const esc = String(ctx.task.payload?.force_escalation ?? '');
    if (esc === 'true') {
      return {
        ok: true,
        structuredOutput: { triage: 'escalated_path' },
        tokensUsed: 80,
        requiresHumanApproval: false,
        suggestEscalation: { reason: 'customer_impact', targetAgent: 'developer-agent' }
      };
    }
    return baseResult(ctx, { lens: 'support', customer_safe: true });
  }
}
