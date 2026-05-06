import type { ExecutionRecord, OrchestratorAgentId } from '../types.js';

export interface EscalationOutcome {
  status: 'escalated';
  reason: string;
  suggestedOwner?: OrchestratorAgentId;
}

export function buildEscalationRecord(
  reason: string,
  suggestedOwner?: OrchestratorAgentId
): Pick<ExecutionRecord, 'escalationReason' | 'status'> {
  return {
    status: 'escalated',
    escalationReason: suggestedOwner ? `${reason} → ${suggestedOwner}` : reason
  };
}
