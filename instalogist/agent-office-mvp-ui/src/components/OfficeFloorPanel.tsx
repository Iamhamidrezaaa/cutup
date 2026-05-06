import type { AgentDesk } from '@agent-office-ui/adapters/instalogist';
import type { InstalogistUiMode } from '../lib/uiMode';
import { CardBadges } from './Badges';

function severityClass(sev: AgentDesk['worstSeverity']): string {
  if (sev === 'critical') return 'desk-sev-critical';
  if (sev === 'high') return 'desk-sev-high';
  if (sev === 'medium') return 'desk-sev-medium';
  if (sev === 'low') return 'desk-sev-low';
  return '';
}

export function OfficeFloorPanel({
  desks,
  mode
}: {
  desks: AgentDesk[];
  mode: InstalogistUiMode;
}): JSX.Element {
  const showDemoFill = mode === 'demo' && desks.length === 0;
  const demoDesks: AgentDesk[] = showDemoFill
    ? [
        {
          agentId: 'Demo-Agent-Alpha',
          deskSlot: 0,
          avatarHue: 200,
          tasks: [],
          openTaskCount: 0,
          staleCount: 0,
          maxPriority: null,
          maxRisk: null,
          worstSeverity: 'none'
        },
        {
          agentId: 'Demo-Agent-Beta',
          deskSlot: 1,
          avatarHue: 40,
          tasks: [],
          openTaskCount: 0,
          staleCount: 0,
          maxPriority: null,
          maxRisk: null,
          worstSeverity: 'none'
        }
      ]
    : [];

  const all = [...desks, ...demoDesks].sort((a, b) => a.deskSlot - b.deskSlot);

  return (
    <div className="office-floor" role="region" aria-label="Office floor — desk assignment from owner_agent">
      {mode === 'demo' && (
        <p className="demo-hint">
          Demo mode: optional idle desks appear when there is no operational workload. Operational mode uses only parser-backed
          agents.
        </p>
      )}
      <div className="desk-grid">
        {all.map((d) => (
          <div key={d.agentId} className={`desk-card ${severityClass(d.worstSeverity)}`}>
            <div className="desk-avatar" style={{ background: `hsl(${d.avatarHue} 45% 38%)` }} title={d.agentId} />
            <div className="desk-agent-name">{d.agentId}</div>
            <div className="desk-stats">
              Tasks: {d.openTaskCount}
              {d.staleCount > 0 && <span className="desk-stale"> · stale {d.staleCount}</span>}
            </div>
            {d.tasks.slice(0, 4).map((t) => (
              <div key={t.item_key + t.source_path} className="desk-task-preview">
                <div className="desk-task-title">{t.title}</div>
                <CardBadges card={t} />
              </div>
            ))}
            {d.tasks.length > 4 && <div className="desk-more">+{d.tasks.length - 4} more</div>}
          </div>
        ))}
      </div>
      {all.length === 0 && <p className="empty-hint">No desks — load operational-state.json with tasks.</p>}
    </div>
  );
}
