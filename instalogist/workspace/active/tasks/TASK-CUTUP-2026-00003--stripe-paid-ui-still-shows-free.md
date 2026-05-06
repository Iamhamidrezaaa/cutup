---
# Instalogist Task v1
task_id: CUTUP-2026-00003
title: "Customer paid — subscription UI still shows Free plan"
created_at: 2026-05-10T11:00:00Z
updated_at: 2026-05-10T11:00:00Z
owner_agent: Dev-01
collaborators: [Audit-01]
human_owner: "billing-owner@example.com"
priority: P0
risk_class: C
domains: [payments, subscriptions]
status: blocked
escalation:
  from_agent: Support-01
  reason: payment_failure
  escalated_at: 2026-05-10T10:50:00Z
links:
  protocol: docs/architecture/instalogist-agent-protocol.md
  risk_register: docs/architecture/risk-register.md
tags: [simulation, stripe, subscription, webhook, mismatch]
blast_radius_summary: "Billing + webhook + DB subscription row; no code deploy without human approval"
---

## Context (simulation)

User completed Stripe checkout ~40 minutes ago; receipt email from Stripe OK. In-app / extension still shows Free and usage caps.

## Support intake (no internal IDs to customer)

- Plan expected: Pro monthly.
- No charge dispute — payment side looks successful from user POV.

## Blocked reason

- **Human approval** required before changing webhook handlers, subscription sync, or manual DB correction.
- Audit-01: verify which deploy receives webhooks (VPS vs Vercel) vs parity doc.

## Safe customer communication

"We see your payment and are syncing your account — we'll confirm shortly."

## Investigation outline (for approved agents only)

- Webhook delivery logs (provider); subscription row for user email; clock skew / idempotency.
