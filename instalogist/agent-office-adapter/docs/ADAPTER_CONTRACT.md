# Adapter contract — `instalogist-agent-office-ui-1`

**Role:** Read-only projection of **`instalogist-operational-state-1`** into a minimal **Agent Office–styled** UI payload.

**Authority:** `operational-state.json` (parser output). This contract is **disposable**; bump version if shape breaks.

**Non-goals:** Persistence, realtime, WebSocket, auth, writes, CutUp API coupling.

---

## Envelope

```json
{
  "agent_office_ui_contract_id": "instalogist-agent-office-ui-1",
  "adapted_at": "ISO-8601",
  "source": {
    "contract_id": "string | null",
    "generated_at": "string | null",
    "parser_version": "string | null",
    "snapshot_status": "string"
  },
  "warnings": ["string"],
  "views": { }
}
```

- **`warnings`:** Soft issues (wrong `contract_id`, missing `items`, etc.). Emitted to **stderr** via `console.warn` during transform when applicable.
- **`adapted_at`:** Time the adapter ran (not parser `generated_at`).

---

## `views.board`

| Field | Type | Notes |
|-------|------|--------|
| `columns` | `{ id, title, cards[] }[]` | `id` = Instalogist lifecycle status; `cards` = task + growth items with matching `fields.status`. |
| `orphan_cards` | `BoardCard[]` | Missing / unknown `status`. |

### `BoardCard`

| Field | Type |
|-------|------|
| `item_key` | string |
| `title` | string |
| `priority` | string \| null |
| `risk_class` | string \| null |
| `owner_agent` | string \| null |
| `parse_status` | string |
| `stale` | boolean |
| `blocked_stale` | boolean |
| `tags` | string[] (coerced) |
| `domains` | string[] |
| `source_path` | string |
| `escalation_reason` | string \| null |
| `entity_type` | string |
| `preserved_extras` | object (parser `item.extras`) |
| `validation_error_count` | number |
| `validation_warning_count` | number |

---

## `views.incidents`

| Field | Type |
|-------|------|
| `critical` | `IncidentRow[]` (P0, parse ok) |
| `active` | other non-degraded incidents |
| `degraded_parse` | bad `parse_status` or validation errors |

### `IncidentRow`

Adds `preserved_extras`, `parse_status`, `validation_error_count` to base mapping spec.

---

## `views.ownership`

| Field | Type |
|-------|------|
| `agents` | `{ id, open_items, by_priority, items[] }[]` — **open** = status not `done` / `cancelled`. |
| `unassigned` | rows with no `owner_agent`. |

---

## `views.summary`

| Field | Type |
|-------|------|
| `snapshot_status` | string |
| `item_count` | number |
| `stale_count` | number (from parser summary when numeric) |
| `unparsed_count` | number |
| `degraded_items` | number (parse ≠ ok OR validation errors) |
| `scan_errors` | number (`errors.length`) |
| `counts_by_priority` | Record<string, number> |
| `counts_by_status` | Record<string, number> |
| `banner` | `ok` \| `degraded` \| `critical` |

**Banner rules (MVP):**

- `critical` if `scan_errors > 0` OR any **P0** item has validation errors.
- else `degraded` if `snapshot_status === 'degraded'` OR `degraded_items > 0`.
- else `ok`.

---

## Versioning

- Bump **`instalogist-agent-office-ui-2`** if any field is removed or repurposed.
- Additive fields are allowed in minor tooling updates without bump if consumers ignore unknown keys.

---

## Related

- [instalogist-agent-office-data-mapping.md](../../../docs/architecture/instalogist-agent-office-data-mapping.md)
- [instalogist-visualization-adapter.md](../../../docs/architecture/instalogist-visualization-adapter.md)
