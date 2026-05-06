# Instalogist Command Center UI — minimal design (read-only)

**Context:** Data from **`operational-state.json`** (and optionally precomputed **`instalogist-ui-views-1`** from the visualization adapter). **Agent Office** is the inspiration layer; this doc is the **first minimal screen spec** for Instalogist.

**Principles:** Read-only, local-first, operationally focused. No realtime, no autonomous AI in UI, no workspace mutation, no decorative animation.

---

## 1. Screen inventory

| Screen | Primary purpose | Primary data |
|--------|-----------------|--------------|
| **Command center** | At-a-glance health + escalations | `views.summary`, `views.escalation_timeline` |
| **Task board** | Status workflow scan | `views.board` |
| **Incidents** | Severity-first incident list | `views.incidents` |
| **Ownership** | Who owns what | `views.ownership` |
| **Operational health** | Snapshot trust + parse/scan quality | `views.summary` + raw `snapshot_status`, `errors`, counts |

All screens share a **global header** (see §3).

---

## 2. Global layout structure

```
┌─────────────────────────────────────────────────────────────┐
│ App header: title | snapshot age | status badge | nav      │
├─────────────────────────────────────────────────────────────┤
│ [Optional] Alert banner (degraded / critical only)          │
├─────────────────────────────────────────────────────────────┤
│ Main content region (screen-specific)                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Density:** Prefer **single column** on narrow viewports; board uses horizontal scroll for columns only if needed.

**Typography:** One sans stack; **tabular numbers** for counts. No more than **three** font sizes on a screen (title, body, meta).

**Color (semantic only):**

- **Neutral** base.
- **Warning** (amber): degraded snapshot, stale, validation warnings.
- **Danger** (red): critical banner, P0, scan errors.
- **Info** (blue): links, selected nav item.

---

## 3. Navigation model

**Pattern:** Persistent **top nav** or **left rail** (5 items + optional “Health”).

| Nav label | Route id | Screen |
|-----------|----------|--------|
| Command center | `/` or `#/` | Default |
| Board | `#/board` | Task board |
| Incidents | `#/incidents` | Incidents |
| Ownership | `#/ownership` | Ownership |
| Health | `#/health` | Operational health |

**Local-first:** Hash routing or static multi-page HTML is sufficient; no server router required.

**Deep link (optional v1):** `#/board?filter=stale` — UI-only filter, not persisted to workspace.

---

## 4. Screen specifications

### 4.1 Command center (home)

**Goal:** Answer in **&lt; 5 s:** Is the org OK? What escalated? Who is underwater?

**Layout**

1. **KPI row** (horizontal): `item_count`, `stale_count`, `unparsed_count`, open P0/P1 count (from summary or incidents).
2. **Banner slot:** Only if `summary.banner !== "ok"` or `snapshot_status === "degraded"`.
3. **Escalation strip:** Last **5** events from `escalation_timeline.events` — each line: **time · reason · title · priority**.
4. **Quick links:** Text buttons to Board / Incidents / Ownership (no mystery icons).

**Empty states:** “No escalations in this snapshot” is normal copy.

---

### 4.2 Task board

**Goal:** Scan workload by **lifecycle status**.

**Layout**

- **Columns:** Fixed order matching Instalogist lifecycle (`intake` → … → `done`). **Hide empty columns** optional toggle (default: **show** empty for stable layout).
- **Swimlane above columns:** **Orphan / needs attention** — `board.orphan_cards` (always visible if non-empty).

**Card hierarchy (each card)**

1. **Title** (one line, truncate with ellipsis).
2. **Meta row:** `priority` · `risk_class` · `owner_agent` (chips or plain text).
3. **Signals:** Small text or icon tokens: **STALE**, **BLOCKED-STALE**, **PARSE** (if `parse_status !== ok`).
4. **Escalation:** If `escalation_reason` set, single line under meta.

**Interaction:** Click card → **read-only drawer** or modal: full `source_path`, `tags`, `domains`, `validation.errors` count (no edit).

---

### 4.3 Incidents

**Goal:** **Incident awareness** — P0/P1 never buried.

**Layout**

1. **Section: Critical** — `incidents.critical` (dense list).
2. **Section: Active** — `incidents.active`.
3. **Section: Data quality** — `incidents.degraded_parse` (collapsed by default if empty).

**Row hierarchy**

- **Line 1:** `title` + **priority badge**.
- **Line 2:** `owner_agent` · `status` · relative `updated_at` (computed in UI from ISO).
- **Line 3 (conditional):** `validation_error_count > 0` → “Validation issues: N”.

**Sort:** Critical section internally sorted P0 first then by `updated_at` desc (adapter may already sort; UI preserves order).

---

### 4.4 Ownership

**Goal:** **Admin visibility** — balance load across agents.

**Layout**

- **List of agents** (expandable sections): `ownership.agents[]`.
- Each agent header: **id** + **open_items** + mini **priority breakdown** (text: `P0: n, P1: n, …`).
- Expanded: table or list of `items[]` (title + status + priority).
- **Unassigned** block at bottom if `unassigned.length > 0` (warning styling).

---

### 4.5 Operational health

**Goal:** Trust the dashboard — show **why** snapshot might be wrong.

**Layout**

1. **Snapshot metadata card:** `generated_at`, `parser_version`, `contract_id`, `snapshot_status`.
2. **Counts card:** `stale_count`, `unparsed_count`, `degraded_items`, `scan_errors`.
3. **Scan errors list:** Each `state.errors[]` — `message` + `path` if present.
4. **Guidance text (static):** “Regenerate: run parser on workspace; adapter is read-only.”

---

## 5. Degraded-state UX

| Condition | UI |
|-----------|-----|
| `snapshot_status === "degraded"` | **Persistent banner** below header: “Snapshot incomplete — some items have parse or validation issues.” Link to **Health** + **Incidents → Data quality**. |
| `summary.banner === "critical"` | **Stronger banner** (red): “Critical operational issues detected.” |
| Card with `parse_status !== "ok"` | Visible **badge** on card; never hide. |
| `state.errors.length > 0` | **Health** nav item shows **dot** or count badge. |
| Invalid / missing JSON file | Full-page message: “No operational state loaded” + path hint. |

**Do not** auto-dismiss degraded banners.

---

## 6. Card hierarchy (summary)

**Priority of information on any work card:**

1. **Title** (what)
2. **Priority + risk** (how hot)
3. **Owner** (who)
4. **Status / parse health** (trust)
5. **Escalation reason** (why it matters to ops)
6. **Path** (where in repo — detail only)

---

## 7. Implementation hints (non-binding)

**Concrete MVP plan:** [instalogist-command-center-frontend-mvp-plan.md](./instalogist-command-center-frontend-mvp-plan.md)

- **Stack:** Static HTML + minimal JS, or a small SPA; must run **offline** against a local JSON file (`file://` or local static server).
- **Data load:** `fetch('operational-state.json')` then run adapter in browser **or** load precomputed `adapted-views.json`.
- **Refresh:** Single **Refresh** button = reload JSON (no polling required for v1).

---

## 8. Explicit exclusions

- Live websocket updates, collaborative cursors, AI chat that mutates tasks.
- Drag-and-drop column changes that write status to files.
- Onboarding tours, gamification, heavy charts (defer sparklines to later).

---

## 9. Success criteria (for first build)

- Ops can **scan** board and incidents in under one minute.
- **P0** and **escalations** visible without scrolling on command center (typical laptop).
- **Degraded** state is **obvious**, never silent.
- **Snapshot age** always visible in header.

---

## 10. Related documents

- [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md)
- [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)
- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
