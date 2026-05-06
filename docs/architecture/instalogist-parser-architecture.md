# Instalogist operational parser — architecture (no implementation)

Transforms **read-only** filesystem workspace files into a single **JSON operational state** snapshot for dashboards, Agent Office, and future APIs. **Local-first; no database; no writes** to workspace files from the parser.

## 1. Goals and non-goals

**Goals**

- Deterministic scan of `instalogist/workspace/active/**` (and optional `archive/**`).
- Extract YAML frontmatter + minimal body signals into typed items.
- Validate against Instalogist Task v1 (and visualization contract).
- Compute derived fields: stale flags, ownership graph, escalation edges.
- Emit one JSON document per run (stdout or file path supplied by caller).

**Non-goals**

- Mutating markdown, INDEX.md, or git state.
- Realtime watchers (optional separate process may call parser on interval).
- Storing history inside the parser (callers may version JSON artifacts).

---

## 2. Parser responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Discovery** | Enumerate `*.md` under configured roots; exclude `README.md` and dotfiles. |
| **Read** | Open files with UTF-8; bounded file size (configurable max, e.g. 512 KiB) to avoid DoS on accidental huge files. |
| **Extract** | Split first YAML frontmatter from body; parse YAML to a plain object. |
| **Classify** | Infer `entity_type`: `task` \| `incident` \| `growth` from path (`tasks/`, `incidents/`, `growth/`) or optional `entity_type` in frontmatter. |
| **Validate** | Apply rules in §6; never throw away file — attach `parse_status` per file. |
| **Derive** | Stale (§7), ownership graph (§8), optional severity ordering. |
| **Serialize** | Output JSON schema in §9. |
| **Report** | Collect `errors` and `warnings` without failing the whole snapshot (partial success). |

---

## 3. Frontmatter extraction

1. **Delimiter:** First line `---`, then lines until next `---` on its own line; remainder is **body**.
2. **If no closing `---`:** Treat entire file as body; `frontmatter: null`, `parse_status: unparsed_frontmatter`.
3. **YAML parser:** Strict-ish mode preferred; unknown keys **allowed** (forward compatibility) but listed under `extras` in output item.
4. **Normalizations:** Trim strings; `updated_at` / `created_at` parsed to ISO-8601 if possible; on failure → `warnings` + keep raw string.

---

## 4. Markdown body handling (v1)

**Read-only, non-authoritative** for core cards; used for drill-down and future section parsers.

| Behavior | Detail |
|----------|--------|
| **Store raw** | `body_markdown` optional in JSON (may be omitted in “lite” mode to shrink payload). |
| **Optional sections** | Regex or heading scan for `## Timeline`, `## Resolution`, `## Context` — first match only, text until next `##`. Populate `body_sections` object if enabled. |
| **Strip secrets** | Do not run secret scanners in v1; **operational safety**: recommend `lite` mode for external dashboards (no body). |

---

## 5. Operational safety

- **Paths:** Resolve under workspace root only; reject `..` and absolute paths outside root.
- **Symlinks:** Follow policy `follow_symlinks: false` by default.
- **Writes:** None. Parser MUST NOT open files in write mode.
- **PII:** JSON may contain `human_owner` emails — callers gate admin dashboard and logs.
- **Idempotency:** Same filesystem input → same JSON output (stable key order optional for diffs).

---

## 6. Validation rules

Per file, after YAML parse:

| Rule id | Condition | Severity |
|---------|-----------|----------|
| `V-ID` | Missing `task_id` and missing `incident_id` | error |
| `V-TITLE` | Missing or empty `title` | error |
| `V-STATUS` | `status` not in allowed lifecycle set | warning |
| `V-PRIORITY` | `priority` not in `P0\|P1\|P2\|P3` | warning |
| `V-RISK` | `risk_class` not in `C\|H\|M\|L` | warning |
| `V-OWNER` | `owner_agent` not in Instalogist enum | warning |
| `V-DATE` | `updated_at` missing | error (card still listed with `parse_status: degraded`) |
| `V-ESC` | `escalation` present but not object | warning |

**`parse_status` per item:** `ok` \| `degraded` \| `unparsed_frontmatter` \| `empty`.

