import {
  AGENT_OFFICE_UI_CONTRACT,
  type AgentOfficeUiModel,
  type BoardCard,
  type BoardColumn,
  type BoardView,
  type IncidentsView,
  type IncidentRow,
  type OperationalItemLoose,
  type OperationalStateLoose,
  type OwnershipAgentRow,
  type OwnershipView,
  type SummaryView
} from './types.js';

const LIFECYCLE_ORDER = [
  'intake',
  'triaged',
  'analyzing',
  'blocked',
  'in_progress',
  'review',
  'done',
  'cancelled'
] as const;

const LIFECYCLE_SET = new Set<string>(LIFECYCLE_ORDER);

const TERMINAL = new Set(['done', 'cancelled']);

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  console.warn(`[agent-office-adapter] ${msg}`);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v != null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

function filterNumericRecord(r: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && !Number.isNaN(v)) out[k] = v;
  }
  return out;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => (typeof t === 'string' ? t : JSON.stringify(t)));
}

function normalizeDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is string => typeof d === 'string');
}

function itemKey(item: OperationalItemLoose): string {
  const f = item.fields ?? {};
  return (
    str(f.task_id) ??
    str(f.incident_id) ??
    (typeof item.source_path === 'string' ? item.source_path : 'unknown:item')
  );
}

function escalationReason(f: Record<string, unknown>): string | null {
  const e = f.escalation;
  if (e == null || typeof e !== 'object' || Array.isArray(e)) return null;
  const r = (e as Record<string, unknown>).reason;
  return str(r);
}

function toBoardCard(item: OperationalItemLoose): BoardCard {
  const f = asRecord(item.fields);
  const v = item.validation ?? {};
  const errs = Array.isArray(v.errors) ? v.errors : [];
  const warns = Array.isArray(v.warnings) ? v.warnings : [];
  const d = item.derived ?? {};

  return {
    item_key: itemKey(item),
    title: str(f.title) ?? (typeof item.source_path === 'string' ? item.source_path : '(no title)'),
    priority: str(f.priority),
    risk_class: str(f.risk_class),
    owner_agent: str(f.owner_agent),
    parse_status: typeof item.parse_status === 'string' ? item.parse_status : 'unknown',
    stale: Boolean(d.stale),
    blocked_stale: Boolean(d.blocked_stale),
    tags: normalizeTags(f.tags),
    domains: normalizeDomains(f.domains),
    source_path: typeof item.source_path === 'string' ? item.source_path : '',
    escalation_reason: escalationReason(f),
    entity_type: typeof item.entity_type === 'string' ? item.entity_type : 'task',
    preserved_extras: asRecord(item.extras),
    validation_error_count: errs.length,
    validation_warning_count: warns.length
  };
}

function isOpenStatus(status: string | null): boolean {
  if (!status) return true;
  return !TERMINAL.has(status);
}

function buildBoard(items: OperationalItemLoose[], warnings: string[]): BoardView {
  const boardItems = items.filter((i) => {
    const t = typeof i.entity_type === 'string' ? i.entity_type : '';
    return t === 'task' || t === 'growth';
  });

  const columns: BoardColumn[] = LIFECYCLE_ORDER.map((id) => ({
    id,
    title: humanizeStatus(id),
    cards: []
  }));
  const colMap = new Map(columns.map((c) => [c.id, c]));
  const orphan_cards: BoardCard[] = [];

  for (const item of boardItems) {
    const card = toBoardCard(item);
    const st = str(asRecord(item.fields).status);
    if (!st || !LIFECYCLE_SET.has(st)) {
      orphan_cards.push(card);
      continue;
    }
    const col = colMap.get(st);
    if (col) col.cards.push(card);
    else {
      warn(warnings, `Unknown status column "${st}" — routing to orphan: ${card.source_path}`);
      orphan_cards.push(card);
    }
  }

  return { columns, orphan_cards };
}

