---
# Instalogist Task v1
task_id: CUTUP-2026-00002
title: "VPS returns 502 after PM2 restart — extension and site partial outage"
created_at: 2026-05-10T10:15:00Z
updated_at: 2026-05-10T10:30:00Z
owner_agent: Ops-01
collaborators: [Dev-01, Audit-01]
human_owner: ""
priority: P0
risk_class: H
domains: [deployment]
status: in_progress
escalation:
  from_agent: Ops-01
  reason: deploy_failure
  escalated_at: 2026-05-10T10:15:00Z
links:
  protocol: docs/architecture/instalogist-agent-protocol.md
  api_overview: docs/architecture/api-overview.md
tags: [simulation, pm2, vps, 502, rollback-candidate]
blast_radius_summary: "Full Express API on VPS; Vercel-hosted paths may still work for subset of users"
---

## Context (simulation)

Ops rotated env and restarted PM2. Health check flaky; `/api/health` intermittently 502. Marketing site on same host degrades.

## Timeline

- T+0: Restart after `.env` update (DATABASE_URL line ending suspected once).
- T+15m: Rollback discussion — snapshot or previous release tag?

## Immediate actions

- Verify process up, port bind, recent logs (no secret paste in tickets).
- If unstable: rollback plan per runbook; notify Support-01 with **user-safe** wording only.

## Post-stabilization

- Audit-01: confirm no accidental route/env drift vs `vercel.json` expectations.
