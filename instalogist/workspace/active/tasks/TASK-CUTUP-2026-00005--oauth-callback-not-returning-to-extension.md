---
# Instalogist Task v1
task_id: CUTUP-2026-00005
title: "Google sign-in: browser completes but extension never receives session"
created_at: 2026-05-10T12:00:00Z
updated_at: 2026-05-10T12:00:00Z
owner_agent: Dev-01
collaborators: [Audit-01]
human_owner: ""
priority: P1
risk_class: C
domains: [auth, extension]
status: analyzing
escalation:
  from_agent: Support-01
  reason: auth_session
  escalated_at: 2026-05-10T11:40:00Z
links:
  protocol: docs/architecture/instalogist-agent-protocol.md
  risk_register: docs/architecture/risk-register.md
tags: [simulation, oauth, extension, support-escalation, session]
blast_radius_summary: "Auth and callback URLs; manifest host permissions; no payment code"
---

## Context (simulation)

**Support-01** escalated: 3 users, Chrome stable, cleared cache. After "Sign in with Google", tab shows success page but extension still prompts login. Not widespread.

## User-safe triage done

- Asked users to update extension to latest build from official instructions.
- Confirmed not asking for passwords in chat.

## Engineering angles (internal)

- Redirect URI / API host mismatch (Vercel vs VPS) vs extension `host_permissions`.
- Callback path registered only on one deployment.

## Audit-01 focus

- Public OAuth surface; any open redirect pattern if callback params change.

## Customer-safe line

"We're looking into a sign-in issue with a small number of accounts and will follow up."

---

**Type:** Operational simulation — for Instalogist workflow drill; not necessarily live incidents.
