/**
 * Build ownership / escalation graph from parsed items.
 * @param {Array<{ source_path: string, fields: Record<string, unknown>, parse_status: string }>} items
 * @returns {{ nodes: Array<{ id: string, type: string }>, edges: Array<{ from: string, to: string, label: string }> }}
 */
export function buildGraph(items) {
  const nodes = new Map();
  const edges = [];

  function addNode(id, type) {
    if (!id) return;
    if (!nodes.has(id)) nodes.set(id, { id, type });
  }

  for (const item of items) {
    if (item.parse_status === 'empty') continue;

    const f = item.fields || {};
    const itemId =
      (typeof f.task_id === 'string' && f.task_id) ||
      (typeof f.incident_id === 'string' && f.incident_id) ||
      `path:${item.source_path}`;

    addNode(itemId, 'item');

    const owner = f.owner_agent;
    if (typeof owner === 'string' && owner.trim()) {
      addNode(owner, 'agent');
      edges.push({ from: itemId, to: owner, label: 'owns' });
    }

    const collab = f.collaborators;
    if (Array.isArray(collab)) {
      for (const c of collab) {
        if (typeof c === 'string' && c.trim()) {
          addNode(c, 'agent');
          edges.push({ from: itemId, to: c, label: 'collaborates' });
        }
      }
    }

    const human = f.human_owner;
    if (typeof human === 'string' && human.includes('@')) {
      addNode(human, 'human');
      edges.push({ from: itemId, to: human, label: 'human_owner' });
    }

    const esc = f.escalation;
    if (esc && typeof esc === 'object' && !Array.isArray(esc)) {
      const fromAgent = esc.from_agent;
      if (typeof fromAgent === 'string' && fromAgent.trim()) {
        addNode(fromAgent, 'agent');
        edges.push({ from: itemId, to: fromAgent, label: 'escalated_from' });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges
  };
}
