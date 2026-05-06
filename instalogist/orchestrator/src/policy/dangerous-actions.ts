import type { DangerousActionKind, TaskDangerClass } from '../types.js';

/** Actions that always require human approval before any downstream executor may apply them. */
export const ALWAYS_APPROVAL_ACTIONS: ReadonlySet<DangerousActionKind> = new Set([
  'deploy',
  'payment',
  'auth_change',
  'database_write',
  'migration',
  'secret_access',
  'destructive_infra'
]);

export function dangerClassRequiresApproval(c: TaskDangerClass): boolean {
  return c === 'high' || c === 'critical';
}

export function mergeDangerousHints(
  taskClass: TaskDangerClass,
  hints?: DangerousActionKind[]
): DangerousActionKind[] {
  const out = new Set<DangerousActionKind>(hints ?? []);
  if (taskClass === 'critical') {
    out.add('destructive_infra');
  }
  return [...out];
}

export function needsHumanCheckpoint(
  dangerClass: TaskDangerClass,
  hints: DangerousActionKind[]
): boolean {
  if (dangerClassRequiresApproval(dangerClass)) return true;
  for (const h of hints) {
    if (ALWAYS_APPROVAL_ACTIONS.has(h)) return true;
  }
  return false;
}
