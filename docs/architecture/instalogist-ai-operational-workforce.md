# Instalogist — AI operational workforce (architecture)

**Status:** architecture and contracts — **not** a commitment to ship every capability in one release.  
**Scope:** Move Instalogist from **visualization-only** to **AI-assisted, human-supervised** operational coordination while staying **safe-by-default**.

**Related:** [instalogist-agent-protocol.md](./instalogist-agent-protocol.md) (roles & handoffs), [instalogist-agent-office-roadmap.md](./instalogist-agent-office-roadmap.md) (staged platform), [risk-register.md](./risk-register.md) (protected domains).

---

## 1. Positioning

| Mode | Authority | AI role |
|------|-----------|---------|
| **Today (baseline)** | `operational-state.json` + workspace markdown | None required; UI projects truth |
| **Target (this doc)** | Same filesystem + explicit **proposals** | Read context, reason, emit **structured suggestions**; humans approve or reject |

**Non-negotiables**

- **Human-supervised:** No production change from AI without a **named approval** path (see §5).
- **Safe-by-default:** Deny by policy unless an action class is explicitly allow-listed for automation (default: **none** for production).
- **Structured outputs only** for machine consumption: YAML / Markdown artifacts / versioned JSON events — **no** raw shell, no “run this for me” as the only output.

---

## 2. Initial agent roster

Aligned with the coordination protocol:

| Agent ID | Workforce function | AI-assist focus |
|----------|-------------------|-----------------|
| **Dev-01** | Implementation, integrations, debugging | Task triage, patch proposals, blast radius for code paths |
| **Ops-01** | Deploy readiness, runtime, rollback | Deploy-risk signals, runbook suggestions, health correlation |
| **Audit-01** | Exposure, parity, incident prevention | Auth/payment anomaly hints, drift vs register |
| **Growth-01** | Funnels, activation, experiments | Funnel regression summaries, experiment proposals (non-binding) |
| **Support-01** | User-visible symptoms, classification | Escalation *suggestions* to Dev/Audit/Ops with customer-safe wording |

Agents do not “own” production; **humans** own approvals. Agent IDs in workspace YAML remain **attribution and routing**, not autonomous actors.

---

## 3. Capability: task reasoning

Each agent (when invoked in a governed runner) **may**:

| Ability | Input | Output (structured) |
|---------|--------|---------------------|
| Read tasks | Workspace task/incident/growth markdown + parser snapshot | Internal context bundle (quotes + paths only; no secrets) |
| Infer priority | `priority`, `risk_class`, domains, tags | **Suggestion** YAML block: `suggested_priority`, `confidence`, `evidence[]` |
| Stale detection | `derived.stale`, `derived.blocked_stale`, `updated_at` | Event: `stale_signal` with `severity`, `recommended_next_step` (text only) |
| Escalation suggest | Protocol routing table + current fields | Event: `escalation_suggestion` with `to_agents[]`, `reason_code`, **no** auto-write to task file |

**Hard rule:** Reasoning outputs are **append-only proposals** (new files under a controlled path, e.g. `workspace/meta/suggestions/…` or CI artifacts), or **ephemeral** UI payloads — not silent edits to `active/tasks/*.md`.

---

## 4. Capability: operational suggestions (examples)

All framed as **signals + structured hypothesis**, not verdicts:

| Pattern | Example signal | Suggested structure |
|---------|----------------|---------------------|
| Deployment risk | Route/build/env mismatch, recent deploy + error budget | YAML: `signal: deployment_risk`, `indicators[]`, `suggested_owner: Ops-01` |
| Auth anomaly | Spike in auth errors, callback mismatch tag | YAML: `signal: auth_anomaly`, `correlation: low|med|high`, `consult: Audit-01, Dev-01` |
| Billing mismatch | Webhook lag, plan drift tags | YAML: `signal: billing_mismatch_probability`, `evidence[]`, **gate: human_approval_required** |
| Growth regression | Funnel step drop vs baseline | Markdown summary + YAML metrics refs |

**Probability language:** Use calibrated wording (`low|medium|high` uncertainty) and cite **which fields** in operational state support the claim.

---

## 5. Structured outputs only (contracts)

**Allowed surface forms**

1. **Markdown** — human-readable narratives, timelines, runbook drafts.
2. **YAML** — machine-parseable suggestions, escalation drafts, checklists.
3. **Structured events** — JSON lines or envelope compatible with `instalogist-operational-state-1` *extensions* (bump contract version if persisted).

**Forbidden as *sole* or *authoritative* output**

- Arbitrary shell one-liners intended for execution.
- Direct API calls / deploy commands **generated without** a human-approved execution record.