function humanizeStatus(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function toIncidentRow(item: OperationalItemLoose): IncidentRow {
  const f = asRecord(item.fields);
  const v = item.validation ?? {};
  const errs = Array.isArray(v.errors) ? v.errors : [];
  const d = item.derived ?? {};
  return {
    item_key: itemKey(item),
    title: str(f.title) ?? (typeof item.source_path === 'string' ? item.source_path : '(no title)'),
    priority: str(f.priority),
    status: str(f.status),
    owner_agent: str(f.owner_agent),
    updated_at: str(f.updated_at),
    days_since_update: typeof d.days_since_update === 'number' ? d.days_since_update : null,
    source_path: typeof item.source_path === 'string' ? item.source_path : '',
    validation_error_count: errs.length,
    parse_status: typeof item.parse_status === 'string' ? item.parse_status : 'unknown',
    preserved_extras: asRecord(item.extras)
  };
}

function buildIncidents(items: OperationalItemLoose[]): IncidentsView {
  const incidents = items.filter((i) => (typeof i.entity_type === 'string' ? i.entity_type : '') === 'incident');
  const rows = incidents.map(toIncidentRow);

  const degraded_parse: IncidentRow[] = [];
  const critical: IncidentRow[] = [];
  const active: IncidentRow[] = [];

  for (const r of rows) {
    const isDegraded = r.parse_status !== 'ok' || r.validation_error_count > 0;
    if (isDegraded) {
      degraded_parse.push(r);
      continue;
    }
    if (r.priority === 'P0') {
      critical.push(r);
      continue;
    }
    active.push(r);
  }

  const pri = (p: IncidentRow) => (p.priority === 'P1' ? 0 : 1);
  critical.sort((a, b) => pri(a) - pri(b));
  return { critical, active, degraded_parse };
}

function buildOwnership(items: OperationalItemLoose[]): OwnershipView {
  const openItems = items.filter((i) => {
    const st = str(asRecord(i.fields).status);
    return isOpenStatus(st);
  });

  const byOwner = new Map<string, OperationalItemLoose[]>();
  const unassigned: OwnershipView['unassigned'] = [];

  for (const item of openItems) {
    const owner = str(asRecord(item.fields).owner_agent);
    if (!owner) {
      unassigned.push({
        item_key: itemKey(item),
        title: str(asRecord(item.fields).title) ?? item.source_path ?? '',
        source_path: typeof item.source_path === 'string' ? item.source_path : '',
        parse_status: typeof item.parse_status === 'string' ? item.parse_status : 'unknown'
      });
      continue;
    }
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(item);
  }

  const agents: OwnershipAgentRow[] = [...byOwner.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, list]) => {
      const by_priority: Record<string, number> = {};
      for (const it of list) {
        const p = str(asRecord(it.fields).priority) ?? 'unset';
        by_priority[p] = (by_priority[p] ?? 0) + 1;
      }
      return {
        id,
        open_items: list.length,
        by_priority,
        items: list.map((it) => {
          const f = asRecord(it.fields);
          return {
            item_key: itemKey(it),
            title: str(f.title) ?? (typeof it.source_path === 'string' ? it.source_path : ''),
            priority: str(f.priority),
            status: str(f.status),
            source_path: typeof it.source_path === 'string' ? it.source_path : '',
            parse_status: typeof it.parse_status === 'string' ? it.parse_status : 'unknown'
          };
        })
      };
    });

  return { agents, unassigned };
}

