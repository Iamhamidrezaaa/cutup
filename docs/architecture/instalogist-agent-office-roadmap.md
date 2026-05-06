# Instalogist Agent Office — Staged Evolution Roadmap

**Status:** architecture and sequencing only — **no implementation commitment** in this document.  
**Principles (non-negotiable):** operational **transparency**, **auditability**, and **human override authority** over any automated or AI-mediated action.

This roadmap extends the read-only MVP (`instalogist-agent-office-mvp.md`) toward a **governed** operational plane: real-time awareness, multi-party use, and optional automation **inside explicit boundaries**.

---

## Guiding constraints

| Constraint | Meaning |
|------------|---------|
| Architecture-first | Each stage defines **components, trust boundaries, and data contracts** before features. |
| No premature implementation | Stages may be **skipped, reordered, or split** after validation; no “build everything” assumption. |
| Operational transparency | Every consumer-visible state has a **traceable path** from source events or snapshots. |
| Auditability | **Who / what / when / why** is recorded for actions that affect operations or posture. |
| Human override | Humans can **stop, revert, or supersede** proposed or executed changes within policy. |

---

## Stage 0 — Baseline (current direction)

**Intent:** Single source of truth from parser output; UI is a **projection**, not an authority.

- **Realtime:** None required; **pull** snapshot on demand or on a timer (operator-controlled).
- **Streams:** N/A.
- **Parser:** On-demand or external CI/job; schedule is **manual or external** to Agent Office.
- **Multi-user:** File-based or shared snapshot URL; **no session model**.
- **Auth:** None or static hosting; **no production CutUp** coupling.
- **Embedding:** Standalone MVP UI or iframe-friendly static host; **no shared admin session**.
- **Support ops:** Read-only triage views; escalations visible from data, not from chat integration.
- **AI-to-AI:** Out of scope; no agent mesh.
- **Autonomy:** **Zero** automated execution from Agent Office.
- **Audit:** Git history on workspace + snapshot metadata (`generated_at`, `snapshot_status`) as **weak audit** only.
- **Topology:** Static UI + artifact store (file, object storage, or simple HTTP).
- **Scaling:** Bounded by snapshot size and parse time; **no cluster** assumption.
- **Governance:** Product and security policies **external** to this stage.

**Exit criteria for Stage 1:** Agreed **event vocabulary** and **snapshot versioning** policy; decision on **push vs pull** for freshness.

---

## Stage 1 — Near-realtime awareness (architecture)

**Intent:** Reduce staleness without turning the UI into a **write path** or **control plane**.

### Realtime architecture

- **Model:** Maintain **immutable snapshots** as the authority; “realtime” means **faster propagation of new snapshots** or **delta notifications** that **invalidate** client cache and trigger re-fetch.
- **Preferred pattern:** **Snapshot + sequence number** (monotonic `snapshot_seq` or content hash) so all clients agree on **what they are looking at**.
- **Anti-pattern:** Mutable shared “live board” state with no backing snapshot — **breaks audit replay**.

### WebSocket / event stream

- **Option A (minimal):** **Server-Sent Events (SSE)** or WebSocket channel carrying only **`{ snapshot_ref, seq, reason }`** — clients still **GET** full snapshot from a stable URL/API.
- **Option B (richer):** Stream **append-only operational events** (file touched, parse started/completed, validation summary) for **transparency panels**; **snapshot remains the reconciled view** for Kanban/incidents.
- **Contract discipline:** Event schema versioned; **parsers and publishers** are the only writers to the stream contract.

### Parser scheduling

- **Triggers:** Time-based (cron), **webhook on repo/workspace change**, or **manual “rebuild snapshot”** from admin/support tooling.
- **Separation:** Scheduler **does not** call UI; it **invokes parser** and publishes **snapshot + metadata + seq**.
- **Back-pressure:** If parses overlap, **coalesce** (latest wins) or **queue** with explicit “skipped run” audit entries.

### Multi-user support

- **Concurrency model:** Many readers, **single writer** for snapshot generation (parser job). **No optimistic locking in UI** for task content in this stage.
- **Presence (optional):** Show **who is viewing** which snapshot seq — informational only.

### Auth strategy

- **Read path:** Authenticated read (e.g. SSO or API token) to snapshot and event stream endpoints.
- **Principle:** **Auth proves identity**; **authorization** is layered in Stage 2+.

### Admin dashboard embedding

