# Instalogist operational parser — MVP implementation plan

**Scope:** First safe implementation phase only. Aligns with [instalogist-parser-architecture.md](./instalogist-parser-architecture.md) and [instalogist-visualization-contract.md](./instalogist-visualization-contract.md).

## 1. MVP inclusions (explicit)

| Feature | In MVP |
|---------|--------|
| Markdown file discovery under workspace | yes |
| YAML frontmatter parse | yes |
| Validation rules (architecture §6) | yes |
| Single JSON snapshot output | yes |
| Stale + ownership graph | **defer to phase 1b** OR include if trivial — **recommend MVP includes stale + summary counts only; graph in 1b** |

**Recommendation for smallest MVP:** discovery + frontmatter + validation + `items[]` + `summary` + top-level `errors`. Add `derived.stale` in MVP (pure date math, no graph). Add `graph` in **1b** to keep first PR small.

*If you prefer one deliverable:* include `graph` in MVP per architecture doc — same PR, separate module file.

## 2. Explicit exclusions

- Realtime file watchers, cron inside parser, DB, write-back to workspace, mutating `meta/INDEX.md`, network I/O.

## 3. Recommended runtime

| Option | Rationale |
|--------|-----------|
| **Node.js 20+ (recommended)** | Same ecosystem as CutUp repo; `fs`, `path`, `yaml` package or `js-yaml`; CLI with `node instalogist/parser/dist/cli.mjs`. |
| Alternative | Python 3.11+ with PyYAML — only if team standardizes on Python for tooling. |

**Constraint:** Pin runtime in `instalogist/parser/package.json` engines field when added.

## 4. Repository folder structure (new code)

Place tooling **outside** `api/` and extension roots:

```text
instalogist/
├── workspace/                    # existing — parser only reads
└── parser/
    ├── package.json
    ├── README.md
    ├── src/
    │   ├── cli.mjs               # entry: argv, exit codes
    │   ├── discover.mjs        # enumerate .md, exclude README
    │   ├── extract.mjs         # split --- YAML / body
    │   ├── parse-yaml.mjs      # yaml → object + warnings
    │   ├── validate.mjs        # rules V-*, return errors/warnings
    │   ├── derive.mjs          # stale, days_since_update (optional graph.mjs)
    │   ├── assemble.mjs        # build operational state object
    │   └── constants.mjs       # enums: status, priority, agents
    └── test/
        └── fixtures/             # golden workspace snippets
```

**No files under `docs/` except specs** — implementation lives in `instalogist/parser/`.

## 5. Parser modules (responsibilities)

| Module | Responsibility |
|--------|----------------|
| `cli` | Parse `--root`, `--out`, `--lite`, `--now` (ISO); exit 0 if snapshot emitted; exit 1 only on fatal (missing root); degraded snapshot still exit 0 with `snapshot_status: degraded`. |
| `discover` | Resolve real path under root; reject `..`; `followSymlinks: false`; max file size check. |
| `extract` | Frontmatter split; return `{ frontmatterText, body, error? }`. |
| `parse-yaml` | Safe parse; on failure → degraded item, never throw out of process. |
| `validate` | Populate `item.validation.errors/warnings`; set `parse_status`. |
| `derive` | `stale`, `blocked_stale`, `days_since_update` using injected `now`. |
| `assemble` | Merge into `instalogist-operational-state-1` shape; `summary` aggregates. |

**Phase 1b:** `graph.mjs` builds nodes/edges from `items`.

## 6. JSON output location

| Mode | Location |
|------|----------|
| Default CLI | Stdout (pipe-friendly) **or** `--out instalogist/workspace/meta/operational-state.json` |
| Git policy | **Recommend gitignore** `instalogist/workspace/meta/operational-state.json` and `*.state.json` — generated artifact; CI can produce for dashboards without committing. |
| Admin dashboard | Build step copies or fetches pre-generated JSON from CI artifact; never commit PII-heavy snapshots to public branches without review. |

**Document in `instalogist/parser/README.md`:** example `node src/cli.mjs --root ../workspace --out ./state.json`.

## 7. Error handling

| Layer | Behavior |
|-------|----------|
| Missing workspace root | Fatal: JSON not written; stderr message; exit 1. |
| Unreadable file | `items[].validation.errors` + `snapshot_status: degraded`; continue scan. |
| Invalid YAML | Item `parse_status: unparsed_frontmatter` or `degraded`; continue. |
| Partial items | Always include `source_path` so UI can link to file. |

**Never:** throw uncaught exception that skips writing partial JSON (CLI top-level try/catch → emit minimal error envelope if assemble fails catastrophically).

## 8. Logging strategy (observability)

| Channel | Content |
|---------|---------|
| **stderr** | Human-readable: file path + rule id on warning/error; timing optional `--verbose`. |
| **JSON** | `summary.unparsed_count`, `summary.stale_count`, `snapshot_status` for machines. |
| **No structured log server** in MVP; optional `--json-log` line-delimited events later. |

**Secrets:** Do not log full frontmatter in verbose mode by default; or strip keys matching `*secret*`, `*key*`, `*token*`.

## 9. Operational safety checklist (pre-merge)

- [ ] Parser opens files read-only.
- [ ] Path traversal rejected.
- [ ] Max file size enforced.
- [ ] Exit code contract documented (0 = snapshot produced, 1 = fatal config).
- [ ] Generated JSON path gitignored if contains `human_owner`.
- [ ] README states “no write-back”.

## 10. Consumer compatibility

| Consumer | MVP contract |
|----------|----------------|
| Agent Office | Consume `items`, `summary`, `derived`; ignore missing `graph` until 1b. |
| Admin dashboard | Same; load static JSON from build or signed URL. |
| Future API | Wrap CLI or import `assemble()`; return JSON + `Cache-Control`; ETag from hash. |

**Contract id:** `instalogist-operational-state-1` unchanged unless spec bumps.

## 11. Testing (minimal)

- Fixture: 2 valid tasks, 1 invalid YAML, 1 missing `updated_at`.
- Snapshot test: golden `expected.json` compared with stable sort of `items` by `source_path`.
- CI: run parser on `instalogist/workspace/active/tasks` (simulation tasks OK); assert `snapshot_status` and no fatal.

## 12. Delivery phases

| Phase | Deliverable |
|-------|-------------|
| **MVP** | `instalogist/parser` package, CLI, modules above, tests, README, gitignore entry for output JSON. |
| **1b** | `graph.mjs`, body section extraction optional flag. |
| **1c** | Cross-check `meta/INDEX.md` optional warning. |

## 13. Related docs

- [instalogist-parser-architecture.md](./instalogist-parser-architecture.md)
- [instalogist-visualization-contract.md](./instalogist-visualization-contract.md)
