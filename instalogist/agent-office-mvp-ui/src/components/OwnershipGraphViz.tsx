import type { OwnershipGraphEdge, OwnershipGraphNode } from '@agent-office-ui/adapters/instalogist';

export function OwnershipGraphViz({
  nodes,
  edges,
  source
}: {
  nodes: OwnershipGraphNode[];
  edges: OwnershipGraphEdge[];
  source: string;
}): JSX.Element {
  if (nodes.length === 0) {
    return <p className="empty-hint">No ownership graph nodes.</p>;
  }
  const agentNodes = nodes.filter((n) => n.kind === 'agent');
  const itemNodes = nodes.filter((n) => n.kind === 'item');
  return (
    <div className="ownership-graph-viz" role="region" aria-label="Ownership graph">
      <p className="graph-source-hint">
        Source: <code>{source}</code> — read-only projection
      </p>
      <div className="graph-columns">
        <div>
          <h4 className="graph-col-title">Agents ({agentNodes.length})</h4>
          <ul className="graph-node-list">
            {agentNodes.map((n) => (
              <li key={n.id}>
                <strong>{n.label}</strong>
                {n.workload != null && <span className="graph-wl"> — open: {n.workload}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="graph-col-title">Items (sample {Math.min(itemNodes.length, 24)} / {itemNodes.length})</h4>
          <ul className="graph-node-list compact">
            {itemNodes.slice(0, 24).map((n) => (
              <li key={n.id} title={n.id}>
                {n.label}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="graph-col-title">Edges (sample {Math.min(edges.length, 40)} / {edges.length})</h4>
          <ul className="graph-edge-list">
            {edges.slice(0, 40).map((e, i) => (
              <li key={i}>
                <code>{e.from}</code> <span className="graph-edge-label">{e.label}</span> <code>{e.to}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
