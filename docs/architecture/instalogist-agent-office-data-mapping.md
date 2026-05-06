# Instalogist operational state → Agent Office (visualization) — data mapping specification

**Status:** Specification only. **No implementation** in this step.

**Source of truth:** `operational-state.json` — contract **`instalogist-operational-state-1`** (parser output).

**Target role:** **Agent Office** (upstream product) terminology and UI patterns used as a **visualization / presentation vocabulary** only. This document does **not** require writing to upstream SQLite, Colyseus room state, or Instalogist markdown. **No DB** for this mapping layer. **No autonomous writes.** **No hidden state** beyond what is visible in the loaded snapshot JSON.

---

## 1. Principles

| Rule | Meaning |
|------|---------|
| **SOT** | Every displayed fact must trace to a field in `operational-state` (or derived in the open Instalogist adapter from that snapshot). |
| **Visualization only** | Upstream “agents think / hire / tools” is **out of scope**. Mapped “agents” are **labels** (e.g. `Dev-01`), not LLM entities. |
| **No workspace mutation** | UI never PATCHes markdown or calls parser write APIs. |
| **No simulation authority** | Colyseus / SQLite in Agent Office are **not** sources of truth for Instalogist ops. |
| **Explicit adapter** | Use **`instalogist-ui-views-1`** (see visualization adapter doc) as the canonical intermediate; map **views** → Agent Office–styled components. |

---

## 2. Source domain (recap)

| Path | Role |
|------|------|
| `contract_id`, `generated_at`, `parser_version`, `workspace_root` | Snapshot metadata |
| `snapshot_status` | `ok` \| `degraded` |
| `items[]` | One row per workspace markdown file (task / incident / growth) |
| `items[].entity_type` | `task` \| `incident` \| `growth` |
| `items[].source_path` | Stable file identity |
| `items[].parse_status` | `ok` \| `degraded` \| `unparsed_frontmatter` \| `empty` |
| `items[].fields` | Frontmatter subset (`task_id`, `title`, `status`, `owner_agent`, `escalation`, …) |
| `items[].validation` | Parser rules output |
| `items[].derived` | `stale`, `blocked_stale`, `days_since_update` |
| `items[].extras` | Unknown YAML keys |
| `graph` | Derived ownership / escalation edges |
| `summary` | Aggregates |
| `errors[]` | Filesystem / scan errors |

---

## 3. Target domain (Agent Office vocabulary — read-only)

Upstream Agent Office includes **simulation** concepts (agents with brains, in-world tasks, memories). For Instalogist mapping, use **only** these **display analogues**:

| Agent Office concept (informal) | Instalogist use |
|---------------------------------|-----------------|
| **TaskBoard** | Kanban / list driven by **`views.board`** (not Colyseus tasks). |
| **Agent / desk** | **Ownership row** keyed by `owner_agent` string (badge, not sprite AI). |
| **System activity log** | **Escalation timeline** + **degraded events** (append-only text lines from snapshot). |
| **Inspector / detail** | Read-only panel from `source_path` + `validation` + `fields`. |

Do not map Instalogist items to **Ollama think loops**, **tool execution**, or **SQLite memory rows**.

---

## 4. Required adapter layer

| Component | Contract | Input | Output |
|-----------|----------|-------|--------|
| **Instalogist visualization adapter** | `instalogist-ui-views-1` | `operational-state` | `views.board`, `views.incidents`, `views.ownership`, `views.escalation_timeline`, `views.summary` |

**Agent Office–styled UI** should consume **`views.*`**, not raw `items[]` directly, so column ordering and derived labels stay consistent.

---

## 5. Task mapping

**Source rows:** `items` where `entity_type === "task"` or **`growth`** (product choice: growth can share board or separate filter).

| `instalogist-ui-views-1` | Source fields |
|--------------------------|---------------|
| `BoardCard.item_key` | `fields.task_id` \|\| `fields.incident_id` \|\| `source_path` |
| `BoardCard.title` | `fields.title` (fallback: `source_path`) |
| `BoardCard.priority` | `fields.priority` |
| `BoardCard.risk_class` | `fields.risk_class` |
| `BoardCard.owner_agent` | `fields.owner_agent` |
| `BoardCard.parse_status` | `parse_status` |
| `BoardCard.stale` | `derived.stale` |
| `BoardCard.blocked_stale` | `derived.blocked_stale` |
| `BoardCard.tags` | Normalize `fields.tags` to `string[]` (optional transform §10) |
| `BoardCard.domains` | `fields.domains` as `string[]` if present |
| `BoardCard.source_path` | `source_path` |
| `BoardCard.escalation_reason` | `fields.escalation.reason` if `escalation` is object |

**Column placement:** `BoardCard` → column `id === fields.status` (Instalogist lifecycle). If `status` missing or unknown → **`orphan_cards`**.

---

## 6. Incident mapping

**Source rows:** `items` where `entity_type === "incident"` **plus** optional policy: include `priority ∈ {P0,P1}` tasks as “incident-like” (product flag; default **off**).

| `views.incidents` | Source |
|-------------------|--------|
| `IncidentRow.item_key` | Same as `BoardCard.item_key` |
| `IncidentRow.title` | `fields.title` |
| `IncidentRow.priority` | `fields.priority` |
| `IncidentRow.status` | `fields.status` |
| `IncidentRow.owner_agent` | `fields.owner_agent` |
| `IncidentRow.updated_at` | `fields.updated_at` |
| `IncidentRow.days_since_update` | `derived.days_since_update` |
| `IncidentRow.source_path` | `source_path` |
| `IncidentRow.validation_error_count` | `validation.errors.length` |

