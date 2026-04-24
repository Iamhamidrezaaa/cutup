# Revenue & reliability checklist (Cutup)

## Stripe (production)

1. **Environment**
   - [ ] `STRIPE_SECRET_KEY` (live or test)
   - [ ] `STRIPE_WEBHOOK_SECRET` from Dashboard → Webhooks → signing secret
   - [ ] `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ADVANCED` (monthly subscription Price IDs: $9.99 / $19.99 / $39.99)
   - [ ] `FRONTEND_URL` exact origin used in production (e.g. `https://cutup.shop`) for `success_url` / `cancel_url`

2. **Checkout session**
   - [ ] `POST /api/stripe/create-checkout-session` returns `{ url }` when logged in
   - [ ] Server logs: `[stripe-checkout] Created session <id> for <email>`

3. **Webhook**
   - [ ] Endpoint: `POST /api/stripe/webhook` registered with **raw JSON** body (this repo registers `express.raw` before `express.json`)
   - [ ] Signature verification: invalid signature → 400, logged
   - [ ] **Idempotency**: same `event.id` processed once (in-memory list; use Redis/DB if multi-instance)
   - [ ] **Handled types**:
     - `checkout.session.completed` → `applyStripeCheckoutCompleted` (writes DB)
     - `invoice.paid` → `applyStripeSubscriptionRenewal`
     - `customer.subscription.deleted` → `downgradeStripeSubscription`
     - `invoice.paid` → refreshes end date / plan from subscription metadata (renewals)
     - `customer.subscription.deleted` → `downgradeStripeSubscription(email)` (free)
     - `invoice.payment_failed` → logged (no auto-downgrade)

4. **Activation**
   - [ ] After payment, user returns to `dashboard.html?session=...&payment=success`
   - [ ] Webhook must run **before or soon after** return (user sees auto-refresh every 5s)
   - [ ] If plan still “Free”, check webhook delivery in Stripe Dashboard and server logs

5. **Cancellations**
   - [ ] `cancel_url` lands with `payment=cancel`; user sees non-destructive message and `payment_cancelled` analytics event

---

## Analytics events (website)

| Event | Where it fires |
|--------|----------------|
| `link_submitted` | After valid action start: URL modes (`summary` / `fulltext` / `subtitles`) and file modes (`file` + mode) in `script.js` |
| `transcript_generated` | After `displayResults` for file + URL summary/fulltext flows (`script.js`); props: `mode`, `source` (`url` \| `file`), `preview`, `auth` |
| `subtitle_preview_shown` | When `displayResults` runs with `previewMode` and `activeTab === 'srt'` (`script.js`) |
| `upgrade_clicked` | Preview banner (`source: preview_banner`), Stripe buttons (`source: stripe_subscribe_button`, `dashboard.js`) |
| `payment_success` | Dashboard return URL `payment=success` (`dashboard.js` → `trackConversionEvent`) |
| `payment_cancelled` | Dashboard return `payment=cancel` |

**Transport:** `trackEvent` / `trackConversionEvent` send to **both** PostHog (if loaded) and `gtag` (if defined), not either/or.

---

## Known limitations (first revenue)

- Subscription and usage are **in-memory** on the Node process: restarts lose state; horizontal scaling needs a shared store.
- Legacy IRR “cart” checkout does not integrate with Stripe; only Stripe paths activate `pro` / `advanced` via webhook.
