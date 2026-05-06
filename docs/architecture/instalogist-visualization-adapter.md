# Instalogist visualization adapter layer — architecture (no UI)

**Role:** Read-only bridge from **`operational-state.json`** (parser output, contract `instalogist-operational-state-1`) to **UI-ready view models** for Agent Office and future admin widgets.

**Non-goals:** Rendering components, databases, websockets, mutating workspace or JSON source.

---

## 1. Consumer input

| Input | Source |
|-------|--------|
| `OperationalState` | Parsed JSON file or in-memory object identical to parser output |

**Validation:** Adapter SHOULD verify `contract_id` and optionally `parser_version` range; on unknown `contract_id`, return error envelope without throwing uncaught exceptions.

---

## 2. Adapter properties

| Property | Rule |
|----------|------|
| **Read-only** | No writes to filesystem; no PATCH to state. |
| **Stateless** | Output is a pure function of input + optional `options` (timezone, locale, `now` for relative labels). |
| **Filesystem-compatible** | Can run in Node (read file → parse JSON → adapt) or browser (fetch static JSON → adapt). Same code path if module is isomorphic. |

---

## 3. Transformation pipeline

Single pass over `items` where possible; second pass only for graph-derived views.

```
operational-state.json
       │
       ▼
  [1] validate + normalize
       │  (ensure arrays, default missing fields, sort keys for stable UI)
       ▼
  [2] partition by entity_type + filters
       │  tasks | incidents | growth
       ▼
  [3] build derived views (parallel outputs)
       ├── boardModel (columns by status)
       ├── incidentPanelModel (severity-sorted list + detail ids)
       ├── ownershipModel (agent → cards + load counts)
       ├── escalationTimelineModel (sorted events)
       └── summaryModel (headline KPIs + degraded banner)
       ▼
  [4] optional: attach graph indices (agent id → item ids) from state.graph
```

**Idempotency:** Same input + same `options` → same output (stable sort keys).

---

## 4. UI data contracts (output shapes)

Version these as **`instalogist-ui-views-1`** inside a wrapper:

```json
{
  "ui_contract_id": "instalogist-ui-views-1",
  "adapted_at": "ISO-8601",
  "source": { "generated_at": "…", "snapshot_status": "…", "parser_version": "…" },
  "views": { }
}
```

### 4.1 Task board (`views.board`)

For Kanban-style Agent Office.

```typescript
// Logical shape (documentation only)
Board = {
  columns: Array<{
    id: string;              // lifecycle status, e.g. "analyzing"
    title: string;           // display label
    cards: Array<BoardCard>;
  }>;
  orphan_cards: BoardCard[]; // parse_status not ok or missing status
};

BoardCard = {
  item_key: string;        // task_id | incident_id | source_path
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
};
```

**Column order:** Fixed array from Instalogist lifecycle order (`intake` → … → `done`), empty columns still present for stable grid.

### 4.2 Incident panel (`views.incidents`)

Subset of items where `entity_type === "incident"` (or `priority` in `P0`|`P1` if product prefers).

```typescript
IncidentPanel = {
  critical: IncidentRow[];   // P0 first
  active: IncidentRow[];
  degraded_parse: IncidentRow[];
};

IncidentRow = {
  item_key: string;
  title: string;
  priority: string | null;
  status: string | null;
  owner_agent: string | null;
  updated_at: string | null;
  days_since_update: number | null;
  source_path: string;
  validation_error_count: number;
};
```

### 4.3 Ownership view (`views.ownership`)

```typescript
OwnershipView = {
  agents: Array<{
    id: string;              // Dev-01, …
    open_items: number;      // excluding done/cancelled
    by_priority: Record<string, number>;
    items: Array<{ item_key: string; title: string; priority: string | null; status: string | null; source_path: string }>;
  }>;
  unassigned: Array<{ … }>;  // missing owner_agent
};
```

**Source:** Aggregate from `items` + optional cross-check with `graph.edges` label `owns`.

### 4.4 Escalation timeline (`views.escalation_timeline`)

Event list for command center strip.

```typescript
EscalationTimeline = {
  events: Array<{
    at: string | null;       // escalation.escalated_at
    reason: string | null;
    from_agent: string | null;
    item_key: string;
    title: string;
    priority: string | null;
    source_path: string;
  }>;
};
```

**Sort:** `escalated_at` descending; nulls last.

**Filter:** Only items where `escalation` is non-empty object and has at least one meaningful field.

### 4.5 Operational summary (`views.summary`)

Headline strip for admin dashboard.

```typescript
OperationalSummary = {
  snapshot_status: string;
  item_count: number;
  stale_count: number;
  unparsed_count: number;
  degraded_items: number;    // parse_status degraded or validation errors
  counts_by_priority: Record<string, number>;
  counts_by_owner_top: Array<{ owner: string; count: number }>; // top N
  scan_errors: number;      // state.errors.length
  banner: "ok" | "degraded" | "critical";  // critical if any P0 with validation errors or scan_errors
};
```

---

## 5. Caching strategy

| Layer | Strategy |
|-------|----------|
| **Adapter (pure function)** | No internal cache; rely on caller. |
| **Node caller** | Optional in-memory `Map<hash, AdaptedViews>` keyed by **content hash** of JSON string or `generated_at` + file mtime. |
| **Browser / Agent Office** | `sessionStorage` or in-memory store with TTL (e.g. 60s) **optional**; key = URL + `generated_at`. |
| **HTTP (future API)** | `Cache-Control: private, max-age=0` + **ETag** from `generated_at` + sha256 of body; adapter runs only on cache miss. |

**Rule:** Never cache across different `contract_id` without invalidation.

---

## 6. Refresh strategy

| Context | Refresh |
|---------|---------|
| **Local dev** | Re-run parser → new JSON → re-run adapter (script chain). |
| **Agent Office** | Manual refresh button or poll file/API every N seconds (N ≥ 30 suggested); no websocket in this spec. |
| **Admin dashboard** | Build-time static JSON refresh in CI; or server re-reads file on each request if volume low. |

**Staleness indicator:** Show `source.generated_at` in UI footer; compare to client `Date` for “age of snapshot” only (not task stale logic).

---

## 7. Error handling

| Condition | Behavior |
|-----------|----------|
| Invalid JSON | Return `{ error: "invalid_json", views: null }`. |
| Missing `contract_id` | `error: "unknown_contract"`. |
| Partial items | Still emit views; increment `summary.degraded_items`. |
| Empty `items` | Valid empty views (zero columns populated). |

---

## 8. Compatibility matrix

| Consumer | Uses |
|----------|------|
| **Agent Office** | `board`, `escalation_timeline`, `summary`, `ownership` (tabbed). See [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md) and field mapping [instalogist-agent-office-data-mapping.md](./instalogist-agent-office-data-mapping.md). |
| **Admin dashboard widgets** | `summary` KPI strip; `incidents` widget; per-owner donut from `ownership`. |
| **Future API** | `GET /views` returns this document; subsets via `?view=board,summary`. |

---

## 9. Implementation placement (future, not in this doc)

Suggested package: `instalogist/visualization-adapter/` or `instalogist/parser/adapt.mjs` re-export — keep separate if UI team owns adapter.

**Tests:** Golden: fixture `operational-state.json` → snapshot `adapted-views.json`.

---

## 10. Related documents

- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
- [instalogist-parser-architecture.md](./instalogist-parser-architecture.md)
- Parser README: `instalogist/parser/README.md`
