# CutUp — architecture docs

Operational and structural context for humans and AI agents (Instalogist). Not a tutorial for end users.

**Operational workspace (tasks, incidents, inbox):** [instalogist/workspace/README.md](../../instalogist/workspace/README.md)

## What lives here

| Document | Purpose |
|----------|---------|
| [instalogist-agent-protocol.md](./instalogist-agent-protocol.md) | Inter-agent roles, escalation, handoff, consultation matrix. |
| [instalogist-ai-operational-workforce.md](./instalogist-ai-operational-workforce.md) | AI-assisted ops workforce: reasoning, suggestions, gates, memory, safety, surfaces. |
| [instalogist-ai-native-operating-system.md](./instalogist-ai-native-operating-system.md) | North-star: unified graph, ingestion, memory, executive command center, predictions, cinematic UI, governance. |
| [instalogist-visualization-contract.md](./instalogist-visualization-contract.md) | Read-only data contract for dashboard / Agent Office (YAML + filesystem). |
| [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md) | Adapter: operational-state.json → UI view models (no UI implementation). |
| [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md) | Agent Office: view mapping, refresh flow, degraded UX (read-only). |
| [instalogist-agent-office-analysis.md](./instalogist-agent-office-analysis.md) | External harishkotra/agent-office repo: stack, realtime, integration risks. |
| [instalogist-agent-office-bootstrap.md](./instalogist-agent-office-bootstrap.md) | Local clone + run Agent Office under instalogist/agent-office (isolated). |
| [instalogist-agent-office-data-mapping.md](./instalogist-agent-office-data-mapping.md) | Map operational-state → Agent Office visualization vocabulary (spec only). |
| Instalogist package | [agent-office-adapter README](../instalogist/agent-office-adapter/README.md) — read-only JSON → UI views (`instalogist-agent-office-ui-1`). |
| [instalogist-command-center-ui.md](./instalogist-command-center-ui.md) | Minimal Command Center UI: screens, layout, nav, cards, degraded UX. |
| [instalogist-command-center-frontend-mvp-plan.md](./instalogist-command-center-frontend-mvp-plan.md) | Frontend MVP: stack, folders, loading, refresh, filters, tests. |
| [instalogist-parser-architecture.md](./instalogist-parser-architecture.md) | Parser pipeline → JSON operational state; local-first, no DB. |
| [instalogist-parser-mvp-plan.md](./instalogist-parser-mvp-plan.md) | MVP implementation plan: scope, layout, CLI, output, logging, tests. |
| [api-overview.md](./api-overview.md) | API domains, key modules, deployment surface (Vercel vs Express). |
| [risk-register.md](./risk-register.md) | High-impact systems, risk class, change constraints. |

## How to use (agents)

1. Before touching `server.js`, `vercel.json`, or `api/*.js`, read **api-overview** for domain boundaries.
2. Before payment, auth, subscription, or admin-user changes, read **risk-register** and follow repo rules in `.cursor/rules/instalogist-engineering.md`.
3. Multi-agent work: follow **instalogist-agent-protocol** for escalation and who to consult.

## Update rules

- New **route** or **env** that affects behavior: update `api-overview.md` (and later parity docs if you add them).
- New **third-party** or **money/session** integration: add or bump a row in `risk-register.md`.
- Keep tables short; link to code paths instead of copying implementation.

## Planned (not required to start)

- `deployment.md` — env matrix, Vercel vs VPS.
- `api-vercel-express-parity.md` — route diff table.
- `runbooks/` — incident and deploy steps.

## Ownership

**Doc maintainer:** assign an Instalogist owner (team or role). Until then, treat Owner columns in child docs as `TBD`.
