# Instalogist operational parser

Read-only scan of `instalogist/workspace` task/incident/growth markdown → **JSON operational state** (`instalogist-operational-state-1`).

- **No write-back** to workspace files.
- **No database**, no realtime, no network.

## Requirements

- Node.js **20+**

## Install

```bash
cd instalogist/parser
npm install
```

## Run locally

From `instalogist/parser`:

```bash
# Print JSON to stdout
node src/cli.mjs --root ../workspace

# Write file (lite mode: omit body_markdown)
node src/cli.mjs --root ../workspace --out ../workspace/meta/operational-state.json --lite

# Fixed clock for reproducible stale flags (tests / CI)
node src/cli.mjs --root ../workspace --now 2026-05-10T12:00:00Z --lite

# Verbose validation messages on stderr
node src/cli.mjs --root ../workspace --verbose
```

**Exit codes:** `0` = snapshot emitted (even if `snapshot_status` is `degraded`). `1` = fatal (bad `--root`, invalid `--now`).

## Tests

```bash
npm test
```

## Example output

See `example/operational-state.example.json` (generated from the repo workspace with `--lite --now`).

## Specs

- [instalogist-parser-architecture.md](../../docs/architecture/instalogist-parser-architecture.md)
- [instalogist-parser-mvp-plan.md](../../docs/architecture/instalogist-parser-mvp-plan.md)
- [instalogist-visualization-contract.md](../../docs/architecture/instalogist-visualization-contract.md)
