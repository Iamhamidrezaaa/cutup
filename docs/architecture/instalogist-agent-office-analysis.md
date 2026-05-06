# External Agent Office (`harishkotra/agent-office`) — read-only integration assessment

**Repository:** https://github.com/harishkotra/agent-office  
**Assessment date:** 2026-05-10  
**Method:** Public GitHub sources only (`README.md`, `package.json`, `docker-compose.yml`, `.env.example`, repo layout API). **Local clone was not available** in the analysis environment (network); re-run a local clone for line-level code review before implementation.

**Constraint:** This document is **analysis only**. No CutUp production code changes. Instalogist remains **filesystem-native** with **`operational-state.json`** as operational source of truth for ops visibility.

---

## 1. Executive summary

`agent-office` is a **real-time, LLM-driven, multi-agent simulation** (pixel-art office, autonomous agents, tools, hiring). Its architecture assumes **WebSocket sync (Colyseus)**, **SQLite memory**, optional **Redis**, and **Ollama / OpenAI-compatible inference**.

**Instalogist** (as designed in this repo) is **read-only operational intelligence**: markdown workspace → parser → JSON snapshot → lightweight Command Center — **no realtime**, **no ops DB**, **no autonomous agents**.

**Compatibility for “drop-in” integration is low.** The overlap is **conceptual** (tasks, office metaphor), not **data-model** alignment. The **safest MVP path** is to keep **Instalogist Command Center** (or a thin adapter-fed panel) **separate** from Agent Office’s game server, and optionally **link** or **iframe** between them until a deliberate fork defines a read-only panel inside `@agent-office/ui`.

---

## 2. Architecture style (upstream)

| Aspect | Upstream `agent-office` |
|--------|-------------------------|
| Pattern | Monorepo **npm workspaces**: `packages/core`, `adapters`, `server`, `ui`, `cli` + `examples` |
| Runtime split | **Server** (game loop, memory, tools) + **UI** (Phaser canvas + React overlay) |
| Sync | **Colyseus** — state replicated to browsers in **real time** |
| Persistence | **SQLite** (`DATABASE_URL=sqlite:…` in Docker) for memories / layout / session persistence (per README) |
| Scaling | **Redis** in `docker-compose.yml` for multi-instance / scaling path |
| Inference | **Ollama** default; adapters for OpenAI-compatible APIs |
| UI stack | **Phaser.js** (world) + **React** (Chat, TaskBoard, SystemLog, LayoutEditor, etc.) |

**Conclusion:** This is a **live simulation platform**, not a static ops dashboard.

---

## 3. Frontend stack (upstream)

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| UI world | **Phaser.js** |
| UI chrome | **React** overlay on top of the game |
| Dev | Root `npm run start` runs **server in background** + **UI dev** (see root `package.json` `start` script) |
| UI port (docs) | README cites **http://localhost:5173** for UI dev |

**Instalogist Command Center (M0):** Vite + React + HashRouter — **no Phaser**. Merging UIs means either embedding Instalogist in a React subtree of `@agent-office/ui` or accepting two apps.

---

## 4. Routing (upstream)

Not fully inspected at file level (no local clone). **Expected:** Vite SPA for `@agent-office/ui`; routing is secondary to **game scene** + overlay panels. **Operational routing** (e.g. `/health`) is **not** part of upstream’s stated model.

**Instalogist** uses explicit hash routes (`#/health`). No conflict in principle if both apps run on different origins/ports.

---

## 5. State management (upstream)

| Source | Role |
|--------|------|
| **Colyseus room state** | Authoritative for agent positions, tasks inside simulation, events |
| **SQLite** | Long-term memory, layout, etc. (per README architecture diagram) |
| **LLM** | Drives agent “think” loop (~15s in README) |

**Instalogist:** Single **snapshot** JSON in memory after `fetch`; no WebSocket, no ORM.

**Mismatch:** Upstream **TaskBoard** is wired to **simulation tasks** and **agent actions**, not to **`operational-state.items`** from markdown files.

---

## 6. Expected data model (upstream)

From README / architecture description (not full schema):

- **Agents:** id, name, role, personality, position on grid, think/act state
- **Tasks:** in-world tasks created by user or agents, executed in simulation
- **Memories:** embedding-backed records in SQLite
- **Events:** system activity log, real-time feed

**Instalogist `operational-state.json`:**

- `items[]` from markdown frontmatter (`task_id`, `status`, `owner_agent`, `escalation`, …)
- `summary`, `graph`, `errors`, `snapshot_status`

**There is no stable 1:1 mapping** without a **translation layer** (and different semantics: “simulation task” ≠ “Instalogist operational task file”).

---

## 7. Realtime assumptions (upstream)

**Strong.** README: “Colyseus syncs state to all connected browsers in **real-time**”; “System Activity Log — **Real-time** feed”.

**Instalogist policy:** **No realtime** for ops MVP.

**Implication:** Treat Agent Office as an **optional visual demo** or **separate product**, not as the transport for Instalogist truth.

---

## 8. WebSocket usage (upstream)

**Colyseus** implies **WebSockets** (or similar transport) between `@agent-office/server` and `@agent-office/ui`.

**Instalogist:** HTTP `fetch` only for JSON.

**Integration risk:** Any plan that pipes `operational-state.json` through Colyseus **re-introduces realtime** and server authority — violates current Instalogist ops constraints unless explicitly approved as a **new phase**.

---

## 9. Mock / demo data structure (upstream)

