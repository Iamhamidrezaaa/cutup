import { OperationalDecisionsTable, PollStatusBar } from '../components/command-center/CommandCenterWidgets';
import { DegradedBanner } from '../components/layout/DegradedBanner';
import { OperationalPageShell } from '../components/layout/OperationalPageShell';
import { resolveCommandCenter } from '../state/commandCenterMerge';
import type { SnapshotPageProps } from './snapshotPageProps';

export function OperationalDecisionsPage({
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
        const blocked = s.items.filter((it) => it.fields?.status === 'blocked');
        return (
          <div className="cc-dashboard">
            <h1 className="cc-page-title">Operational Decisions</h1>
            <PollStatusBar
              pollIntervalMs={pollIntervalMs}
              lastLoadedAt={lastLoadedAt}
              snapshotGeneratedAt={s.generated_at}
            />
            <DegradedBanner state={s} />
            <OperationalDecisionsTable decisions={cc.decisions} />
            <section className="cc-section">
              <h2>Blocked tasks (parser)</h2>
              {blocked.length === 0 ? (
                <p className="muted">None.</p>
              ) : (
                <ul className="cc-list">
                  {blocked.map((it) => (
                    <li key={it.source_path}>
                      <strong>{String(it.fields?.title ?? it.source_path)}</strong>
                      <div className="muted small">
                        <code className="cc-break">{it.source_path}</code>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        );
      }}
    </OperationalPageShell>
  );
}
