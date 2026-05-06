import type { AgentRegistryEntry, OrchestratorAgentId } from '../types.js';

const DEFAULT_AGENTS: AgentRegistryEntry[] = [
  {
    id: 'cto-agent',
    displayName: 'CTO Agent',
    capabilities: ['strategy', 'architecture_review', 'prioritization', 'escalation_decision'],
    maxConcurrency: 2
  },
  {
    id: 'developer-agent',
    displayName: 'Developer Agent',
    capabilities: ['implementation_plan', 'code_review_suggestion', 'debug_hypothesis', 'technical_design'],
    maxConcurrency: 4
  },
  {
    id: 'support-agent',
    displayName: 'Support Agent',
    capabilities: ['triage', 'customer_safe_summary', 'routing_suggestion', 'incident_intake'],
    maxConcurrency: 6
  }
];

export class AgentRegistry {
  private readonly byId = new Map<OrchestratorAgentId, AgentRegistryEntry>();

  constructor(seed: AgentRegistryEntry[] = DEFAULT_AGENTS) {
    for (const a of seed) {
      this.byId.set(a.id, a);
    }
  }

  register(entry: AgentRegistryEntry): void {
    this.byId.set(entry.id, entry);
  }

  get(id: OrchestratorAgentId): AgentRegistryEntry | undefined {
    return this.byId.get(id);
  }

  list(): AgentRegistryEntry[] {
    return [...this.byId.values()];
  }

  resolveAgentForTask(kind: string, preferred?: OrchestratorAgentId): OrchestratorAgentId {
    if (preferred && this.byId.has(preferred)) return preferred;
    const k = kind.toLowerCase();
    if (k.includes('support') || k.includes('customer') || k.includes('ticket')) return 'support-agent';
    if (k.includes('strategy') || k.includes('architecture') || k.includes('priorit')) return 'cto-agent';
    return 'developer-agent';
  }
}