- **`examples/ollama-startup`** — demo office (per README layout)
- **Docker** brings up server + UI + Redis + Ollama with **SQLite file** volume

**Instalogist:** `instalogist/workspace/active/**/*.md` + parser-generated JSON.

**Easiest shared artifact:** A **static JSON file** (`operational-state.json`) consumed by a **new read-only React panel** — **not** by replacing Colyseus state.

---

## 10. Easiest injection point for `operational-state.json`

Ranked from **safest / smallest blast radius** to **heavier**:

| Rank | Strategy | Description |
|------|----------|-------------|
| **1** | **Side-by-side apps** | Run Instalogist `command-center` (existing) on port A; run Agent Office UI on port B. Link in docs or header (“Open ops snapshot”). **Zero fork.** Preserves filesystem SOT. |
| **2** | **Static asset + fetch in forked `@agent-office/ui`** | Add a small **“Instalogist Ops”** React route/panel: `fetch('/operational-state.json')` + existing Instalogist adapter contract. **Does not** replace TaskBoard data binding. Requires **fork** of `agent-office`, not CutUp. |
| **3** | **iframe embed** | Admin host embeds Command Center build in a page. No change to Agent Office if iframe same-origin or CORS allowed. |
| **4** | **Server bridge (avoid for MVP)** | Server reads JSON and pushes to room state — **realtime**, **not** Instalogist MVP. |

**Recommended for Instalogist MVP:** **Rank 1 or 3**. Rank 2 only after explicit decision to maintain a fork.

---

## 11. Compatibility assessment

| Dimension | Fit |
|-----------|-----|
| **Operational clarity / admin visibility** | Instalogist Command Center **fits**; Agent Office **does not** map 1:1 without translation |
| **Filesystem-native SOT** | **Instalogist yes**; Agent Office **no** (SQLite + live state) |
| **No DB for ops** | **Instalogist yes**; Agent Office **no** |
| **No realtime** | **Instalogist yes**; Agent Office **no** |
| **Shared TypeScript ecosystem** | **Yes** — both TS; could share **types** or **adapter** package in a monorepo **outside** CutUp |

---

## 12. Integration difficulty

| Approach | Difficulty | Notes |
|----------|------------|-------|
| **Docs + deep links between two apps** | **Low** | No code coupling |
| **Embed Command Center (iframe/static)** | **Low–medium** | Hosting, CSP, auth |
| **New read-only panel inside Agent Office UI** | **Medium** | Fork maintenance, React + Phaser lifecycle |
| **Sync Instalogist tasks into Colyseus tasks** | **High** | Semantic mismatch, realtime, writes implied |
| **Replace Agent Office with Instalogist** | **N/A** | Different product goals |

---

## 13. Recommended integration strategy (phased)

1. **Phase 0 (now):** Treat Agent Office as **reference UX / inspiration only** — align Instalogist docs (`instalogist-agent-office-integration.md`, Command Center UI spec) with this reality.
2. **Phase 1:** **Operational pipeline E2E** — workspace → parser → `operational-state.json` → Instalogist Command Center (already M0).
3. **Phase 2:** **Optional** fork or vendor copy of `agent-office` **outside** `cutup` repo; add **read-only** panel consuming `operational-state.json` + `instalogist-ui-views-1` adapter output.
4. **Phase 3 (only if approved):** Explore **non-realtime** export from simulation (e.g. periodic JSON dump) — still secondary to filesystem SOT for **real** ops.

---

## 14. Risks

| Risk | Mitigation |
|------|------------|
| **Confusing two “task” models** | Naming in UI: “Simulation tasks” vs “Instalogist ops tasks” |
| **Scope creep into realtime** | Gate any Colyseus integration behind explicit architecture approval |
| **Fork drift** | Pin upstream version; document divergence |
| **Secrets / LLM cost** | Agent Office needs Ollama/API; Instalogist ops JSON does not — keep paths separate |
| **SQLite as competing SOT** | Never treat Agent Office DB as Instalogist truth for billing/auth/incidents |

---

## 15. Mismatch areas (summary)

- **Realtime vs snapshot**
- **Autonomous agents vs human/agent-edited markdown**
- **Colyseus state vs `operational-state.json`**
- **SQLite memory vs git-tracked workspace**
- **Phaser game loop vs admin dashboard density**
- **TaskBoard (sim) vs Kanban (ops spec)**

---

## 16. Safest MVP path (Instalogist-aligned)

1. **Do not** embed Agent Office server in CutUp deployment.
2. **Do not** require WebSocket for Instalogist ops readiness.
3. **Continue** Instalogist: parser + `operational-state.json` + Command Center (+ future adapter views).
4. **Optionally** run Agent Office as a **separate demo**; link from internal ops docs.
5. When integrating visually, prefer **iframe or shared static JSON** consumed by a **dedicated read-only** surface.

---

## 17. Next steps (analysis / engineering)

- [ ] Clone `harishkotra/agent-office` locally and inspect `packages/ui` for exact React entry and overlay mount point (validate Rank 2 feasibility).
- [ ] If embedding: define **CSP** and **single origin** policy for admin host.
- [ ] Keep **`operational-state.json`** contract stable; version bumps documented in parser architecture.

---

## 18. Related Instalogist documents

- [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md)
- [instalogist-command-center-ui.md](./instalogist-command-center-ui.md)
- [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)
- [instalogist-parser-architecture.md](./instalogist-parser-architecture.md)
