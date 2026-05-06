import type { AgentOfficeUiModel, BoardCard } from '@instalogist/agent-office-adapter';

export type SeverityToken = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface AgentDesk {
  agentId: string;
  /** Stable slot 0..deskCount-1 for floor grid */
  deskSlot: number;
  /** CSS hue 0-360 for avatar/disc */
  avatarHue: number;
  tasks: BoardCard[];
  openTaskCount: number;
  staleCount: number;
  maxPriority: string | null;
  maxRisk: string | null;
  worstSeverity: SeverityToken;
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function deskSlotFor(agentId: string, deskCount: number): number {
  if (deskCount <= 0) return 0;
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 37 + agentId.charCodeAt(i)) >>> 0;
  return h % deskCount;
}

function prioritySeverity(p: string | null): SeverityToken {
  if (!p) return 'none';
  const u = p.toUpperCase();
  if (u === 'P0') return 'critical';
  if (u === 'P1') return 'high';
  if (u === 'P2') return 'medium';
  if (u === 'P3') return 'low';
  return 'low';
}

function riskSeverity(r: string | null): SeverityToken {
  if (!r) return 'none';
  const u = r.toUpperCase();
  if (u === 'C' || u === 'H') return 'critical';
  if (u === 'M') return 'medium';
  if (u === 'L') return 'low';
  return 'low';
}

function maxSev(a: SeverityToken, b: SeverityToken): SeverityToken {
  const rank: Record<SeverityToken, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    none: 0
  };
  return rank[a] >= rank[b] ? a : b;
}

function flattenBoardCards(model: AgentOfficeUiModel): BoardCard[] {
  const out: BoardCard[] = [];
  for (const col of model.views.board.columns) out.push(...col.cards);
  out.push(...model.views.board.orphan_cards);
  return out;
}

/**
 * Maps operational tasks/growth on the board to agent desks (avatar / desk assignment).
 * `owner_agent` groups cards; lifecycle columns already applied in `model`.
 */
export function mapTasksToAgents(model: AgentOfficeUiModel, deskCount = 8): AgentDesk[] {
  const cards = flattenBoardCards(model);
  const byOwner = new Map<string, BoardCard[]>();
  for (const c of cards) {
    const owner = c.owner_agent ?? '— unassigned —';
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(c);
  }
  const agents = [...byOwner.keys()].sort((a, b) => a.localeCompare(b));
  return agents.map((agentId) => {
    const tasks = byOwner.get(agentId)!;
    const staleCount = tasks.filter((t) => t.stale || t.blocked_stale).length;
    let maxPriority: string | null = null;
    let maxRisk: string | null = null;
    let worstSeverity: SeverityToken = 'none';
    const priRank = (p: string | null) => (p?.toUpperCase() === 'P0' ? 0 : p?.toUpperCase() === 'P1' ? 1 : 2);
    for (const t of tasks) {
      worstSeverity = maxSev(worstSeverity, maxSev(prioritySeverity(t.priority), riskSeverity(t.risk_class)));
      if (t.priority != null) {
        if (maxPriority == null || priRank(t.priority) < priRank(maxPriority)) maxPriority = t.priority;
      }
      if (t.risk_class != null) {
        if (maxRisk == null || riskSeverity(t.risk_class) > riskSeverity(maxRisk)) maxRisk = t.risk_class;
      }
    }
    return {
      agentId,
      deskSlot: deskSlotFor(agentId, deskCount),
      avatarHue: hashHue(agentId),
      tasks,
      openTaskCount: tasks.length,
      staleCount,
      maxPriority,
      maxRisk,
      worstSeverity
    };
  });
}
