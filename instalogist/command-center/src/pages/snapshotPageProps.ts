import type { LoadError, OperationalState } from '../types/operational-state';
import type { SnapshotPhase } from '../state/useOperationalSnapshot';

export interface SnapshotPageProps {
  phase: SnapshotPhase;
  state: OperationalState | null;
  error: LoadError | null;
  url: string;
  lastLoadedAt: string | null;
  pollIntervalMs: number;
}
