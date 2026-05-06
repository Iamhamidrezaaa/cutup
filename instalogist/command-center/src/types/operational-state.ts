/** Parser output contract instalogist-operational-state-1 */

import type { CommandCenterData } from './command-center.js';

export const OPERATIONAL_STATE_CONTRACT_ID = 'instalogist-operational-state-1' as const;

export type SnapshotStatus = 'ok' | 'degraded';

export type ItemParseStatus = 'ok' | 'degraded' | 'unparsed_frontmatter' | 'empty';

export interface ValidationIssue {
  rule: string;
  message: string;
}

export interface OperationalItem {
  source_path: string;
  entity_type: string;
  parse_status: ItemParseStatus;
  fields: Record<string, unknown>;
  validation: {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  derived: {
    stale: boolean;
    blocked_stale: boolean;
    days_since_update: number | null;
  };
  extras: Record<string, unknown>;
  body_markdown?: string | null;
}

export interface OperationalSummary {
  counts_by_status: Record<string, number>;
  counts_by_owner: Record<string, number>;
  counts_by_priority: Record<string, number>;
  stale_count: number;
  unparsed_count: number;
  item_count?: number;
}

export interface GraphNode {
  id: string;
  type: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface ScanError {
  message: string;
  path?: string;
}

export interface OperationalState {
  contract_id: string;
  generated_at: string;
  workspace_root: string;
  parser_version: string;
  snapshot_status: SnapshotStatus;
  items: OperationalItem[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  summary: OperationalSummary;
  errors: ScanError[];
  /**
   * Live agent / budget / audit payload for Command Center (optional; supplied by orchestrator or hand-authored for demos).
   */
  command_center?: CommandCenterData;
}

export type LoadErrorKind =
  | 'network'
  | 'not_json'
  | 'contract'
  | 'shape'
  | 'unknown';

export interface LoadError {
  kind: LoadErrorKind;
  message: string;
  detail?: string;
}
