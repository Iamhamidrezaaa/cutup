---
# Instalogist Task v1
task_id: CUTUP-2026-00004
title: "Measure activation: install → first successful summarize within 24h"
created_at: 2026-05-10T09:00:00Z
updated_at: 2026-05-10T09:00:00Z
owner_agent: Growth-01
collaborators: [Dev-01]
human_owner: ""
priority: P3
risk_class: L
domains: [analytics, onboarding, extension]
status: triaged
escalation: {}
links:
  protocol: docs/architecture/instalogist-agent-protocol.md
tags: [simulation, funnel, activation, analytics, mvp]
blast_radius_summary: "Event definitions and dashboards only until Dev-01 approves any new PII-bearing fields"
---

## Context (simulation)

Many installs from landing; support notes "opened once" tickets. Need a **single north-star** metric and baseline.

## Definition (draft)

- **Activated** = at least one successful summarize (or transcribe+summary) within 24h of first extension open.

## Constraints

- No new collection that increases operational or legal surface without Dev-01 + Audit-01 review if PII/geo.

## Deliverables

- One-paragraph metric spec for engineering.
- Suggested support macro: gentle nudge for first-run success (no internal URLs).

## Next step

- Dev-01: confirm existing analytics events sufficient or minimal additive event names.
