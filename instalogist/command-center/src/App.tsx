import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppHeader } from './components/layout/AppHeader';
import { AgentActivityPage } from './pages/AgentActivityPage';
import { BudgetPage } from './pages/BudgetPage';
import { HealthPage } from './pages/HealthPage';
import { OperationalDecisionsPage } from './pages/OperationalDecisionsPage';
import { RiskSignalsPage } from './pages/RiskSignalsPage';
import { WorkforcePage } from './pages/WorkforcePage';
import { useOperationalSnapshot } from './state/useOperationalSnapshot';
import './styles/global.css';

export default function App() {
  const { phase, state, error, url, reload, lastLoadedAt, pollIntervalMs } = useOperationalSnapshot();
  const loading = phase === 'loading' || phase === 'idle';

  const snapshotProps = {
    phase,
    state,
    error,
    url,
    lastLoadedAt,
    pollIntervalMs
  };

  return (
    <HashRouter>
      <div className="cc-app">
        <AppHeader
          state={state}
          loading={loading}
          onRefresh={reload}
          lastLoadedAt={lastLoadedAt}
          pollIntervalMs={pollIntervalMs}
        />
        <main className="cc-main cc-main--wide">
          <Routes>
            <Route
              path="/health"
              element={<HealthPage phase={phase} state={state} error={error} url={url} />}
            />
            <Route path="/workforce" element={<WorkforcePage {...snapshotProps} />} />
            <Route path="/activity" element={<AgentActivityPage {...snapshotProps} />} />
            <Route path="/decisions" element={<OperationalDecisionsPage {...snapshotProps} />} />
            <Route path="/risk" element={<RiskSignalsPage {...snapshotProps} />} />
            <Route path="/budget" element={<BudgetPage {...snapshotProps} />} />
            <Route path="/" element={<Navigate to="/workforce" replace />} />
            <Route path="*" element={<Navigate to="/workforce" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