- **Pattern:** Embed Agent Office as a **read-only module** (iframe or federated module) with **explicit `snapshot_url` / `stream_url`** props; **no shared mutable admin state** inside the embed.

### Support operations

- **Deep links** to snapshot seq, incident id, and **source path** in workspace.
- **Runbooks** linked from projected fields (existing MVP pattern), not from opaque AI state.

### AI-to-AI communication

- **Out of scope** as execution. If “copilot” suggestions exist elsewhere, they **must not** write to workspace without human-gated flow (see Stage 3).

### Autonomous execution boundaries

- **None.** All automation stops at **notification and cache invalidation**.

### Audit logging

- **Technical audit:** Parse start/end, snapshot id, seq, duration, error counts, publisher identity.
- **No** “user edited task” events (no edits yet).

### Deployment topology

- **Static UI** + **small realtime fan-out service** (SSE/WebSocket) + **object storage or CDN** for snapshots.
- **Parser** as job runner (container, CI, or worker queue).

### Scaling risks

- **Snapshot size** growth → slower downloads, UI render cost; **mitigation:** pagination inside adapter contract or **sharded views** (by domain/team).
- **Fan-out** connections → **stateless** edge + **redis/pub-sub** or managed bus later.

### Governance boundaries

- **Data classification** of snapshots (PII, customer ids) drives **who may subscribe**.
- **Change management:** New event types require **schema review** and **consumer compatibility** window.

---

## Stage 2 — Multi-tenant read and policy (architecture)

**Intent:** Same transparency model, **stronger gates** for who sees what.

### Realtime / streams

- **Per-tenant topics** or **signed stream URLs**; **no cross-tenant seq leakage**.

### Parser scheduling

- **Tenant-scoped** workspaces; schedules **isolated**; **quota** per tenant (parse minutes/day).

### Multi-user support

- **Roles:** e.g. `viewer`, `support`, `operator`, `auditor` — **read-only vs elevated read** (see sensitive fields).
- **Row/field-level redaction** in **adapter layer** based on claims — **source snapshot stays complete** in secure store; **projections** are policy-bound.

### Auth strategy

- **OIDC/SSO** preferred; **service accounts** for parser publishers with **narrow** scopes.
- **MFA** for roles that can trigger parse or see sensitive projections (policy-dependent).

### Admin dashboard embedding

- **Session propagation** via short-lived tokens or **BFF** pattern; **no long-lived secrets** in browser for stream access.

### Support operations

- **Ticket correlation ids** in operational items; **stream events** may reference **external** ticket systems (outbound only, audited).

### AI-to-AI

- Still **no** autonomous cross-agent execution; **optional** read-only “explanation” services **must** cite **snapshot seq** and **source excerpts** for traceability.

### Autonomous execution boundaries

- **Still none** for workspace mutation.

### Audit logging

- **Access audit:** who fetched which snapshot seq or subscribed to which topic.
- **Retention** and **immutability** requirements defined per jurisdiction/product.

### Deployment topology

- **Regional** deployment option for data residency; **global** UI with **regional** data plane.

### Scaling risks

- **Authorization on hot path** — cache **claims → projection profile**, not per-row DB lookups in UI.
- **Tenant noisy neighbor** on parser — **hard quotas** and **fair scheduling**.

### Governance boundaries

- **DPIA / security review** for streaming operational data off-prem.
- **Break-glass** procedure: **auditor** role can **disable streams** while keeping **snapshot archival**.

---

## Stage 3 — Human-gated action plane (architecture)

**Intent:** Allow **proposals** and **approved** changes while preserving **override** and **audit**.

### Realtime architecture

- **Command channel** separate from **event/snapshot channel**. Commands are **never** mixed into snapshot stream without **reconciliation**.

### WebSocket / event stream

- Events include **`proposal_created`**, **`proposal_approved`**, **`proposal_rejected`**, **`change_applied`**, **`change_failed`** — all **correlate** to a **human actor** or **named automation** with policy id.

### Parser scheduling

- **Post-action parse** mandatory for **closed loop**: applied change → **verify** snapshot reflects intent or **raise** incident.

### Multi-user support

- **Approval workflows** (dual control for high risk classes); **SLA timers** visible in UI.

### Auth strategy

- **Step-up** auth for approval; **break-glass** accounts **highly** audited.

### Admin dashboard embedding

- **Embedded** approval queue; **same audit stream** visible in standalone Agent Office for **transparency parity**.

