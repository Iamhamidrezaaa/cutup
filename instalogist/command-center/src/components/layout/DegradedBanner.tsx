import type { OperationalState } from '../../types/operational-state';
import { computeHealthMetrics } from '../../state/healthMetrics';

export interface DegradedBannerProps {
  state: OperationalState;
}

export function DegradedBanner({ state }: DegradedBannerProps) {
  const m = computeHealthMetrics(state);
  const snapshotDegraded = state.snapshot_status === 'degraded';
  const itemProblems =
    m.degradedItems > 0 ||
    m.itemsWithValidationErrors > 0 ||
    m.itemsWithValidationWarnings > 0;
  const scanProblems = m.scanErrorCount > 0;

  if (!snapshotDegraded && !itemProblems && !scanProblems) return null;

  const critical = scanProblems || m.itemsWithValidationErrors > 0;
  const cls = critical ? 'cc-banner cc-banner--critical' : 'cc-banner cc-banner--warn';

  const parts: string[] = [];
  if (snapshotDegraded) parts.push('Snapshot marked degraded by parser');
  if (m.degradedItems > 0)
    parts.push(`${m.degradedItems} item(s) with non-ok parse status`);
  if (m.itemsWithValidationErrors > 0)
    parts.push(`${m.itemsWithValidationErrors} item(s) with validation errors`);
  if (m.itemsWithValidationWarnings > 0)
    parts.push(`${m.itemsWithValidationWarnings} item(s) with validation warnings`);
  if (scanProblems) parts.push(`${m.scanErrorCount} filesystem scan error(s)`);

  return (
    <div className={cls} role="status">
      <strong>Operational attention</strong>
      <ul className="cc-banner__list">
        {parts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
