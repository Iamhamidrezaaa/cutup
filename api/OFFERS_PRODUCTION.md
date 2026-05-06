# Offers system — production database and diagnostics

Restarting the Node process (e.g. PM2 restart) **does not** apply SQL from `schema.sql`. Offers tables are created or repaired in two ways:

## 1. Full schema migration (recommended after pulling `schema.sql` changes)

From the project root, with `DATABASE_URL` set:

```bash
node api/db/migrate.mjs
```

This executes `api/db/schema.sql` against the database configured in `DATABASE_URL`.

## 2. Runtime bootstrap (automatic on API server startup)

When the Express app loads routes, it calls `ensureOffersSchema()` in `api/offers-bootstrap.js`. That path:

- Creates `offers`, `user_offers`, and `offer_redemptions` if missing
- Adds `source_plan`, `target_plan`, `campaign_type`, etc. on `offers` when missing

**Limitation:** If production runs as short-lived serverless functions, bootstrap runs per cold start; the database must still be reachable and `DATABASE_URL` must be set in that environment.

## Verify schema without reading server logs

Call:

```http
GET /api/system-health
```

Inspect JSON field `checks.offersSchemaIntrospection`:

- `tablesPresent` — `offers`, `user_offers`, `offer_redemptions`
- `columnsPresent` — `source_plan`, `target_plan`, `campaign_type`, `active`, `expires_at`
- `user_offers` uses `assigned_at` (there is no `created_at` on `user_offers` in the bootstrap DDL)

## Log tags to trace the funnel

| Tag | Where |
|-----|--------|
| `[offers-schema-check]` | After `ensureOffersSchema` path + explicit `logOffersSchemaCheck()` on server boot |
| `[offers-distribution][user_offers-snapshot]` | After admin assign / plan promotion job |
| `[user-plan-debug]` | Each `GET /api/offers` (subscription plan vs query plan) |
| `[offers-api]` | Each `GET /api/offers` (counts + per-offer `pipeline` reasons) |
| `[offers-resolver]` | Browser console from `website/offers-resolver.js` (and dashboard summary) |

## Manual SQL checks (production DB console)

```sql
SELECT COUNT(*) FROM user_offers;
SELECT user_id, offer_id, status, assigned_at
FROM user_offers
ORDER BY assigned_at DESC NULLS LAST
LIMIT 10;
```

For one campaign:

```sql
SELECT COUNT(*) FROM user_offers WHERE offer_id = '<uuid>';
```
