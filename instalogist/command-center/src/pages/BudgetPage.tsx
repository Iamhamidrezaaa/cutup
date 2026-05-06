import { ExecutionTimeline, PollStatusBar, TokenBudgetPanel } from '../components/command-center/CommandCenterWidgets';
import { DegradedBanner } from '../components/layout/DegradedBanner';
import { OperationalPageShell } from '../components/layout/OperationalPageShell';
import { resolveCommandCenter } from '../state/commandCenterMerge';
import type { SnapshotPageProps } from './snapshotPageProps';

export function BudgetPage({ phase, state, error, url, lastLoadedAt, pollIntervalMs }: SnapshotPageProps) {
  return (
    <OperationalPageShell phase={phase} state={state} error={error} url={url}>
      {(s) => {
        const cc = resolveCommandCenter(s);
        return (
          <div className="cc-dashboard">
            <h1 className="cc-page-title">Budget Monitoring</h1>
            <PollStatusBar
              pollIntervalMs={pollIntervalMs}
              lastLoadedAt={lastLoadedAt}
              snapshotGeneratedAt={s.generated_at}
            />
            <DegradedBanner state={s} />
            <TokenBudgetPanel budget={cc.token_budget} executions={cc.executions} />
            <ExecutionTimeline executions={cc.executions} />
          </div>
        );
      }}
    </OperationalPageShell>
  );
}
