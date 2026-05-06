/** Source: instalogist-operational-state-1 (parser output). Loose for parse-safety. */

export interface OperationalStateLoose {
  contract_id?: string;
  generated_at?: string;
  workspace_root?: string;
  parser_version?: string;
  snapshot_status?: string;
  items?: OperationalItemLoose[];
  graph?: unknown;
  summary?: Record<string, unknown>;
  errors?: ScanErrorLoose[];
}

export interface ScanErrorLoose {
  message?: string;
  path?: string;
}

export interface OperationalItemLoose {
  source_path?: string;
  entity_type?: string;
  parse_status?: string;
  fields?: Record<string, unknown>;
  validation?: {
    errors?: Array<{ rule?: string; message?: string }>;
    warnings?: Array<{ rule?: string; message?: string }>;
  };
  derived?: {
    stale?: boolean;
    blocked_stale?: boolean;
    days_since_update?: number | null;
  };
  extras?: Record<string, unknown>;
}

/** Output: instalogist-agent-office-ui-1 */
export const AGENT_OFFICE_UI_CONTRACT = 'instalogist-agent-office-ui-1' as const;

export interface BoardCard {
  item_key: string;
  title: string;
  priority: string | null;
  risk_class: string | null;
  owner_agent: string | null;
  parse_status: string;
  stale: boolean;
  blocked_stale: boolean;
  tags: string[];
  domains: string[];
  source_path: string;
  escalation_reason: string | null;
  entity_type: string;
  /** Unknown YAML keys from parser (preserved). */
  preserved_extras: Record<string, unknown>;
  validation_error_count: number;
  validation_warning_count: number;
}

export interface BoardColumn {
  id: string;
  title: string;
  cards: BoardCard[];
}

export interface BoardView {
  columns: BoardColumn[];
  orphan_cards: BoardCard[];
}

export interface IncidentRow {
  item_key: string;
  title: string;
  priority: string | null;
  status: string | null;
  owner_agent: string | null;
  updated_at: string | null;
  days_since_update: number | null;
  source_path: string;
  validation_error_count: number;
  parse_status: string;
  preserved_extras: Record<string, unknown>;
}

export interface IncidentsView {
  critical: IncidentRow[];
  active: IncidentRow[];
  degraded_parse: IncidentRow[];
}

export interface OwnershipAgentRow {
  id: string;
  open_items: number;
  by_priority: Record<string, number>;
  items: Array<{
    item_key: string;
    title: string;
    priority: string | null;
    status: string | null;
    source_path: string;
    parse_status: string;
  }>;
}

export interface OwnershipView {
  agents: OwnershipAgentRow[];
  unassigned: Array<{
    item_key: string;
    title: string;
    source_path: string;
    parse_status: string;
  }>;
}

export interface SummaryView {
  snapshot_status: string;
  item_count: number;
  stale_count: number;
  unparsed_count: number;
  degraded_items: number;
  scan_errors: number;
  counts_by_priority: Record<string, number>;
  counts_by_status: Record<string, number>;
  banner: 'ok' | 'degraded' | 'critical';
}

export interface AgentOfficeUiModel {
  agent_office_ui_contract_id: typeof AGENT_OFFICE_UI_CONTRACT;
  adapted_at: string;
  source: {
    contract_id: string | null;
    generated_at: string | null;
    snapshot_status: string;
    parser_version: string | null;
  };
  warnings: string[];
  views: {
    board: BoardView;
    incidents: IncidentsView;
    ownership: OwnershipView;
    summary: SummaryView;
  };
}