**Section assignment (adapter logic):**

| Section | Rule (suggested) |
|---------|------------------|
| `critical` | `priority === "P0"` OR (`parse_status !== "ok"` AND `priority === "P1"`) — tune per product |
| `active` | Other incidents not in `degraded_parse` |
| `degraded_parse` | `parse_status !== "ok"` OR `validation.errors.length > 0` |

---

## 7. Ownership mapping

**Primary source:** `items[].fields.owner_agent` + open item filter (`status` not in `done`, `cancelled` if policy excludes done).

| `views.ownership` | Source |
|-------------------|--------|
| `agents[].id` | Distinct `owner_agent` values |
| `agents[].open_items` | Count of items per owner matching open filter |
| `agents[].by_priority` | Histogram of `fields.priority` per owner |
| `agents[].items[]` | Lightweight rows from same items |
| `unassigned[]` | Items with missing / empty `owner_agent` |

**Cross-check (optional):** `graph.edges` with label `owns` must agree with `owner_agent` for same `item_key`; on mismatch, adapter emits **`views.summary` warning** (no silent fix).

---

## 8. Escalation mapping

**Source:** `items[].fields.escalation` when non-null object with at least one of `from_agent`, `reason`, `escalated_at`.

| `views.escalation_timeline.events[]` | Source |
|--------------------------------------|--------|
| `at` | `escalation.escalated_at` |
| `reason` | `escalation.reason` |
| `from_agent` | `escalation.from_agent` |
| `item_key` | Derived id (§5) |
| `title` | `fields.title` |
| `priority` | `fields.priority` |
| `source_path` | `source_path` |

**Sort:** `escalated_at` descending; nulls last.

**Agent Office analogue:** **System log** line format, e.g. `[escalated_at] reason ← from_agent — title`.

**Empty escalation object `{}`:** No timeline row unless product adds explicit “unescalated” filter (default: **omit**).

---

## 9. Board column mapping

| Column `id` (UI) | Source |
|--------------------|--------|
| `intake`, `triaged`, `analyzing`, `blocked`, `in_progress`, `review`, `done`, `cancelled` | `fields.status` must match Instalogist lifecycle enum |
| **Unknown / missing status** | `orphan_cards` swimlane |

**Display title:** Human label map (optional) e.g. `in_progress` → “In progress” — pure presentation.

---

## 10. Stale and degraded states

| UI signal | Source |
|-----------|--------|
| **Snapshot degraded** | `snapshot_status === "degraded"` |
| **Card stale** | `derived.stale === true` |
| **Blocked stale** | `derived.blocked_stale === true` |
| **Parse unhealthy** | `parse_status !== "ok"` |
| **Validation** | `validation.errors` / `validation.warnings` |
| **Scan failure** | `errors[]` non-empty |

**Agent Office analogue:** Badge on TaskBoard card + banner on layout (no upstream emote / LLM).

**No hidden state:** All badges must map to a visible JSON path above.

---

## 11. Unsupported fields (no Agent Office simulation mapping)

| Source | Reason |
|--------|--------|
| `body_markdown` | Ops detail only; not a simulation “note” unless explicitly rendered read-only |
| `graph` (full) | Optional layout; not office grid coordinates |
| `extras` | Unknown schema; show collapsed “extra keys” or omit |
| `workspace_root`, `parser_version` | Metadata / footer only |
| Upstream: **personality**, **memory**, **tool calls**, **sprite position** | N/A |

---

## 12. Optional transformations (adapter)

| Transform | Purpose |
|-----------|---------|
| **Tag coercion** | `fields.tags` may contain non-strings in legacy data → stringify for display |
| **Reason code → label** | `payment_failure` → “Payment” for log readability |
| **Priority sort** | P0 before P1 within column |
| **Locale time** | Format `generated_at` / `escalated_at` in local TZ (display only) |
| **Strip PII** | Omit or mask `human_owner` in untrusted embeds |

---

## 13. Future realtime compatibility (read-only)

Allowed **without** violating SOT or mutation rules:

| Mechanism | Behavior |
|-----------|----------|
| **Poll** | Refetch JSON on interval; re-run adapter; diff keys for animation (optional) |
| **ETag / hash** | Server returns `ETag` for `operational-state.json`; UI refetch when changed |
| **Read-only broadcast** | Service pushes **snapshot version id** (not task edits) so clients reload JSON |

**Not allowed** in this mapping philosophy: **WebSocket messages that imply task status edits** sourced from Agent Office simulation DB.

If Agent Office and Instalogist ever share a host, keep **two channels**: simulation WS (upstream) vs **HTTP GET** snapshot (Instalogist).

---

## 14. Validation checklist (before any implementation)

- [ ] Every UI field traces to `operational-state` or documented `derived` rule.
- [ ] No write path to markdown or parser from Agent Office UI.
- [ ] `instalogist-ui-views-1` produced in a **pure function** of snapshot + options.
- [ ] Degraded / stale / scan errors visible when present.

---

## 15. Related documents

- [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)
- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
- [instalogist-parser-architecture.md](./instalogist-parser-architecture.md)
- [instalogist-agent-office-analysis.md](./instalogist-agent-office-analysis.md)
- [instalogist-agent-office-bootstrap.md](./instalogist-agent-office-bootstrap.md)
