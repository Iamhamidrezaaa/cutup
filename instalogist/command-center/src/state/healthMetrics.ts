import type { OperationalItem, OperationalState } from '../types/operational-state';

export interface HealthMetrics {
  itemCount: number;
  degradedItems: number;
  unparsedItems: number;
  itemsWithValidationErrors: number;
  itemsWithValidationWarnings: number;
  staleCountFromSummary: number;
  scanErrorCount: number;
}

export function computeHealthMetrics(state: OperationalState): HealthMetrics {
  let degradedItems = 0;
  let unparsedItems = 0;
  let itemsWithValidationErrors = 0;
  let itemsWithValidationWarnings = 0;

  for (const item of state.items) {
    if (item.parse_status !== 'ok') degradedItems += 1;
    if (item.parse_status === 'unparsed_frontmatter') unparsedItems += 1;
    const errN = item.validation?.errors?.length ?? 0;
    const warnN = item.validation?.warnings?.length ?? 0;
    if (errN > 0) itemsWithValidationErrors += 1;
    if (warnN > 0) itemsWithValidationWarnings += 1;
  }

  return {
    itemCount: state.items.length,
    degradedItems,
    unparsedItems,
    itemsWithValidationErrors,
    itemsWithValidationWarnings,
    staleCountFromSummary: state.summary?.stale_count ?? 0,
    scanErrorCount: state.errors?.length ?? 0
  };
}

export function itemNeedsAttention(item: OperationalItem): boolean {
  return (
    item.parse_status !== 'ok' ||
    (item.validation?.errors?.length ?? 0) > 0 ||
    (item.validation?.warnings?.length ?? 0) > 0
  );
}
