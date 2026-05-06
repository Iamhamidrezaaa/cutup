# Instalogist — Agent Office local bootstrap (isolated experiment)

**Purpose:** Run upstream **Agent Office** inside `instalogist/agent-office/` for **local UI experimentation** only.

**Out of scope for this doc:** `operational-state.json`, CutUp admin dashboard, production deployment, auth, new WebSockets in Instalogist, architectural rewrites of CutUp or Instalogist ops pipeline.

**Upstream:** https://github.com/harishkotra/agent-office (default branch `main`).

---

## 1. Isolated workspace layout

```
instalogist/
├── agent-office/          ← full git clone of harishkotra/agent-office (upstream root)
├── command-center/        ← Instalogist ops UI (unchanged)
├── parser/
└── workspace/
```

**Rule:** Treat `agent-office` as a **vendor / upstream** tree. Prefer **no edits** inside the clone; if a patch is unavoidable for local run, keep it minimal and document below (fork or `git diff`).

---

## 2. Prerequisites

| Requirement | Version / notes |
|-------------|----------------|
| **Node.js** | ≥ 18 (README says 18+); Node **20+** recommended |
| **npm** | ≥ 9 (workspaces) |
| **Git** | For clone |
| **Ollama** | **Required for full experience** (agents “think”); install from https://ollama.com |
| **LLM model** | e.g. `ollama pull llama3.2` (per upstream README) |
| **Build tools (Windows)** | If `sqlite3` native module fails: **Visual Studio Build Tools** + Python 3.x often needed |

**Docker (optional):** `docker compose up --build` starts server, UI, Redis, Ollama (see upstream `docker-compose.yml`). GPU section may need removal on CPU-only hosts.

---

## 3. Clone (first-time)

From repo root:

```powershell
cd instalogist
Remove-Item -Recurse -Force agent-office -ErrorAction SilentlyContinue
git clone https://github.com/harishkotra/agent-office.git agent-office
cd agent-office
```

**Submodule alternative** (keeps exact commit pinned):

```bash
git submodule add https://github.com/harishkotra/agent-office.git instalogist/agent-office
git submodule update --init --recursive
```

**Policy:** Whether `agent-office/` is committed, gitignored, or submodule is a **repo policy** decision; Instalogist ops docs do not require committing the clone.

---

## 4. Environment variables

From upstream **`.env.example`** (repo root):

| Variable | Required | Purpose |
|----------|----------|---------|
| `TAVILY_API_KEY` | **No** | Better web search via Tavily; else DuckDuckGo fallback (per `.env.example` comments) |

**Docker / server** (from `docker-compose.yml`):

| Variable | Context |
|----------|---------|
| `DATABASE_URL` | e.g. `sqlite:/data/office.db` (container) |
| `REDIS_URL` | e.g. `redis://redis:6379` |
| `API_URL` | UI → server (e.g. `http://server:3000` in compose) |

**Local dev without Docker:** rely on server defaults in `@agent-office/server` (inspect upstream `packages/server` after clone for exact env).

**Instalogist:** do **not** reuse CutUp `.env` or production secrets for this sandbox.

---

## 5. Install and build

```powershell
cd instalogist/agent-office
npm install
npm run build
```

This runs **`build` across workspaces** (`packages/*`, `examples/*`) per root `package.json`.

**If `npm install` fails** on `sqlite3` (native bindings): see §9.

---

## 6. Startup process (local dev, no Docker)

Upstream **README** pattern (two terminals):

**Terminal 1 — server**

```powershell
cd instalogist/agent-office
npm run start --workspace=@agent-office/server
```

**Terminal 2 — UI**

```powershell
cd instalogist/agent-office
npm run dev --workspace=@agent-office/ui
```

**Convenience:** Root script `npm start` runs server in background then UI (POSIX `sh`); on **Windows** prefer the two explicit terminals above.

---

## 7. Runtime ports

| Service | Port | Notes |
|---------|------|--------|
| **UI (Vite)** | **5173** | Stated in upstream README for `@agent-office/ui` |
| **Server (Node)** | **3000** | `docker-compose.yml` maps `3000:3000` |
| **Redis** | 6379 | Docker only |
| **Ollama** | 11434 | Typical default (confirm on host) |

**Instalogist Command Center** uses **5174** in this repo — **no port conflict** if both run locally.

---

## 8. Verify

1. Open **http://localhost:5173** (UI).
2. Ensure **Ollama** is running and model pulled if agents should “think”.
3. If UI loads but agents idle, check server terminal logs and Ollama connectivity.

---

## 9. Dependency and compatibility issues

| Issue | Mitigation |
|-------|------------|
| **`sqlite3` build on Windows** | Install **windows-build-tools** / VS C++ workload; use **Node LTS** matching prebuilds; or use **WSL2** / **Docker** for server |
| **npm workspaces hoisting** | Run commands from **repo root** with `--workspace=` as upstream docs |
| **Node version** | Vite 7 in `@agent-office/ui` may prefer newer Node; use Node **20+** |
| **Colyseus / WebSocket** | Upstream **requires** WebSocket between UI and server for the **game** — this is **not** an Instalogist addition; do not confuse with “no websocket” rule for **CutUp production** |
| **GPU in `docker-compose`** | Remove / comment `deploy.resources` NVIDIA section for CPU-only |
| **Network / clone** | Corporate proxies may block `git clone` or `npm`; retry or mirror |

---

## 10. Compatibility vs Instalogist operational stack

| Topic | Agent Office (upstream) | Instalogist ops |
|-------|-------------------------|-----------------|
| Source of truth | Simulation state + SQLite | Markdown workspace + `operational-state.json` |
| Realtime | Yes (Colyseus) | Not required for ops MVP |
| Purpose | Demo / research UI | Operational visibility |

**This bootstrap does not integrate the two.** See [instalogist-agent-office-analysis.md](./instalogist-agent-office-analysis.md).

---

## 11. Minimum modifications policy

- **Ideal:** **zero** patches to upstream; only clone + install + run.
- **Acceptable:** local `.env`, local data dirs, Docker resource tweaks for your machine.
- **Avoid:** editing `OfficeRoom.ts` or core loops **until** there is a named integration phase.

---

## 12. Related docs

- [instalogist-agent-office-analysis.md](./instalogist-agent-office-analysis.md)
- [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md)
- Upstream: `README.md`, `docker-compose.yml`, `.env.example` in the clone

---

## 13. Clone verification note (this environment)

A full `git clone` was **not** executed successfully from the automation environment (network reset). Treat **§3–§8** as the canonical procedure; after a successful clone on your machine, update this doc with any **version-specific** deltas (e.g. port change in a future release) via a small PR.
