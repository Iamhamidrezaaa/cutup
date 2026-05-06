---
# Instalogist Task v1
task_id: CUTUP-2026-00001
title: "Summarize fails for long audio — extension shows generic error"
created_at: 2026-05-10T08:00:00Z
updated_at: 2026-05-10T08:00:00Z
owner_agent: Dev-01
collaborators: [Audit-01]
human_owner: ""
priority: P2
risk_class: M
domains: [extension, api, core-processing]
status: analyzing
escalation:
  from_agent: Support-01
  reason: customer_impact
  escalated_at: 2026-05-10T07:45:00Z
links:
  protocol: docs/architecture/instalogist-agent-protocol.md
  risk_register: docs/architecture/risk-register.md
tags: [simulation, summarize, extension, timeout, support-path]
blast_radius_summary: "Processing path only; no payment or auth tables"
---

## Context (simulation)

Support reports ~5 users this week: after upload, spinner stops with a vague error. Affected files ~45–90 min audio. Shorter files work.

## User-visible repro (sanitized)

1. Load extension → paste or attach long meeting audio.
2. Start summarize → wait → error (no clear code).

## Hypotheses (for investigation)

- Request timeout client vs server; or body size limit mismatch between hosts.
- API host might be Vercel subset vs full Express — confirm which URL extension uses.

## Next steps

- Confirm `API_BASE_URL` / host in extension vs docs.
- Reproduce with controlled file length; capture HTTP status (not shared with customer verbatim in support reply).

## Customer-safe status line

"We're investigating failures on longer files and will update when we have a fix."
