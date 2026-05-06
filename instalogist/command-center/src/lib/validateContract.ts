import {
  OPERATIONAL_STATE_CONTRACT_ID,
  type OperationalState
} from '../types/operational-state';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateOperationalState(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Root must be a non-array object'] };
  }

  const o = data as Record<string, unknown>;

  if (o.contract_id !== OPERATIONAL_STATE_CONTRACT_ID) {
    errors.push(
      `contract_id must be "${OPERATIONAL_STATE_CONTRACT_ID}" (got ${String(o.contract_id)})`
    );
  }

  for (const key of [
    'generated_at',
    'workspace_root',
    'parser_version',
    'snapshot_status',
    'items',
    'graph',
    'summary',
    'errors'
  ] as const) {
    if (!(key in o)) {
      errors.push(`Missing required key: ${key}`);
    }
  }

  if (!Array.isArray(o.items)) {
    errors.push('items must be an array');
  }

  if (o.graph != null && typeof o.graph === 'object' && !Array.isArray(o.graph)) {
    const g = o.graph as Record<string, unknown>;
    if (!Array.isArray(g.nodes)) errors.push('graph.nodes must be an array');
    if (!Array.isArray(g.edges)) errors.push('graph.edges must be an array');
  } else if (o.graph != null) {
    errors.push('graph must be an object');
  }

  if (o.summary != null && typeof o.summary === 'object' && !Array.isArray(o.summary)) {
    const s = o.summary as Record<string, unknown>;
    for (const k of ['counts_by_status', 'counts_by_owner', 'counts_by_priority'] as const) {
      if (s[k] != null && (typeof s[k] !== 'object' || Array.isArray(s[k]))) {
        errors.push(`summary.${k} must be a record`);
      }
    }
  } else if (o.summary != null) {
    errors.push('summary must be an object');
  }

  if (o.errors != null && !Array.isArray(o.errors)) {
    errors.push('errors must be an array');
  }

  if (
    o.snapshot_status != null &&
    o.snapshot_status !== 'ok' &&
    o.snapshot_status !== 'degraded'
  ) {
    errors.push('snapshot_status must be ok or degraded');
  }

  if (o.command_center != null) {
    if (typeof o.command_center !== 'object' || Array.isArray(o.command_center)) {
      errors.push('command_center must be an object');
    } else {
      const cc = o.command_center as Record<string, unknown>;
      for (const key of [
        'agents',
        'executions',
        'escalations_feed',
        'decisions',
        'audit_log',
        'recommendations',
        'risk_signals'
      ] as const) {
        if (cc[key] != null && !Array.isArray(cc[key])) {
          errors.push(`command_center.${key} must be an array when present`);
        }
      }
      if (cc.token_budget != null && (typeof cc.token_budget !== 'object' || Array.isArray(cc.token_budget))) {
        errors.push('command_center.token_budget must be an object when present');
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function assertOperationalState(data: unknown): OperationalState {
  const v = validateOperationalState(data);
  if (!v.ok) {
    throw new Error(v.errors.join('; '));
  }
  return data as OperationalState;
}
