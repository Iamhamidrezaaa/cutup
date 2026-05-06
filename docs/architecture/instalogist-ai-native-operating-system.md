# Instalogist — AI-native operational operating system (vision architecture)

**Status:** north-star architecture — **sequenced adoption**, not a single big-bang rewrite.  
**Intent:** Position Instalogist as the **company operational core**: one graph, one memory model, one command surface — **gradually** absorbing responsibilities now spread across Jira, Notion, incident tools, ops dashboards, and parts of Slack workflows.

**Related:** [instalogist-ai-operational-workforce.md](./instalogist-ai-operational-workforce.md), [instalogist-agent-office-roadmap.md](./instalogist-agent-office-roadmap.md), [instalogist-agent-protocol.md](./instalogist-agent-protocol.md), [instalogist-parser-architecture.md](./instalogist-parser-architecture.md).

---

## Principles

| Principle | Meaning |
|-----------|---------|
| **AI-native, not AI-autonomous** | Models assist and coordinate; **humans and policy** retain authority for money, auth, deploy, and data. |
| **Graph-first** | Tasks, incidents, systems, and events are **nodes and edges** with typed relationships — not siloed tickets only. |
| **Immutable history** | Ingestion and decisions append to **durable, auditable** logs; corrections are new events, not silent edits. |
| **Progressive replacement** | Each external tool is **bridged** then **optionally retired** when parity and governance are proven. |

---

## 1. Unified operational graph

**Single logical graph** (physical storage may be multiple stores behind one API contract):

| Node families | Examples |
|---------------|----------|
| **Work** | tasks, incidents, growth initiatives, customer escalations |
| **Systems** | services, repos, environments, payment surfaces, auth flows |
| **People & agents** | owners, on-call, AI agent personas (advisory routing only by default) |
| **Events** | deploys, releases, billing webhooks, auth anomalies, analytics milestones |
| **Decisions** | human approvals, policy outcomes, post-incident actions |

**Edges (illustrative types):** `owns`, `blocks`, `caused_by`, `mitigates`, `deployed_in`, `affects_customer`, `escalated_to`, `approved_by`, `suggested_by_ai` (always labeled and auditable).

**Contract discipline:** Version graph projections for UI (e.g. `instalogist-operational-state-1` today); future **`instalogist-operational-graph-1`** or equivalent when multi-source ingestion is unified.

---

## 2. Multi-source ingestion

**Sources** (each with schema mapping, idempotency, and retention policy):

| Source | Typical signals | Notes |
|--------|-----------------|-------|
| **Markdown workspace** | Tasks, incidents, YAML front-matter | Current SOT; parser remains anchor |
| **GitHub** | PRs, releases, workflows, commit risk hints | Read APIs; map to `deploy` / `change` nodes |
| **Deployment events** | CI/CD, Vercel, VPS health | Correlate with incidents and tasks |
| **Stripe** | Charges, failures, disputes, subscription drift | **PII/minimization**; gate writes |
| **Auth logs** | Login failures, OAuth errors | Aggregate + threshold; no raw secret logging |
| **Analytics** | Funnels, errors, usage | Link to growth/customer health nodes |
| **Customer support** | Tickets, CSAT (if integrated) | Map to escalation edges; customer-safe text |

**Ingestion rules**

- Every external event → **normalized envelope**: `source`, `source_id`, `occurred_at`, `entity_refs[]`, `payload_hash`.
- **Degraded mode** when a source is stale or partial (same philosophy as parser `snapshot_status`).

---

## 3. Operational memory layer

**History-aware** context for humans and AI (retrieval + summaries, not a hidden mutable brain):

| Memory class | Use |
|--------------|-----|
| **Incident history** | Similar past incidents, MTTR patterns, recurring components |
| **Repeated failures** | Flaky deploys, repeated auth errors, billing retry patterns |
| **Deployment patterns** | Release cadence, rollback frequency, env drift |
| **Ownership history** | Who owned what, handoff chains, accountability timeline |

**Storage pattern:** Append-only **event log** + **materialized views** (graph slices, embeddings index optional). **Corrections** are new events (`supersedes`, `retracted`).

---

## 4. AI coordination layer

Builds on [instalogist-ai-operational-workforce.md](./instalogist-ai-operational-workforce.md):

| Capability | Output |
|------------|--------|
| **Handoffs** | Structured handoff objects (Markdown/YAML) with evidence links |
| **Escalation chains** | Suggested routes; humans confirm before side effects |
| **Conflict resolution** | Ranked options per agent-protocol priority stack |
| **Operational planning** | Sequenced checklists with explicit **gates** |

