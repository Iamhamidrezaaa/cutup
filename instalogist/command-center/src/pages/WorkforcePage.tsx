import {
  ActiveAgentList,
  PollStatusBar,
  RecommendationsList
} from '../components/command-center/CommandCenterWidgets';
import { DegradedBanner } from '../components/layout/DegradedBanner';
import { OperationalPageShell } from '../components/layout/OperationalPageShell';
import {
  mergedRecommendations,
  parserOwnerAgents,
  resolveCommandCenter
} from '../state/commandCenterMerge';
import type { SnapshotPageProps } from './snapshotPageProps';

export function WorkforcePage({ phase, state, error, url, lastLoadedAt, pollIntervalMs }: SnapshotPageProps) {
  return (
    <OperationalPageShell phase={phase} state={state} error={error} url={url}>
      {(s) => {
        const cc = resolveCommandCenter(s);
        const owners = parserOwnerAgents(s);
        return (
          <div className="cc-dashboard">
            <h1 className="cc-page-title">AI Workforce</h1>
            <PollStatusBar
              pollIntervalMs={pollIntervalMs}
              lastLoadedAt={lastLoadedAt}
              snapshotGeneratedAt={s.generated_at}
            />
            <DegradedBanner state={s} />
            <ActiveAgentList agents={cc.agents} parserOwners={owners} />
            <RecommendationsList items={mergedRecommendations(s)} />
          </div>
        );
      }}
    </OperationalPageShell>
  );
}
