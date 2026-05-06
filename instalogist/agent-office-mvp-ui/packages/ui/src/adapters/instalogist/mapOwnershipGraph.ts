import type { AgentOfficeUiModel, OperationalStateLoose } from '@instalogist/agent-office-adapter';

export interface OwnershipGraphNode {
  id: string;
  kind: 'agent' | 'human' | 'item' | 'bucket';
  label: string;
  /** For agents: open workload */
  workload?: number;
}

export interface OwnershipGraphEdge {
  from: string;
  to: string;
  label: string;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

/**
 * Prefer parser `graph` when structurally valid; else derive from `ownership` view + unassigned bucket.
 */
export function mapOwnershipGraph(model: AgentOfficeUiModel, raw: OperationalStateLoose): {
  nodes: OwnershipGraphNode[];
  edges: OwnershipGraphEdge[];
  source: 'parser_graph' | 'ownership_projection';
} {
  const g = raw.graph;
  if (g != null && typeof g === 'object' && !Array.isArray(g)) {
    const rec = g as Record<string, unknown>;
    const nodesRaw = rec.nodes;
    const edgesRaw = rec.edges;
    if (Array.isArray(nodesRaw) && Array.isArray(edgesRaw)) {
      const nodes: OwnershipGraphNode[] = [];
      for (const n of nodesRaw) {
        if (n == null || typeof n !== 'object' || Array.isArray(n)) continue;
        const o = n as Record<string, unknown>;
        const id = str(o.id);
        if (!id) continue;
        const type = str(o.type) ?? 'item';
        const kind: OwnershipGraphNode['kind'] =
          type === 'agent' ? 'agent' : type === 'human' ? 'human' : 'item';
        nodes.push({ id, kind, label: id });
      }
      const edges: OwnershipGraphEdge[] = [];
      for (const e of edgesRaw) {
        if (e == null || typeof e !== 'object' || Array.isArray(e)) continue;
        const o = e as Record<string, unknown>;
        const from = str(o.from);
        const to = str(o.to);
        if (!from || !to) continue;
        const label = str(o.label) ?? 'rel';
        edges.push({ from, to, label });
      }
      if (nodes.length > 0) return { nodes, edges, source: 'parser_graph' };
    }
  }

  const nodes: OwnershipGraphNode[] = [];
  const edges: OwnershipGraphEdge[] = [];
  const { agents, unassigned } = model.views.ownership;

  nodes.push({
    id: '__unassigned__',
    kind: 'bucket',
    label: 'Unassigned',
    workload: unassigned.length
  });

  for (const a of agents) {
    nodes.push({
      id: a.id,
      kind: 'agent',
      label: a.id,
      workload: a.open_items
    });
    for (const it of a.items) {
      const nid = `item:${it.item_key}`;
      if (!nodes.some((x) => x.id === nid)) {
        nodes.push({ id: nid, kind: 'item', label: it.title.slice(0, 48) || it.item_key });
      }
      edges.push({ from: nid, to: a.id, label: 'owned_by' });
    }
  }
  for (const u of unassigned) {
    const nid = `item:${u.item_key}`;
    if (!nodes.some((x) => x.id === nid)) {
      nodes.push({ id: nid, kind: 'item', label: u.title.slice(0, 48) || u.item_key });
    }
    edges.push({ from: nid, to: '__unassigned__', label: 'unassigned' });
  }

  return { nodes, edges, source: 'ownership_projection' };
}