**Runner boundary:** A “governed runner” may only **write** files that pass schema validation and path allow-lists; it never spawns shell on behalf of the model.

---

## 6. Human approval gates (mandatory)

The following **always** require an explicit human decision record (ticket, PR approval, admin UI checkbox, or signed commit — product choice) before any executing system acts:

| Domain | Gate |
|--------|------|
| **Payments** | No charge, refund, plan mutation, or webhook replay from automation |
| **Auth** | No session policy, OAuth callback URL, or credential rotation |
| **Deploy** | No promote to production, no infra apply |
| **Migrations** | No DDL/DML against production data from AI output |
| **Destructive** | No bulk delete, no secret rotation, no DNS cutover |

**AI may:** propose diffs, checklists, incident text, escalation YAML.  
**AI may not:** mark a gate as “approved” without a **human principal** in the audit record.

---

## 7. Agent memory (read-only operational context)

**Memory** = **retrieved context**, not a writable brain:

| Source | Access | Notes |
|--------|--------|------|
| **Workspace** | Read markdown + indices | Respects `.gitignore` / meta policy; no write-back from default runner |
| **Incidents** | Read via parser snapshot | Same contract as Command Center |
| **Decisions** | Read `docs/`, recorded ADRs | Optional chunking for RAG |
| **Risk register** | Read-only | Audit-01 consult mandatory for auth/payment suggestions |

**No secret store:** Memory loaders must **not** mount production env files, connection strings, or API keys into the model context. Use **redacted** operational state only.

---

## 8. Escalation automation (suggestion routing)

Automation here means **deterministic routing of suggestions**, not ticket creation in production without humans.

**Patterns (examples)**

| Trigger (from structured event or parser) | Suggested route | Artifacts |
|---------------------------------------------|-----------------|-----------|
| `payment_failure` | Audit-01 + Dev-01 | `escalation_suggestion` YAML + timeline entry |
| `deploy_failure` | Ops-01 + Audit-01 | Ops runbook draft + parity checklist |
| `auth_session` (existing tag) | Dev-01 + Audit-01 | Customer-safe Support summary stub |

Implementation sketch: rules engine (versioned JSON or code) maps `reason_code` → `notify_agents[]`; **humans** confirm before any external notification or workspace update.

---

## 9. Timeline generation (AI summary)

For Command Center / incident views, generated summaries **must** include:

| Field | Content |
|-------|---------|
| **what_happened** | Factual bullets tied to `source_path` / incident id |
| **who_owns** | `owner_agent` + human_owner if present |
| **next_action** | Suggested step; labeled **proposal** |
| **blast_radius** | From task fields or explicit “unknown” |

Emit as **Markdown section** or **timeline event** JSON with `agent_office_ui_contract` compatibility where applicable.

---

## 10. Safety envelope (explicit prohibitions)

| Prohibited | Rationale |
|------------|-------------|
| Shell execution from model output | Irreversible; bypasses review |
| Deploy execution | Gate §6 |
| Database writes | Gate §6 |
| Secret access / exfil | Policy |
| Autonomous production changes | Human sovereignty |

Violations are **runner misconfiguration**; CI and local runners should enforce capability drops (filesystem RO, no network, or allow-listed read endpoints only).

---

## 11. Output surfaces

| Surface | Content |
|---------|---------|
| **Command Center** | Snapshot + suggestion badges + parser health |
| **Incident timeline** | Structured events + AI summary (clearly labeled) |
| **Ownership board** | Load + proposed rebalancing (display only until approved) |
| **Operational feed** | Append-only feed of `structured events` (filterable by agent, severity) |

All surfaces remain **read-only** until a **separate, gated** write path (out of scope for default Instalogist visualization) applies human-approved changes to workspace.

---

## 12. Phased adoption (recommended)

1. **Phase A — Structured suggestions only:** New artifacts under `meta/suggestions/` or CI output; no auto-merge to tasks.
2. **Phase B — Inbox UI:** Humans accept/reject suggestions; export patch or edited YAML for manual apply.
3. **Phase C — Integrated gates:** Tie to CutUp admin / PR checks; still no autonomous deploy (see roadmap Stage 3–4).

---

## 13. Success criteria

- Operators see **real coordination** (routing, reasoning, timelines) **without** blurring **who decided**.
- Every AI-visible output is **replayable** from stored structured artifacts.
- **Escalation** and **payment/auth/deploy** paths remain **human-controlled** under explicit gates.

---

## Document control

- **Owns:** Instalogist architecture + security review for gate wording.
- **Bumps:** When suggestion schema version, gate list, or agent roster changes.
