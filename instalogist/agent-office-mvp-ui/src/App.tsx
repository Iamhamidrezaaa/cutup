import { useMemo, useState } from 'react';
import {
  mapEscalations,
  mapIncidentsToEvents,
  mapOwnershipGraph,
  mapTasksToAgents,
  mergeOperationalTimelineEvents
} from '@agent-office-ui/adapters/instalogist';
import { BoardKanban } from './components/BoardKanban';
import { DegradedPanel, EscalationStrip, OperationalRail, StaleTasksList } from './components/OperationalRail';
import { IncidentsPanel } from './components/IncidentsPanel';
import { OwnershipPanel } from './components/OwnershipPanel';
import { ParserStatusBanner, SummaryHealthBanner } from './components/Banners';
import { OfficeFloorPanel } from './components/OfficeFloorPanel';
import { OperationalIssuesBanner } from './components/OperationalIssuesBanner';
import { OperationalOverlay } from './components/OperationalOverlay';
import { OperationalTimelinePanel } from './components/OperationalTimelinePanel';
import { OwnershipGraphViz } from './components/OwnershipGraphViz';
import { useAgentOfficeModel } from './hooks/useAgentOfficeModel';
import { getOperationalStateUrl } from './lib/snapshotUrl';
import { type InstalogistUiMode, getUiMode, setUiMode } from './lib/uiMode';

type TabId = 'board' | 'incidents' | 'ownership' | 'floor' | 'timeline' | 'graph';

export function App(): JSX.Element {
  const url = useMemo(() => getOperationalStateUrl(), []);
  const { status, model, operational, fetchError, lastFetchedAt, refresh } = useAgentOfficeModel(url);
  const [tab, setTab] = useState<TabId>('board');
  const [uiMode, setUiModeState] = useState<InstalogistUiMode>(() => getUiMode());

  const desks = useMemo(() => (model ? mapTasksToAgents(model) : []), [model]);
  const timeline = useMemo(() => {
    if (model == null || operational == null) return [];
    return mergeOperationalTimelineEvents(mapIncidentsToEvents(model), mapEscalations(operational.raw));
  }, [model, operational]);
  const ownershipGraph = useMemo(() => {
    if (model == null || operational == null) return null;
    return mapOwnershipGraph(model, operational.raw);
  }, [model, operational]);

  const changeMode = (m: InstalogistUiMode) => {
    setUiMode(m);
    setUiModeState(m);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Instalogist — Agent Office (MVP)</h1>
          <p className="app-sub">Read-only operational view · no task mutations · no CutUp production link</p>
        </div>
        <dl className="header-meta">
          <dt>Snapshot (source)</dt>
          <dd>{model?.source.generated_at ?? '—'}</dd>
          <dt>UI adapted at</dt>
          <dd>{model?.adapted_at ?? '—'}</dd>
          <dt>Last fetch</dt>
          <dd>{lastFetchedAt ?? '—'}</dd>
          <dt>Data URL</dt>
          <dd title={url} style={{ wordBreak: 'break-all' }}>
            {url}
          </dd>
        </dl>
        <button
          type="button"
          className="btn-refresh"
          onClick={() => void refresh()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="mode-toolbar">
        <label htmlFor="ui-mode">UI mode</label>
        <select
          id="ui-mode"
          className="mode-select"
          value={uiMode}
          onChange={(e) => changeMode(e.target.value as InstalogistUiMode)}
          aria-label="Demo or operational UI mode"
        >
          <option value="operational">Operational (parser-backed only)</option>
          <option value="demo">Demo (optional idle simulation desks)</option>
        </select>
      </div>

      {fetchError != null && (
        <div className="error-box" role="alert">
          <strong>Load error.</strong> {fetchError}
        </div>
      )}

      {status === 'loading' && model == null && <div className="loading">Loading operational snapshot…</div>}

      {model != null && operational != null && (
        <>
          <OperationalIssuesBanner operational={operational} />

          <div className="banner-row">
            <ParserStatusBanner model={model} />
            <SummaryHealthBanner model={model} />
          </div>

          <OperationalRail model={model} />

          <div className="panel">
            <h2>Escalations</h2>
            <EscalationStrip model={model} />
          </div>
          <div className="panel">
            <h2>Stale tasks</h2>
            <StaleTasksList model={model} />
          </div>
          <div className="panel">
            <h2>Degraded warnings</h2>
            <DegradedPanel model={model} />
          </div>

          <nav className="tabs" aria-label="Primary views">
            {(
              [
                ['board', 'Kanban'],
                ['floor', 'Office floor'],
                ['timeline', 'Timeline'],
                ['graph', 'Ownership graph'],
                ['incidents', 'Incidents'],
                ['ownership', 'Ownership']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tab ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === 'board' && <BoardKanban board={model.views.board} />}
          {tab === 'floor' && <OfficeFloorPanel desks={desks} mode={uiMode} />}
          {tab === 'timeline' && <OperationalTimelinePanel events={timeline} />}
          {tab === 'graph' && ownershipGraph != null && (
            <OwnershipGraphViz nodes={ownershipGraph.nodes} edges={ownershipGraph.edges} source={ownershipGraph.source} />
          )}
          {tab === 'incidents' && <IncidentsPanel incidents={model.views.incidents} />}
          {tab === 'ownership' && <OwnershipPanel ownership={model.views.ownership} />}

          <OperationalOverlay model={model} onOpenTimeline={() => setTab('timeline')} />
        </>
      )}
    </div>
  );
}
