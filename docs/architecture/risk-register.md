# Risk register — CutUp

Systems where mistakes cause **money loss**, **account takeover**, **data corruption**, or **wide outage**.  
**Policy:** No behavioral change to these flows without explicit human confirmation (see `.cursor/rules/instalogist-engineering.md`).

## Classification

| Class | Meaning |
|-------|---------|
| **C** (Critical) | Direct financial or auth compromise; incorrect behavior visible to many users. |
| **H** (High) | Wrong data for billing/subscription; admin abuse; partial outage of core product. |
| **M** (Medium) | Degraded analytics, wrong quotas, support burden; usually reversible. |

## Register

| ID | Area | Key code / routes | Class | Failure modes | Change rule | Owner |
|----|------|-------------------|-------|---------------|-------------|-------|
| R1 | Stripe webhook | `api/stripe-webhook.js`, `POST /api/stripe/webhook` (raw body on Express) | C | Missed payments, duplicate charges, state desync | Explicit approval; test in staging; never alter signature verification casually | TBD |
| R2 | Stripe checkout / customer | `api/stripe-checkout.js`, `POST /api/stripe/create-checkout-session` | C | Users charged wrong plan; broken checkout | Same as R1 | TBD |
| R3 | Payment provider (incl. callback) | `api/payment-*.js`, `yekpay.js`, GET/POST `/api/payment/callback` | C | Double post, forged callback, wrong invoice | Same as R1 | TBD |
| R4 | Subscription & usage | `api/subscription.js`, `processing-enforcement.js`, billing repos | H | Wrong limits, locked-out paying users, usage drift | Explicit approval if billing rules change | TBD |
| R5 | User auth & session | `api/auth.js`, `oauth-google-start.js`, `/api/auth`, `/api/auth/callback` | C | Session fixation, open redirects, account linking bugs | Explicit approval | TBD |
| R6 | Admin auth & password reset | `admin-login.js`, `admin-*-password.js`, `admin-auth-me.js` | C | Admin takeover | Explicit approval | TBD |
| R7 | Admin user management | `admin-users-manage.js`, `PATCH/DELETE /api/admin/users/:id` | H | Data loss, wrong user deleted | Explicit approval for destructive ops | TBD |
| R8 | Offers / pricing integrity | `offers.js`, `admin-offers.js`, repos | H | Wrong discounts, fraud | Coordinate with product; approval for prod rule changes | TBD |
| R9 | Database migrations | `api/db/migrate.mjs`, `schema.sql` | H | Broken deploys, partial schema | Run in controlled window; backup; review SQL | TBD |
| R10 | Cron / conversion emails | `cron-conversion-emails.js`, scheduled hits | M | Spam, missed emails, token exposure in URL | Approval if template or auth to cron changes | TBD |

## Public / semi-public surface (review when hardening)

Not necessarily “risk rows” but **high attention** for authn/z and rate limits:

- `/api/payment/callback`, `/api/health`, `/api/system-health`, `/api/analytics`, `/api/leads`, `/api/contact`, `/api/cron/conversion-emails`, growth/retention endpoints.

## Runbooks

Link procedures here when they exist under `docs/architecture/runbooks/`. Until then: **post-incident notes in git history and owner chat.**

## When to edit this file

- New payment method, webhook, or identity provider.
- New admin capability affecting users or money.
- After an incident: add row or bump class if needed.
