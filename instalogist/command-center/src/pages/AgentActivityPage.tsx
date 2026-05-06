import {
  AuditLogTable,
  EscalationFeed,
  ExecutionTimeline,
  PollStatusBar
} from '../components/command-center/CommandCenterWidgets';
import { DegradedBanner } from '../components/layout/DegradedBanner';
import { OperationalPageShell } from '../components/layout/OperationalPageShell';
import { mergedEscalations, resolveCommandCenter } from '../state/commandCenterMerge';
import type { SnapshotPageProps } from './snapshotPageProps';

export function AgentActivityPage({
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
            <h1 className="cc-page-title">Agent Activity</h1>
            <PollStatusBar
              pollIntervalMs={pollIntervalMs}
              lastLoadedAt={lastLoadedAt}
              snapshotGeneratedAt={s.generated_at}
            />
            <DegradedBanner state={s} />
            <ExecutionTimeline executions={cc.executions} />
            <EscalationFeed items={mergedEscalations(s)} />
            <AuditLogTable entries={cc.audit_log} />
          </div>
        );
      }}
    </OperationalPageShell>
  );
}
