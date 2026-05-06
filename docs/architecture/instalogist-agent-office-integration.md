# Instalogist ↔ Agent Office — integration plan (v1)

**Context:** Agent Office is **visualization only**. **Instalogist operational state** (`operational-state.json`) is the **source of truth**. The **visualization adapter** (spec: [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)) produces **`instalogist-ui-views-1`** payloads.

**This document:** Maps adapter outputs to Agent Office UI concepts and defines a **safe, read-only** integration pattern. **No** realtime stack, **no** autonomous agents, **no** direct mutation of `instalogist/workspace`.

---

## 1. Integration principles

| Principle | Meaning |
|-----------|---------|
| **Read-only** | Agent Office reads JSON only; no write path to workspace markdown. |
| **Stateless** | UI renders from latest snapshot + adapted views; session state is display-only (filters, column collapse). |
| **Local-first** | Default: load `operational-state.json` from disk or static hosting; run adapter in-process or precompute `adapted-views.json`. |
| **Observability** | Every screen shows **snapshot age** (`source.generated_at`) and **snapshot_status** (ok / degraded). |

---

**UI wireframe-level spec:** [instalogist-command-center-ui.md](./instalogist-command-center-ui.md)

**External upstream `agent-office` (harishkotra) — technical reality check:** [instalogist-agent-office-analysis.md](./instalogist-agent-office-analysis.md)

## 2. Agent Office concept map

| Agent Office concept | Instalogist source | Adapter output |
|---------------------|-------------------|----------------|
| **Command center** (home) | Full pipeline | `views.summary` + `views.escalation_timeline` (top strip) |
| **Task board** | Tasks + growth (+ optional incidents toggle) | `views.board` |
| **Incidents** | `entity_type === incident` (+ severity rules) | `views.incidents` |
| **Ownership** (team load) | Items + graph | `views.ownership` |
| **Escalation stream** | Items with `escalation` | `views.escalation_timeline` |
| **Health / admin strip** | Parser + validation aggregates | `views.summary` (banner, counts) |

Agent Office **does not** own task lifecycle; it **reflects** markdown files that humans/agents edit elsewhere.

---

## 3. View consumption matrix

| Agent Office surface | Primary adapter key | Secondary |
|---------------------|---------------------|-----------|
| Default landing / KPI header | `views.summary` | — |
| P0/P1 spotlight rail | `views.incidents.critical` | filter from `views.summary.banner` |
| Kanban main canvas | `views.board` | filter by `entity_type` in UI if split tabs |
| Incidents dedicated page | `views.incidents` | link card → open `source_path` in IDE (optional) |
| Team / roster page | `views.ownership` | — |
| Escalation sidebar or feed | `views.escalation_timeline` | same data as timeline strip, denser layout |
| Growth experiments tab | `views.board` | UI filter: cards where `tags` contains `growth` or column derived from `active/growth` paths |

---

## 4. Task board ↔ `views.board`

**Mapping**

- Agent Office **columns** = `board.columns[].id` (lifecycle: `intake` … `done`).
- Agent Office **cards** = `board.columns[].cards[]` + **`orphan_cards`** (always visible in a dedicated “Needs attention” swimlane or column).
- Card **title, priority, risk, owner** = `BoardCard` fields.
- **Stale** badge = `BoardCard.stale || BoardCard.blocked_stale`.
- **Escalation chip** = `BoardCard.escalation_reason` (non-null → show reason label).

**Board scope toggle (UI-only, no new adapter):**

- **All work:** all items in board model.
- **Tasks only:** filter cards where `source_path` includes `active/tasks/` (or `entity_type === task`).
- **Growth only:** path includes `active/growth/` or tag filter.

**Incidents on board:** Adapter may include incidents in `views.board` columns; Agent Office can duplicate them on **Incidents** page via `views.incidents` for density-optimized layout (P0 first).

---

## 5. Incidents ↔ `views.incidents`

**Mapping**

- **Critical rail** = `incidents.critical` (P0-first; adapter-defined).
- **Active list** = `incidents.active`.
- **Parse / data quality** = `incidents.degraded_parse` (unparsed frontmatter, validation errors).

