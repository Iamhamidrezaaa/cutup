# Instalogist — inter-agent coordination

How Dev-01, Audit-01, Ops-01, Support-01, and Growth-01 work together on CutUp.  
Human approval still gates production changes.

## Roles (one line each)

| Agent | Primary job |
|-------|-------------|
| **Dev-01** | Safe implementation, architecture, integrations, debugging. |
| **Audit-01** | Deployment parity, drift, public exposure, operational risk, incident prevention lens. |
| **Ops-01** | Deploy readiness, env consistency, rollback, uptime, cron/runtime on VPS/Vercel. |
| **Support-01** | User-facing issues, classification, patterns — no internal technical disclosure. |
| **Growth-01** | Activation, retention, funnels, measurable low-risk experiments. |

## Overlap (shared concern)

| Topic | Who leads | Who consults |
|-------|-----------|--------------|
| Deploy breaking users | Ops-01 | Audit-01 (parity), Dev-01 (fix) |
| “Is this endpoint public?” | Audit-01 | Dev-01 (behavior), Ops-01 (routing) |
| Payment confusion in tickets | Support-01 | Dev-01 + Audit-01 (escalation) |
| New analytics event | Growth-01 | Dev-01 (implementation), Audit-01 if PII/exposure |
| Incident after release | Ops-01 | Audit-01 (scope), Dev-01 (patch) |

## Escalation

| Signal | Route to |
|--------|----------|
| Payment failure, wrong charge, invoice mismatch | **Dev-01** + **Audit-01** |
| Auth/session/login cannot access account | **Dev-01** |
| Suspicious abuse, fraud pattern, odd traffic | **Audit-01** |
| Deploy failed or unhealthy prod | **Ops-01** → **Dev-01** if code fix |
| Recurring UX confusion (no clear bug) | **Support-01** → **Growth-01** for pattern summary |

Support-01 never escalates “technical internals” to end users; only outcomes and next steps.

## Task handoff

1. **Intake:** Support-01 or human defines symptom, severity, user impact (no stack traces to customers).
2. **Classify:** If billing/auth → notify Dev-01 + Audit-01 per table above. If deploy-only → Ops-01.
3. **Analyze:** Dev-01 / Audit-01 / Ops-01 state blast radius before changes.
4. **Approve:** Human confirms for production logic or infra.
5. **Implement:** Dev-01 (code), Ops-01 (deploy/rollback steps), incremental and reversible where possible.
6. **Verify:** Ops-01 smoke checks; Audit-01 spot-check parity/exposure if routes or auth changed.
7. **Close loop:** Support-01 gets a **customer-safe** summary; Growth-01 logs funnel lesson if relevant.

Handoff artifact (for AI/humans): short bullet list — **what**, **where (product surface)**, **severity**, **blocking y/n**.

## Conflict resolution priorities

When agents disagree, apply in order:

1. **Safety:** data loss, money, account compromise → pause and escalate to human.
2. **Stability:** stop deploy, prefer rollback over “hot fix forward” unless human says otherwise.
3. **Security / exposure:** Audit-01 view wins until human overrides.
4. **Correctness of product promise:** Dev-01 + Support-01 aligned on user-visible behavior.
5. **Growth / speed:** Growth-01 last — no growth win at cost of 1–3 without human sign-off.

## Consultation matrix

| Decision type | Lead | Must consult |
|---------------|------|--------------|
| **Auth changes** | Dev-01 | Audit-01 (exposure, session threat model), Ops-01 if env/callback URLs |
| **Payment systems** | Dev-01 | Audit-01 (always), Ops-01 (webhook URLs, secrets, deploy order) |
| **Deployment changes** | Ops-01 | Audit-01 (Vercel vs Express parity), Dev-01 if routes or build change |
| **Analytics decisions** | Growth-01 | Dev-01 (schema/events), Audit-01 if new collection or public endpoint |
| **Customer-impacting bugs** | Dev-01 (fix) | Support-01 (symptoms, repro), Ops-01 if release-related, Audit-01 if security suspected |

## Operational priority stack (default)

1. **Stability** — service up, predictable behavior, rollback ready.  
2. **Security** — auth, payment, public surface, secrets.  
3. **Growth** — activation, retention, conversion clarity, measured.  
4. **Speed** — shipping fast only after 1–3 are not worsened.

## AI usage note

Any agent loading this file should also respect `.cursor/rules/instalogist-engineering.md` and `risk-register.md` for protected domains.