**Safety:** No unrestricted tool execution; proposals only unless an explicit, audited automation tier is enabled (see roadmap Stage 4).

---

## 5. Executive command center

**Views** (each is a **projection** of the graph + policies, not a separate truth):

| View | Audience | Typical KPIs / lenses |
|------|----------|------------------------|
| **Company health** | Leadership | Incidents open, customer impact, snapshot freshness |
| **Engineering risk** | Eng + Audit | Deploy stability, auth/payment exposure, debt signals |
| **Growth performance** | Growth + leadership | Funnel, activation, experiment readouts |
| **Deployment stability** | Ops + Eng | Error budgets, rollback rate, env parity |
| **Operational load** | Managers | Ownership concentration, stale work, queue depth |

**Drill-down:** Always traceable to **nodes, events, and sources** (auditability).

---

## 6. Predictive systems

**Language:** Predictions are **signals** with confidence and features — not guarantees.

| Signal type | Example inputs | Output |
|-------------|----------------|--------|
| **Outage likelihood** | Error rates, deploy density, past incidents | Risk score + explainable factors |
| **Deploy risk** | Diff size, blast radius tags, owner load | Pre-flight advisory |
| **Billing anomaly** | Stripe patterns vs baseline | Flag for human + Audit consult |
| **Churn / regression** | Analytics + support volume | Growth-facing summary |

**Governance:** Model cards, refresh cadence, and **human override** on any automated threshold that triggers paging or customer comms.

---

## 7. Cinematic operational UI (target experience)

**Direction:** Enterprise-grade, **motion-based**, **graph-driven**; pixel-art office optional legacy, not the end state.

**Suggested stack** (aligns with your proposal — **decision per phase**):

| Layer | Technology | Role |
|-------|------------|------|
| App shell | **Next.js** | Routing, SSR/ISR for dashboards, API routes for BFF |
| Styling | **Tailwind** | Design system, dark/light, density modes |
| Motion | **Framer Motion** | Transitions, emphasis, non-distracting feedback |
| Graph UI | **React Flow** | Operational graph exploration, swimlanes |
| 3D / overlay | **Three.js / WebGL** (optional) | Accent layers, not required for MVP parity |
| Real-time | **Optional** | SSE/WebSocket for invalidation (see roadmap Stage 1+) |

**Non-requirement:** Rebuilding everything in this stack before **graph + ingestion + governance** are sound — UI follows data contracts.

---

## 8. Governance

| Mechanism | Requirement |
|-----------|-------------|
| **Audit trails** | Who/what/when for every state change and AI suggestion |
| **Immutable logs** | Append-only ingestion + decision log; legal hold hooks if needed |
| **Approval workflows** | Payments, auth, deploy, migrations, destructive ops |
| **Operational policies** | RBAC, data classification, retention, region |
| **AI safety boundaries** | Allow-listed outputs, no secret context, kill switch for automation tier |

Maps to roadmap **Stage 2–4** for multi-tenant policy and gated automation.

---

## 9. Non-goals (explicit)

- **Fully autonomous company** — humans remain accountable.
- **Unrestricted AI execution** — no shell/deploy/DB from model output by default.
- **Uncontrolled deploy authority** — promotions require human or policy-bound automation with circuit breakers.

---

## Migration strategy (replacing scattered tools)

| Phase | Focus | External tools |
|-------|--------|----------------|
| **P0** | Markdown SOT + parser + Command Center parity | Notion/Jira: **read mirrors** or export only |
| **P1** | Ingestion bridges (GitHub, Stripe, deploy) | Single pane **plus** legacy |
| **P2** | Graph API + executive views | Reduce duplicate dashboards |
| **P3** | Memory + predictions (advisory) | Slack workflows **partially** replaced by ops feed |
| **P4** | Cinematic UI + optional realtime | Retire tools where **governance** and **export** are satisfied |

---

## Success definition

Instalogist is the **operating system** when:

1. **One graph** explains how work, systems, and customers connect.  
2. **One audit story** exists for incidents and critical changes.  
3. **AI coordination** speeds triage without **removing** human gates.  
4. Leadership can answer **health, risk, growth, stability, load** from one command center.

---

## Document control

- **Owns:** Architecture / product / security (joint).  
- **Revision:** On graph contract bumps, ingestion scope changes, or UI north-star shifts.
