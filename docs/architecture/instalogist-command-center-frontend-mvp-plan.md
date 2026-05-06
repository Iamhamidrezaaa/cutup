# Instalogist Command Center — frontend MVP implementation plan

**Context:** `operational-state.json` exists; adapter contract ([instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)); UI spec ([instalogist-command-center-ui.md](./instalogist-command-center-ui.md)); integration flow ([instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md)).

**Goal:** First **safe** frontend phase — **read-only** operational visibility only. No realtime, no AI agents, no workspace writes, no heavy backend.

---

## 1. MVP scope (in)

| Deliverable | Notes |
|-------------|-------|
| Command center (home) | KPI row, escalation strip, degraded banner |
| Task board | Columns + orphan swimlane + read-only card drawer |
| Incidents | Critical / active / degraded_parse sections |
| Ownership | Expandable agent list + unassigned |
| Operational health | Snapshot meta, counts, `errors[]` list |
| Global header | Title, `generated_at`, `snapshot_status` badge, nav |
| Loading / error / empty states | Per UI spec |
| Operational filters | Client-side only (priority, owner, stale, tags) |

## 2. MVP scope (out)

- WebSockets, SSE, live collaboration.
- LLM or “agent” actions in UI.
- API server requirement (optional static file only).
- Editing task markdown or calling parser from browser write paths.
- Charts beyond simple counts (defer).

---

## 3. Recommended frontend stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Runtime** | **Vite + vanilla TypeScript** or **Vite + React 18** | Fast local dev, small bundle, easy embed later. Prefer **React** if admin dashboard will share components. |
| **Routing** | `react-router` (hash) or **plain hashchange** in vanilla | Local-first; works with `file://` limitations — **prefer local static server** (`vite preview` / `npx serve`) for `fetch()`. |
| **Styling** | **CSS modules** or **Tailwind** (one only) | Operational density; avoid CSS-in-JS weight for MVP. |
| **Adapter** | **TypeScript module** importing types from JSON contract | Same transforms as Node adapter if duplicated, or **single shared `adapt.ts`** compiled for browser (no Node-only APIs). |

**Recommendation:** **Vite + React + TypeScript + react-router (HashRouter)** — best balance for “future admin dashboard embedding” and component reuse.

**Node:** 20+ aligned with `instalogist/parser`.

---

## 4. Repository folder structure (new)

Place UI **outside** CutUp product surfaces:

```text
instalogist/
├── workspace/
├── parser/
└── command-center/              # new — frontend MVP
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    ├── README.md
    ├── public/
    │   └── .gitkeep             # optional: sample JSON for dev only (gitignore real PII snapshots)
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── routes.tsx
    │   ├── adapt/               # browser-side adapter (mirror spec)
    │   │   ├── index.ts         # adaptOperationalState(state, options) → UiViews
    │   │   ├── board.ts
    │   │   ├── incidents.ts
    │   │   ├── ownership.ts
    │   │   ├── escalation.ts
    │   │   ├── summary.ts
    │   │   └── types.ts         # OperationalState, UiViews from contracts
    │   ├── state/               # client data loading only
    │   │   ├── useOperationalSnapshot.ts
    │   │   └── constants.ts     # DEFAULT_JSON_URL, REFRESH_INTERVAL_MS
    │   ├── components/
    │   │   ├── layout/
    │   │   │   ├── AppHeader.tsx
    │   │   │   ├── AppNav.tsx
    │   │   │   ├── DegradedBanner.tsx
    │   │   │   └── LoadingErrorBoundary.tsx
    │   │   ├── command-center/
    │   │   │   ├── KpiRow.tsx
    │   │   │   └── EscalationStrip.tsx
    │   │   ├── board/
    │   │   │   ├── BoardView.tsx
    │   │   │   ├── BoardColumn.tsx
    │   │   │   ├── BoardCard.tsx
    │   │   │   └── CardDetailDrawer.tsx
    │   │   ├── incidents/
    │   │   │   └── IncidentsView.tsx
    │   │   ├── ownership/
    │   │   │   └── OwnershipView.tsx
    │   │   └── health/
    │   │       └── HealthView.tsx
    │   ├── filters/
    │   │   └── useOperationalFilters.ts
    │   └── styles/
    │       └── global.css
    └── test/
        ├── adapt.test.ts        # golden: fixture state → views
        └── setup.ts
```

**Shared adapter logic:** Long-term, extract `adapt/*` to `instalogist/shared/` or publish internal package; MVP may **duplicate** a thin layer in `command-center/src/adapt` and add a CI check that fixtures match Node adapter output (optional follow-up).

---

## 5. Component hierarchy

