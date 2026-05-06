# Instalogist visualization layer — operational data contract (read-only)

**Status:** Specification. Consumers treat workspace files as **read-only**. No database or realtime channel is assumed; a dashboard **indexes** the filesystem (or a snapshot) on demand or on a schedule.

## 1. Data sources

| Glob / path | Entity | Notes |
|-------------|--------|--------|
| `instalogist/workspace/active/tasks/*.md` | Task | Primary; exclude `README.md`. |
| `instalogist/workspace/active/incidents/*.md` | Incident | Exclude `README.md`. |
| `instalogist/workspace/active/growth/*.md` | Growth item | Same pattern as tasks; optional fourth card type. |
| `instalogist/workspace/meta/INDEX.md` | Optional hint | Parsed as supplementary index only; **source of truth is each task/incident file**. |
| `instalogist/workspace/archive/**` | Historical | Optional “closed” views; same schema as active. |

**Encoding:** UTF-8. **Format:** Markdown with **YAML frontmatter** delimited by `---` at file top (Instalogist Task v1 or compatible).

---

## 2. Parsing rules (dashboard)

1. For each eligible `.md` file, read the first YAML block between opening `---` and closing `---`.
2. If YAML is missing or invalid, surface file as **unparsed** with path only (do not write back).
3. Body markdown below frontmatter is **detail pane** / expanded view only; cards use frontmatter first.
4. `task_id` (or incident-specific id field) must be unique among scanned files; collisions → warning in UI.

---

## 3. Task card (active task view)

**Minimum card payload** (all from frontmatter when possible):

| UI field | YAML key | Required |
|----------|----------|----------|
| Title | `title` | yes |
| Id | `task_id` | yes |
| Status | `status` | yes |
| Priority | `priority` | yes |
| Risk | `risk_class` | yes |
| Owner | `owner_agent` | yes |
| Collaborators | `collaborators` | no (default `[]`) |
| Domains | `domains` | no |
| Updated | `updated_at` | yes (ISO-8601) |
| Blast radius (subtitle) | `blast_radius_summary` | no |
| Tags | `tags` | no |

**Card actions (read-only phase):** open file path, filter by tag/domain, link to `links.protocol` / `links.risk_register` if present.

---

## 4. Incident card

Incidents use the **same frontmatter base** as tasks, with these semantics:

| UI field | YAML key | Required |
|----------|----------|----------|
| Id | `task_id` **or** `incident_id` | one required; prefer `incident_id` if split later |
| Title | `title` | yes |
| Severity | `priority` (map P0–P3) **or** optional `severity` alias | yes |
| Status | `status` | yes |
| Owner | `owner_agent` | yes |
| Updated | `updated_at` | yes |
| Risk | `risk_class` | recommended |

**Optional incident extensions** (for visualization only; not required v1):

- `timeline` as YAML list in frontmatter **or** first `## Timeline` section in body for detail view.
- `resolution_summary` in body under `## Resolution` for closed incidents.

Until `incident_id` is standardized, parsers SHOULD accept `task_id` in incident files for a single schema.

---

## 5. Growth card

Same shape as **task card**. `owner_agent` is usually `Growth-01`. `risk_class` often `L` or `M`.

---

## 6. Ownership view

**Group by:** `owner_agent` (enum: `Dev-01`, `Audit-01`, `Ops-01`, `Support-01`, `Growth-01`).

**Columns suggested:** count by `status`; list P0/P1 first per owner.

**Secondary grouping:** `collaborators` — show card under owner **and** optional “involved” filter for each collaborator (read-only join).

---

## 7. Escalation view

**Source:** `escalation` object in frontmatter.

| UI field | YAML path | Required for escalation filter |
|----------|-----------|--------------------------------|
| From | `escalation.from_agent` | if object non-empty |
| Reason | `escalation.reason` | recommended |
| At | `escalation.escalated_at` | recommended |

**Rules:**

- Empty `escalation: {}` → not shown in “escalated queue” unless optional toggle “all items.”
- Reason values SHOULD be drawn from a fixed set for charts: `payment_failure`, `auth_session`, `deploy_failure`, `customer_impact`, `suspicious_activity`, `growth_hypothesis`, etc. (extend in meta doc only).

---

## 8. Stale task indicators

**Inputs:** `updated_at`, `status`, optional `blocked_reason` / `next_action_by` (future optional fields).

**Default stale rule (aligns with workspace README proposal):**

- Stale if `updated_at` older than **14 days** AND `status` not in `done`, `cancelled`, `blocked`.
- **Blocked stale:** `status == blocked` AND `updated_at` older than **7 days** (flag “blocked needs nudge”).

**UI:** badge `stale`, sort key `days_since_update`. No writes.

---

## 9. Risk indicators

Map `risk_class` to badge color / icon:

| Value | Label |
|-------|--------|
| `C` | Critical |
| `H` | High |
| `M` | Medium |
| `L` | Low |

**Domain overlay:** if `domains` contains `payments` or `auth`, show secondary **shield** indicator even when `risk_class` is M (informational).

---

## 10. Required YAML fields for visualization (v1)

**Tasks, incidents, growth items** — minimum for dashboard row/card:

```yaml
task_id: string          # or incident_id; see §4
title: string
status: string           # lifecycle enum
priority: string         # P0 | P1 | P2 | P3
risk_class: string       # C | H | M | L
owner_agent: string
updated_at: string       # ISO-8601
```

**Strongly recommended** (degraded UI if missing):

```yaml
domains: [string]
tags: [string]
blast_radius_summary: string
collaborators: [string]
escalation: {} | { from_agent, reason, escalated_at }
links: {}
created_at: string
```

---

## 11. Agent Office–style views (compatibility)

| View | Data |
|------|------|
| **Board** | Cards = active tasks/incidents/growth; columns = `status`. |
| **Command center** | P0/P1 at top; risk C/H highlighted; escalation queue. |
| **Ownership** | Group `owner_agent`; workload counts. |
| **Timeline** | Sort by `updated_at` or `escalation.escalated_at`. |
| **Health** | Count stale; count unparsed files; optional parity with `meta/INDEX.md` mismatches. |

**Filters:** `priority`, `risk_class`, `owner_agent`, `domains`, `tags`, `escalation.reason`, simulation tag `simulation` if present.

---

## 12. Non-goals (this version)

- No websocket, no DB, no bi-directional sync.
- No automatic mutation of YAML from the dashboard.
- No canonical merge with external ticketing unless a future adapter writes files here.

---

## 13. UI adapter (next layer)

Transformation of this file’s output shape (parser JSON) into view models: [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md).

## 14. Versioning

- Contract id: **`instalogist-viz-contract-1`**.
- Breaking frontmatter changes bump version and get a migration note in this file.
