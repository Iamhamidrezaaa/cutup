# API overview — CutUp

Single place for **what the backend does by domain** and **where it runs**. Paths are illustrative; source of truth is `server.js` and `vercel.json`.

## Deployment surfaces

| Surface | Role |
|---------|------|
| **Express (`server.js`)** | Full API when self-hosted (e.g. PM2). All routes registered here. |
| **Vercel (`vercel.json`)** | Subset of routes mapped to `api/*.js` serverless handlers. Unlisted `/api/*` tends to fall through to site 404. |

**Implication:** Clients must target the correct host for transcribe, summarize, auth, subscription, Stripe, YouTube helpers, and most admin audit routes if those are not added to Vercel.

## Domains

| Domain | Responsibility | Key paths under `api/` | Typical deps | Vercel (partial) | Owner |
|--------|----------------|------------------------|--------------|------------------|-------|
| **Auth** | User OAuth/session flows | `auth.js`, `oauth-google-start.js` | Google auth lib, DB | Mostly Express-only | TBD |
| **Subscriptions** | Plans, usage, limits | `subscription.js`, `plans-config.js`, `processing-enforcement.js`, `*-repository.js` | PostgreSQL, Stripe concepts | Mostly Express-only | TBD |
| **Payments** | Checkout, verify, callbacks, invoices | `stripe-*.js`, `payment-*.js`, `yekpay.js`, `invoices.js`, `invoice-by-id.js` | Stripe, mail, DB | Many payment routes on Vercel; webhook/checkout may be Express-only — verify `vercel.json` | TBD |
| **YouTube / media** | Title, download, formats, chunk flow | `youtube.js`, `youtube-*.js`, `chunk-processor.js`, `translate-srt.js` | OpenAI / external | Mostly Express-only | TBD |
| **Core processing** | Upload, transcribe, summarize, DOCX | `upload.js`, `transcribe.js`, `summarize.js`, `generate-docx.js` | OpenAI, storage limits | Upload/summarize/transcribe parity varies — check `vercel.json` | TBD |
| **Admin** | Panel, users, offers, audit | `admin*.js`, `admin-*-password.js`, `admins-repository.js`, `admin-audit.js`, … | DB, sessions | Subset on Vercel (login, users, offers, etc.); audit live/WebSocket server-side | TBD |
| **Analytics / growth** | Events, leads, retention, SEO tools | `analytics.js`, `audit-event.js`, `growth-*.js`, `retention.js`, `leads.js`, `contact.js`, `tools-content.js` | DB / stateless | Several on Vercel | TBD |
| **System** | Health, sitemap, cron | `system-health.js`, `sitemap.js`, `cron-conversion-emails.js` | DB optional | `system-health`, `sitemap`, cron path on Vercel | TBD |

## Database

Billing and profiles: PostgreSQL via `api/db/` (`pool.js`, `schema.sql`, `migrate.mjs`). Domains **Subscriptions**, **Payments**, and parts of **Auth** / **Admin** depend on `DATABASE_URL`.

## Clients

- **Chrome extension:** `popup.js`, `background.js` — must align host permissions with API base URL.
- **Static site:** `website/` — often uses same API origin as configured in deploy.

## When to edit this file

- Add/remove a domain or major handler file.
- Change which stack (Vercel vs Express) owns a feature.
- Assign or change **Owner** for operational accountability.