**Agent Office behavior**

- Row click → **read-only detail** panel: show `title`, `owner_agent`, `validation_error_count`, `source_path`, `updated_at`.
- No “resolve” button that writes to repo (out of scope); optional **copy path** for maintainers.

---

## 6. Ownership ↔ `views.ownership`

**Mapping**

- **Agent row** = `ownership.agents[]` with `open_items`, `by_priority`, `items[]`.
- **Unassigned bucket** = `ownership.unassigned`.

**Agent Office behavior**

- Sort agents by `open_items` desc for **admin visibility**.
- Drill-down list under each agent uses `items[]` (lightweight rows).

---

## 7. Escalation ↔ `views.escalation_timeline`

**Mapping**

- **Timeline events** = `escalation_timeline.events[]` sorted by `at` descending.
- Each event: `reason`, `from_agent`, `item_key`, `title`, `priority`.

**Agent Office behavior**

- **Command center** uses top 3–5 events; full page uses full list.
- Empty timeline = valid state (no escalations in snapshot).

---

## 8. End-to-end flow: parser → adapter → UI

```
instalogist/workspace/**/*.md   (source of truth)
            │
            ▼
   instalogist/parser (CLI)
            │
            ▼
   operational-state.json       (instalogist-operational-state-1)
            │
            ▼
   visualization adapter         (pure function)
            │
            ▼
   adapted payload              (instalogist-ui-views-1)
            │
            ▼
   Agent Office render          (read-only components)
```

**Local-first options**

1. **Precompute:** CI or script writes `operational-state.json` then `adapted-views.json`; Agent Office loads static file(s).
2. **On open:** Agent Office shell runs parser + adapter via local bridge (desktop) or fetches last CI artifact (browser).

---

## 9. Refresh model

| Trigger | Action |
|---------|--------|
| **Manual refresh** | Re-run parser → re-run adapter → replace in-memory view model. |
| **Scheduled (optional)** | Poll static URL or file mtime every **≥ 60 s**; no websocket. |
| **On navigate** | Re-read if file `generated_at` older than threshold (UI policy). |

**UI must show:** “Last synced: `{source.generated_at}`” to avoid mistaking stale **snapshot** for stale **tasks**.

---

## 10. Degraded-state behavior

| Signal | Agent Office UX |
|--------|------------------|
| `snapshot_status === "degraded"` | **Banner** (non-blocking): “Some items failed validation or parse.” |
| `views.summary.banner === "critical"` | **Strong banner** + link to `incidents.degraded_parse` or orphan cards. |
| `state.errors.length > 0` (scan errors) | **Strip:** “Filesystem scan issues” + count; no silent hide. |
| `parse_status !== "ok"` on card | Badge on card; route to **orphan** swimlane when on board. |
| Adapter input invalid JSON | **Error page** with “Regenerate operational-state.json” instruction; no partial fake data. |

**Rule:** Never show an empty “all clear” if `snapshot_status` is degraded unless user explicitly filters to healthy-only (advanced).

---

## 11. Observability & admin visibility

| Signal | Where |
|--------|-------|
| Parser version | `source.parser_version` in adapted wrapper |
| Contract ids | `operational-state.contract_id` + `ui_contract_id` in footer (debug) |
| Counts | `views.summary` KPIs |
| Stale tasks | `summary.stale_count` + per-card badges |
| Unparsed markdown | `summary.unparsed_count` |

**Admin value:** One glance at command center answers: **How many open items? Who owns them? What escalated? Is the snapshot trustworthy?**

---

## 12. Explicit exclusions

- Realtime sync, collaborative editing of tasks inside Agent Office, LLM agents acting on UI.
- Direct `fetch(PATCH)` to workspace or parser mutating files.
- Database as source of truth for Instalogist (optional future **mirror** is out of this plan).

---

## 13. Related documents

- [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)
- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
- [instalogist-parser-architecture.md](./instalogist-parser-architecture.md)
- [instalogist-agent-protocol.md](./instalogist-agent-protocol.md)
- Workspace: `instalogist/workspace/README.md`
