import { IncidentAlerts, PollStatusBar, RiskSignalsPanel } from '../components/command-center/CommandCenterWidgets';
import { DegradedBanner } from '../components/layout/DegradedBanner';
import { OperationalPageShell } from '../components/layout/OperationalPageShell';
import { deriveIncidentItems, resolveCommandCenter } from '../state/commandCenterMerge';
import type { SnapshotPageProps } from './snapshotPageProps';

export function RiskSignalsPage({
  phase,
  state,
  error,
  url,
  lastLoadedAt,
  pollIntervalMs
}: SnapshotPageProps) {
  return (
    <OperationalPageShell phase={phase} state={state} error={error} url={url}>
      {(s) => {
        const cc = resolveCommandCenter(s);
        return (
          <div className="cc-dashboard">
            <h1 className="cc-page-title">Risk Signals</h1>
            <PollStatusBar
              pollIntervalMs={pollIntervalMs}
              lastLoadedAt={lastLoadedAt}
              snapshotGeneratedAt={s.generated_at}
            />
            <DegradedBanner state={s} />
            <RiskSignalsPanel signals={cc.risk_signals} />
            <IncidentAlerts items={deriveIncidentItems(s)} />
          </div>
        );
      }}
    </OperationalPageShell>
  );
}
