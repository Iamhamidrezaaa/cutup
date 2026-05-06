# Instalogist operational workspace

Filesystem-native tasks, incidents, and notes for Instalogist agents on CutUp. **Not** application code.

## Layout

| Path | Purpose |
|------|---------|
| `active/tasks/` | Open work items (YAML frontmatter + markdown body). |
| `active/incidents/` | Active or recovering incidents. |
| `active/growth/` | Growth hypotheses and experiments in flight. |
| `queue/inbox.md` | Quick human paste-in before triage. |
| `notes/operational/` | Deploy, env, cron reminders. |
| `notes/decisions/` | Short decision records (ADR-style). |
| `notes/scratch/` | Drafts; safe to prune. |
| `archive/` | Closed tasks, incidents, growth items (use `YYYY/` subfolders when volume grows). |
| `meta/INDEX.md` | Optional index of open items for agents and Agent Office. |
| `local/` | Gitignored; sensitive or machine-local only. |

## Coordination

- Visualization contract (dashboard read model): [docs/architecture/instalogist-visualization-contract.md](../../docs/architecture/instalogist-visualization-contract.md)
- Parser architecture (workspace → JSON state): [docs/architecture/instalogist-parser-architecture.md](../../docs/architecture/instalogist-parser-architecture.md)
- Roles and escalation: [docs/architecture/instalogist-agent-protocol.md](../../docs/architecture/instalogist-agent-protocol.md)
- Engineering rules: [.cursor/rules/instalogist-engineering.md](../../.cursor/rules/instalogist-engineering.md)
- Risk register: [docs/architecture/risk-register.md](../../docs/architecture/risk-register.md)

## Naming (summary)

- Tasks: `TASK-CUTUP-YYYY-NNNNN--short-slug.md`
- Incidents: `INC-YYYY-MM-DD-NN--short-slug.md`
- Growth: `GROW-YYYY-NNNN--short-slug.md`

Do not commit secrets. Use `local/` or your secret store.

## Operational snapshot (optional)

From `instalogist/parser`:

```bash
npm install
node src/cli.mjs --root ../workspace --out meta/operational-state.json --lite
```

`meta/operational-state.json` is gitignored by default. See `instalogist/parser/README.md`.