**Snapshot-level:** `snapshot_status: ok` if zero errors, else `degraded`; still emit full JSON.

---

## 7. Stale detection (derived)

Same defaults as [instalogist-visualization-contract.md](./instalogist-visualization-contract.md):

- `stale: true` if `updated_at` &lt; now − 14d and `status` ∉ {`done`, `cancelled`, `blocked`}.
- `blocked_stale: true` if `status == blocked` and `updated_at` &lt; now − 7d.

Add numeric `days_since_update` for sorting. Clock: caller-supplied `now` (ISO) for testability.

---

## 8. Ownership graph generation

**Nodes:** Each Instalogist agent id + optional `human_owner` as separate node type `human`.

**Edges** (directed, labeled):

| Edge | From | To | Label |
|------|------|-----|-------|
| owns | item_id | owner_agent | `owns` |
| collaborates | item_id | collaborator | `collaborates` |
| escalated_from | item_id | escalation.from_agent | `escalated_from` if set |

**Output:** `graph: { nodes: [...], edges: [...] }` with stable ids (`task_id` or path-based fallback).

**Use:** Agent Office “who is overloaded”; admin dashboard team view; future API `/graph` subset.

---

## 9. JSON operational state (output format)

Top-level shape (contract id: **`instalogist-operational-state-1`**):

```json
{
  "contract_id": "instalogist-operational-state-1",
  "generated_at": "ISO-8601",
  "workspace_root": "resolved/path",
  "parser_version": "semver TBD",
  "snapshot_status": "ok | degraded",
  "items": [
    {
      "source_path": "relative/path/from/workspace/root",
      "entity_type": "task | incident | growth",
      "parse_status": "ok | degraded | unparsed_frontmatter | empty",
      "fields": { },
      "validation": { "errors": [], "warnings": [] },
      "derived": {
        "stale": false,
        "blocked_stale": false,
        "days_since_update": 3
      },
      "extras": { }
    }
  ],
  "graph": {
    "nodes": [],
    "edges": []
  },
  "summary": {
    "counts_by_status": {},
    "counts_by_owner": {},
    "counts_by_priority": {},
    "stale_count": 0,
    "unparsed_count": 0
  },
  "errors": []
}
```

- **`fields`:** flattened or nested copy of frontmatter keys consistent with visualization contract.
- **`errors`:** fatal scan issues (permission denied, root missing).
- **`summary`:** pre-aggregated for cheap dashboard first paint.

---

## 10. Execution model (local-first)

1. CLI or library: input `WORKSPACE_ROOT`, optional `INCLUDE_ARCHIVE=true`, optional `LITE_MODE=true` (omit body).
2. Single-threaded scan adequate for &lt; few thousand files; optional worker pool later **without changing JSON contract**.
3. Output: stdout or `--out state.json`; caller responsible for not committing secrets.

---

## 11. Compatibility expectations

| Consumer | Expectation |
|----------|-------------|
| **Agent Office** | Consumes `items`, `derived`, `graph`, `summary`; filters by `tags`, `domains`, `escalation.reason`. Maps 1:1 to [instalogist-visualization-contract.md](./instalogist-visualization-contract.md). |
| **Admin dashboard** | Same JSON via static import or small backend that runs parser on schedule; **no** direct filesystem in browser; gate with auth. |
| **Future API layer** | `GET /instalogist/state` returns this JSON or a subset; ETag from hash of `generated_at` + content hash; read-only cache in memory. |

**Versioning:** Bump `contract_id` when breaking `items[].fields` or `graph` shape; minor additive fields allowed without bump.

---

## 12. Implementation phases (future, out of scope here)

**Concrete MVP plan:** [instalogist-parser-mvp-plan.md](./instalogist-parser-mvp-plan.md)

1. Node or Python CLI + JSON schema file for validation of output.
2. Golden-file tests: sample workspace → expected JSON.
3. Optional `meta/INDEX.md` cross-check: warn if INDEX row missing file or file missing INDEX.

---

## 13. Related documents

- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
- [instalogist-agent-protocol.md](./instalogist-agent-protocol.md)
- Workspace: `instalogist/workspace/README.md`