```
App
├── AppHeader (snapshot meta, nav)
├── DegradedBanner (conditional)
├── Outlet / Routes
│   ├── CommandCenterPage → KpiRow, EscalationStrip, quick links
│   ├── BoardPage → BoardView → BoardColumn[] → BoardCard[]
│   │       └── CardDetailDrawer (modal)
│   ├── IncidentsPage → IncidentsView (sections)
│   ├── OwnershipPage → OwnershipView
│   └── HealthPage → HealthView
```

**Presentational vs container:** Pages own `useOperationalSnapshot` + `adapt()`; dumb components receive **already-filtered** props.

---

## 6. State loading strategy

| Step | Behavior |
|------|----------|
| **Bootstrap** | Read `import.meta.env.VITE_OPERATIONAL_STATE_URL` or default `/operational-state.json` (served from `public/` in dev). |
| **Parse** | `response.json()` → validate `contract_id` === `instalogist-operational-state-1`. |
| **Adapt** | `views = adaptOperationalState(state, { now: new Date() })`. |
| **Store** | React: `useState` + `useMemo` for adapted views; **no Redux** for MVP unless needed. |

**Local-first workflow**

1. Developer runs `instalogist/parser` → writes `operational-state.json` into `command-center/public/` (gitignored) **or** serves repo root with JSON at known path.
2. `npm run dev` loads JSON via Vite proxy or `public/operational-state.json`.

**Production / embed:** Host static build + place JSON alongside or behind same-origin path; admin iframe loads `/command-center/index.html`.

---

## 7. Polling / refresh behavior

| Mode | MVP default |
|------|----------------|
| **Manual** | **Refresh** button in header → re-`fetch` same URL. |
| **Optional poll** | `VITE_REFRESH_INTERVAL_MS` — if set and **≥ 60000**, `setInterval` refetch; if unset, **no** polling. |

**No** `visibilitychange` aggressive refetch unless product asks (defer).

**UI:** On refetch, show **non-blocking** thin progress in header; keep previous data visible until new parse succeeds (avoid flash empty).

---

## 8. Degraded-state UX (implementation checklist)

- [ ] If `snapshot_status !== 'ok'`, render `DegradedBanner` with link to `/health` and `/incidents`.
- [ ] If `summary.banner === 'critical'`, stronger variant (CSS class).
- [ ] Board: `orphan_cards` always in swimlane; badge on cards with `parse_status !== 'ok'`.
- [ ] Health: always list `state.errors` when non-empty.
- [ ] Never show “all clear” headline when degraded unless user enables “hide degraded” **advanced** toggle (off by default).

---

## 9. Loading / error states

| State | UI |
|-------|-----|
| **Loading (first paint)** | Full-page skeleton or centered spinner + “Loading operational snapshot…” |
| **Fetch error** | Full-page: message + URL tried + “Ensure parser output exists and CORS/origin allows fetch.” |
| **Invalid JSON** | Same as fetch error with parse detail in dev only. |
| **Wrong `contract_id`** | Error panel: “Unsupported operational state version.” |
| **Empty `items`** | Neutral empty state: “No active items in snapshot.” |

---

## 10. Operational filtering (client-only)

**Filter state:** URL query (`#/board?priority=P0&stale=1`) or in-memory with “Share filters” deferred.

**Suggested filters**

- Priority (multi)
- Owner agent (multi)
- `stale` / `blocked_stale` boolean
- `tags` contains (substring)
- `entity_type` (board tab)

**Implementation:** `useOperationalFilters(views, query)` returns filtered `BoardCard[]` / sections; **does not** mutate source JSON.

---

## 11. Security / safety

- Do not embed **secrets** in env for MVP.
- If JSON contains `human_owner` emails, **do not** log full JSON to console in production build (strip in `import.meta.env.PROD` logger).
- **CSP** when embedded in admin: default-src conservative; JSON same-origin.

---

## 12. Testing (minimal)

- **Unit:** `adapt/*.ts` with fixture `operational-state` from parser test output.
- **Component:** smoke render of each page with mock `UiViews`.
- **E2E (optional):** Playwright loads dev server + static JSON — one path per screen.

---

## 13. Delivery phases

| Phase | Outcome |
|-------|---------|
| **M0** | Repo scaffold, `fetch` + parse + single **Health** page. |
| **M1** | Command center + board + degraded banner. |
| **M2** | Incidents + ownership + filters. |
| **M3** | Polish, embed doc, optional poll env. |

Single PR can ship M0–M2 if small; split for review.

---

## 14. Related documents

- [instalogist-command-center-ui.md](./instalogist-command-center-ui.md)
- [instalogist-visualization-adapter.md](./instalogist-visualization-adapter.md)
- [instalogist-agent-office-integration.md](./instalogist-agent-office-integration.md)
- `instalogist/parser/README.md`