### Support operations

- **Playbooks** may include **one-click propose** (e.g. open PR, patch proposal) — **apply** only after approval.

### AI-to-AI communication

- **Allowed:** AI system A submits **structured proposal** to **human-reviewed** inbox; AI system B may **comment** on proposal with **references** to snapshot seq — **no direct application**.
- **Disallowed:** Peer AIs **mutating** operational store or workspace without **human or policy-approved** automation record.

### Autonomous execution boundaries

| Class | Boundary |
|-------|----------|
| **Read / notify** | Allowed within policy. |
| **Propose** | Allowed; must be **signed** (actor + model version + inputs hash). |
| **Apply** | **Human approval** or **explicit automation policy** with **rate limits** and **rollback hooks**. |
| **Emergency** | **Human override** disables automation channel; **audit** records override. |

### Audit logging

- **WORM** or **append-only** store for approvals and applies; **tie-break** rules for conflicting proposals.

### Deployment topology

- **Split control plane** (policy, approvals) and **data plane** (snapshots, workspace integration).

### Scaling risks

- **Approval backlog** — UX and **delegation** rules; **risk** of “click-through” — **mitigate** with **risk-based** friction.

### Governance boundaries

- **RACI** for who may approve **P0 / risk H** changes.
- **Model governance:** allowed models, **prompt/weight** registry for proposals.

---

## Stage 4 — Managed autonomy (optional, high governance)

**Intent:** **Limited**, **policy-bound** automation for **low-risk**, **reversible** operations — **never** silent.

### Realtime / streams

- **Automation heartbeat** events; **global kill switch** event type.

### Parser scheduling

- **Self-triggered** parses only inside **approved windows** and **budgets**.

### Multi-user support

- **Automation as a “virtual operator”** with **named identity** in ownership and audit.

### Auth strategy

- **Automation credentials** are **short-lived**; **rotation** and **attestation** (where applicable).

### Admin dashboard embedding

- **Unified** view of **human + automation** actions with **equal** audit detail.

### Support operations

- **Runbook automation** with **dry-run** snapshot diff **before** apply.

### AI-to-AI communication

- **Structured message bus** between agents **only** through **policy gateway** that **logs, rate-limits, and content-filters**; **human-readable** mirror of traffic for **ops transparency** (redacted as needed).

### Autonomous execution boundaries

- **Tiered risk matrix:** only **low risk + reversible + monitored** actions eligible for full autonomy; **everything else** remains Stage 3.
- **Periodic** human **review** of automation effectiveness and **incident rate**.

### Audit logging

- **End-to-end trace:** proposal → policy evaluation → execution → post-parse verification.

### Deployment topology

- **Isolated** execution environment for automation (**blast radius** containment).

### Scaling risks

- **Emergent feedback loops** (automation triggers parse triggers automation) — **circuit breakers** and **max chain depth**.

### Governance boundaries

- **External regulator / customer** audit packs: **export** of seq-aligned **event + snapshot** history.

---

## Cross-cutting: deployment topology (summary)

| Stage | Typical shape |
|-------|----------------|
| 0–1 | Static UI + snapshot store + optional **fan-out** service |
| 2 | + IdP, tenant isolation, **regional** data plane |
| 3 | + Approval/control plane, **append-only** audit |
| 4 | + **Isolated** execution for automation, **kill switch** |

---

## Cross-cutting: scaling risks (summary)

| Risk | Mitigation theme |
|------|------------------|
| Large snapshots | Sharding, incremental adapter views, **seq**-consistent partial refresh |
| Parse storms | Coalescing, quotas, **priority lanes** (e.g. incident-first) |
| Stream fan-out | Stateless edges, **partitioned** topics |
| AuthZ complexity | Projection profiles, **avoid** ad-hoc field logic in UI |
| Automation drift | **Post-apply verification**, **canaries**, **rollback** |

---

## Cross-cutting: governance boundaries (summary)

- **Transparency default:** If it affects operations, it is **observable** in **event or snapshot lineage** (subject to redaction policy).
- **Audit default:** **Append-only** operational decisions; **no silent** state.
- **Human default:** **Override** and **reject** paths are **always** available for **in-scope** actions; **kill switch** for automation at Stage 4.

---

## Document control

- **Owner:** architecture / platform (TBD).
- **Review:** security, support leadership, product — before **Stage 2+** funding.
- **Revision:** bump when **stage boundaries** or **non-negotiable principles** change.
