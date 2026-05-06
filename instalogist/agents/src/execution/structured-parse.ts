import type { AgentKind, StructuredAgentResponse } from '../types.js';

export function extractJsonFromAssistantText(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  return JSON.parse(raw) as unknown;
}

export function normalizeStructuredResponse(
  agentId: AgentKind,
  raw: unknown
): { structured: StructuredAgentResponse } | { error: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'structured_not_object' };
  }
  const o = raw as Record<string, unknown>;
  const headline = typeof o.headline === 'string' ? o.headline : '';
  const bullets = Array.isArray(o.bullets) ? o.bullets.filter((x): x is string => typeof x === 'string') : [];
  const recommendedActions = Array.isArray(o.recommendedActions)
    ? o.recommendedActions.filter((x): x is string => typeof x === 'string')
    : [];
  const risks = Array.isArray(o.risks) ? o.risks.filter((x): x is string => typeof x === 'string') : [];
  const requiresHumanApproval = o.requiresHumanApproval === true;
  if (!headline && bullets.length === 0) {
    return { error: 'structured_empty' };
  }
  const structured: StructuredAgentResponse = {
    agentId,
    headline: headline || '(no headline)',
    bullets,
    recommendedActions,
    risks,
    requiresHumanApproval,
    executiveSummary: typeof o.executiveSummary === 'string' ? o.executiveSummary : undefined,
    technicalNotes: typeof o.technicalNotes === 'string' ? o.technicalNotes : undefined,
    customerFacingDraft: typeof o.customerFacingDraft === 'string' ? o.customerFacingDraft : undefined,
    codeRefs: Array.isArray(o.codeRefs) ? o.codeRefs.filter((x): x is string => typeof x === 'string') : undefined
  };
  return { structured };
}

export function safeParseStructured(
  agentId: AgentKind,
  text: string
): { structured?: StructuredAgentResponse; parseError?: string } {
  try {
    const raw = extractJsonFromAssistantText(text);
    const n = normalizeStructuredResponse(agentId, raw);
    if ('error' in n) return { parseError: n.error };
    return { structured: n.structured };
  } catch {
    return { parseError: 'json_parse_failed' };
  }
}