function buildSummary(state: OperationalStateLoose, items: OperationalItemLoose[]): SummaryView {
  const s = asRecord(state.summary);
  const item_count = items.length;

  const degraded_items = items.filter((it) => {
    const badParse = (typeof it.parse_status === 'string' ? it.parse_status : '') !== 'ok';
    const errs = it.validation?.errors;
    const badVal = Array.isArray(errs) && errs.length > 0;
    return badParse || badVal;
  }).length;

  const counts_by_priority = filterNumericRecord(asRecord(s.counts_by_priority));
  const counts_by_status = filterNumericRecord(asRecord(s.counts_by_status));

  const stale_count = typeof s.stale_count === 'number' ? s.stale_count : 0;
  const unparsed_count = typeof s.unparsed_count === 'number' ? s.unparsed_count : 0;
  const scan_errors = Array.isArray(state.errors) ? state.errors.length : 0;
  const snapshot_status = typeof state.snapshot_status === 'string' ? state.snapshot_status : 'unknown';

  const p0WithErrors = items.some(
    (i) => str(asRecord(i.fields).priority) === 'P0' && (i.validation?.errors?.length ?? 0) > 0
  );

  let banner: SummaryView['banner'] = 'ok';
  if (scan_errors > 0 || p0WithErrors) {
    banner = 'critical';
  } else if (snapshot_status === 'degraded' || degraded_items > 0) {
    banner = 'degraded';
  }

  return {
    snapshot_status,
    item_count,
    stale_count,
    unparsed_count,
    degraded_items,
    scan_errors,
    counts_by_priority,
    counts_by_status,
    banner
  };
}

/**
 * Pure, stateless transform. Does not read files or network.
 */
export function adaptOperationalToAgentOffice(
  raw: unknown,
  _options?: { now?: Date }
): AgentOfficeUiModel {
  const warnings: string[] = [];
  void _options;

  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyModel(
      warnings,
      raw === null ? 'null' : raw === undefined ? 'undefined' : Array.isArray(raw) ? 'array' : typeof raw
    );
  }

  const state = raw as OperationalStateLoose;

  if (state.contract_id !== 'instalogist-operational-state-1') {
    warn(
      warnings,
      `Expected contract_id instalogist-operational-state-1, got ${String(state.contract_id)} — continuing best-effort`
    );
  }

  const items = Array.isArray(state.items) ? state.items : [];
  if (!Array.isArray(state.items)) {
    warn(warnings, 'Missing or invalid items[] — using empty array');
  }

  const board = buildBoard(items, warnings);
  const incidents = buildIncidents(items);
  const ownership = buildOwnership(items);
  const summary = buildSummary(state, items);

  return {
    agent_office_ui_contract_id: AGENT_OFFICE_UI_CONTRACT,
    adapted_at: new Date().toISOString(),
    source: {
      contract_id: typeof state.contract_id === 'string' ? state.contract_id : null,
      generated_at: typeof state.generated_at === 'string' ? state.generated_at : null,
      parser_version: typeof state.parser_version === 'string' ? state.parser_version : null,
      snapshot_status: typeof state.snapshot_status === 'string' ? state.snapshot_status : 'unknown'
    },
    warnings,
    views: {
      board,
      incidents,
      ownership,
      summary
    }
  };
}

function emptyModel(warnings: string[], inputKind: string): AgentOfficeUiModel {
  warn(warnings, `Empty views — invalid operational state input (${inputKind})`);
  const summary: SummaryView = {
    snapshot_status: 'unknown',
    item_count: 0,
    stale_count: 0,
    unparsed_count: 0,
    degraded_items: 0,
    scan_errors: 0,
    counts_by_priority: {},
    counts_by_status: {},
    banner: 'critical'
  };
  const emptyBoard: BoardView = {
    columns: LIFECYCLE_ORDER.map((id) => ({ id, title: humanizeStatus(id), cards: [] })),
    orphan_cards: []
  };
  return {
    agent_office_ui_contract_id: AGENT_OFFICE_UI_CONTRACT,
    adapted_at: new Date().toISOString(),
    source: {
      contract_id: null,
      generated_at: null,
      parser_version: null,
      snapshot_status: 'unknown'
    },
    warnings,
    views: {
      board: emptyBoard,
      incidents: { critical: [], active: [], degraded_parse: [] },
      ownership: { agents: [], unassigned: [] },
      summary
    }
  };
}
