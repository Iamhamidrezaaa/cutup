-- Cutup billing / subscription persistence (PostgreSQL)
-- Run: node api/db/migrate.mjs   (requires DATABASE_URL)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(64),
  country VARCHAR(2),
  address TEXT,
  postal_code VARCHAR(32),
  avatar_url TEXT,
  avatar_mime VARCHAR(32),
  avatar_bytes BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON user_profiles (country);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan VARCHAR(32) NOT NULL DEFAULT 'free',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  billing_period VARCHAR(32) NOT NULL DEFAULT 'monthly',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subscriptions_one_per_user UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minutes_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  daily_minutes_used DOUBLE PRECISION NOT NULL DEFAULT 0,
  daily_period_date DATE NOT NULL DEFAULT ((NOW() AT TIME ZONE 'UTC')::date),
  audio_downloads INTEGER NOT NULL DEFAULT 0,
  video_downloads INTEGER NOT NULL DEFAULT 0,
  usage_month_key VARCHAR(7) NOT NULL DEFAULT (to_char((NOW() AT TIME ZONE 'UTC'), 'YYYY-MM')),
  billing_cycle_start TIMESTAMPTZ,
  CONSTRAINT usage_one_per_user UNIQUE (user_id)
);

ALTER TABLE usage ADD COLUMN IF NOT EXISTS billing_cycle_start TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id VARCHAR(255) PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_history_user_created ON usage_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_feed (
  id BIGSERIAL PRIMARY KEY,
  user_email VARCHAR(320) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_email_created
  ON activity_feed (lower(user_email), created_at DESC);

CREATE TABLE IF NOT EXISTS saved_outputs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  title TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  platform VARCHAR(32),
  source_url TEXT,
  language VARCHAR(32),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_outputs_user_created
  ON saved_outputs(user_id, created_at DESC);

ALTER TABLE saved_outputs
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_user_favorite_created
  ON saved_outputs(user_id, is_favorite DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_output_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_output_collections_user
  ON saved_output_collections(user_id, lower(name));

ALTER TABLE saved_outputs ADD COLUMN IF NOT EXISTS collection_id UUID;
ALTER TABLE saved_outputs ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_collection
  ON saved_outputs(collection_id) WHERE collection_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_outputs_user_downloads
  ON saved_outputs(user_id, download_count DESC);

ALTER TABLE project_exports ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS blog_posts (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  cover_image_url TEXT,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  category TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  og_title TEXT,
  og_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published'))
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published_at
  ON blog_posts(status, published_at DESC);

-- Idempotent: safe if column already exists on older DBs.
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- Retention (hybrid: server copy; guests keyed by guest_key until merge on login)
CREATE TABLE IF NOT EXISTS retention_recent_activity (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_key VARCHAR(64),
  url TEXT NOT NULL,
  title TEXT,
  platform VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_recent_owner CHECK (
    (user_id IS NOT NULL AND guest_key IS NULL)
    OR (user_id IS NULL AND guest_key IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_retention_recent_user_created
  ON retention_recent_activity (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retention_recent_guest_created
  ON retention_recent_activity (guest_key, created_at DESC)
  WHERE guest_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS retention_usage_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  guest_key VARCHAR(64),
  count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT retention_usage_owner CHECK (
    (user_id IS NOT NULL AND guest_key IS NULL)
    OR (user_id IS NULL AND guest_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS retention_usage_stats_user_uidx
  ON retention_usage_stats (user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS retention_usage_stats_guest_uidx
  ON retention_usage_stats (guest_key)
  WHERE guest_key IS NOT NULL;

-- Provider-agnostic payment attempts (Stripe, manual, future gateways)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  plan_key VARCHAR(32),
  discount_code VARCHAR(32),
  amount NUMERIC(14, 4),
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  external_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_status_check CHECK (
    status IN ('pending', 'success', 'failed', 'canceled')
  )
);

CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_provider_external
  ON payments (provider, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_key VARCHAR(32);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_code VARCHAR(32);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_eur NUMERIC(14, 4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_irr NUMERIC(20, 2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS authority VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ref_id VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway VARCHAR(64) NOT NULL DEFAULT 'yekpay';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(64) NOT NULL DEFAULT 'yekpay';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan VARCHAR(32);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order_id_unique
  ON payments (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

UPDATE payments
SET amount_eur = COALESCE(amount_eur, amount),
    gateway = COALESCE(NULLIF(gateway, ''), provider, 'yekpay'),
    authority = COALESCE(authority, external_id),
    plan = COALESCE(plan, plan_key)
WHERE amount_eur IS NULL OR gateway IS NULL OR authority IS NULL OR plan IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_authority ON payments (authority) WHERE authority IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments (user_id);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_attempts_status_check CHECK (status IN ('pending', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON payment_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON payment_attempts (payment_id, attempt_number DESC);

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

UPDATE subscriptions
SET started_at = COALESCE(started_at, created_at),
    expires_at = COALESCE(expires_at, current_period_end)
WHERE started_at IS NULL OR expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  amount NUMERIC(20, 2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  status VARCHAR(16) NOT NULL DEFAULT 'paid',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_id ON invoices (payment_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id VARCHAR(64),
  event VARCHAR(64) NOT NULL,
  variant VARCHAR(8) NOT NULL DEFAULT 'A',
  plan VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_variant_created
  ON analytics_events (event, variant, created_at DESC);

-- Marketing leads (conversion capture; dedupe on email)
CREATE TABLE IF NOT EXISTS leads (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  source VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_source_check CHECK (source IN ('soft_unlock', 'save_action', 'seo_guide'))
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_email_uidx ON leads (email);

-- Rate limit: max one conversion email per recipient per 24h (any kind)
CREATE TABLE IF NOT EXISTS conversion_email_log (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_email_log_email_created
  ON conversion_email_log (email, created_at DESC);

-- Growth Brain: centralized strategy performance (not payment/subscription tables)
CREATE TABLE IF NOT EXISTS growth_strategy_stats (
  id SERIAL PRIMARY KEY,
  strategy VARCHAR(16) NOT NULL UNIQUE,
  impressions BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_strategy_stats_updated
  ON growth_strategy_stats (updated_at DESC);

-- Relax leads source for SEO capture (idempotent on fresh DB)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source IN ('soft_unlock', 'save_action', 'seo_guide'));

-- Panel admins (password login; separate from end-user Google auth)
CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admins_role_check CHECK (role IN ('super_admin', 'admin', 'editor')),
  CONSTRAINT admins_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins (email);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  role VARCHAR(32) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_password_resets (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_pw_reset_hash ON admin_password_resets (token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_pw_reset_admin ON admin_password_resets (admin_id);

-- Central audit / product analytics pipeline (super_admin reads via /api/admin/audit*)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT,
  user_agent TEXT,
  path TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_name ON audit_events (event_name);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_id ON audit_events (session_id)
  WHERE session_id IS NOT NULL;

-- SaaS analytics enrichment (idempotent adds)
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS analytics_session_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS device TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS browser TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_segment TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_analytics_session
  ON audit_events (analytics_session_id) WHERE analytics_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_country ON audit_events (country_code)
  WHERE country_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_plan ON audit_events (plan) WHERE plan IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_segment ON audit_events (user_segment)
  WHERE user_segment IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_alerts_created_at ON audit_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_alerts_rule ON audit_alerts (rule);

-- Offer / coupon engine
CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  discount_type VARCHAR(32) NOT NULL,
  discount_value NUMERIC(14, 4) NOT NULL DEFAULT 0,
  applicable_plans JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_uses INTEGER,
  current_uses INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offers_discount_type_check CHECK (discount_type IN ('percentage', 'fixed_eur')),
  CONSTRAINT offers_discount_value_check CHECK (discount_value >= 0),
  CONSTRAINT offers_uses_check CHECK (max_uses IS NULL OR max_uses >= 1),
  CONSTRAINT offers_current_uses_check CHECK (current_uses >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS offers_code_unique_idx
  ON offers (LOWER(code));
CREATE INDEX IF NOT EXISTS idx_offers_active_expires ON offers (active, expires_at);
CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers (created_at DESC);

CREATE TABLE IF NOT EXISTS user_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  CONSTRAINT user_offers_status_check CHECK (status IN ('active', 'used', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_offers_user_offer_unique_idx
  ON user_offers (user_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_user_offers_user_status ON user_offers (user_id, status, assigned_at DESC);

CREATE TABLE IF NOT EXISTS offer_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  original_amount_eur NUMERIC(14, 4) NOT NULL DEFAULT 0,
  discount_amount_eur NUMERIC(14, 4) NOT NULL DEFAULT 0,
  final_amount_eur NUMERIC(14, 4) NOT NULL DEFAULT 0,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offer_redemptions_amounts_check CHECK (
    original_amount_eur >= 0 AND discount_amount_eur >= 0 AND final_amount_eur >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_offer_redemptions_user ON offer_redemptions (user_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_offer ON offer_redemptions (offer_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_payment ON offer_redemptions (payment_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount_eur NUMERIC(14, 4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_amount_eur NUMERIC(14, 4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS final_amount_eur NUMERIC(14, 4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS applied_offer_id UUID REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(32) NOT NULL DEFAULT 'global';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS source_plan VARCHAR(32);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS target_plan VARCHAR(32);

-- Customer sessions (revoke "other devices" across app instances)
CREATE TABLE IF NOT EXISTS customer_sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_user
  ON customer_sessions (user_id, expires_at DESC);

-- Account deletion email confirmation (hashed token, single-use, 24h)
CREATE TABLE IF NOT EXISTS delete_account_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delete_account_tokens_hash
  ON delete_account_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_delete_account_tokens_user_active
  ON delete_account_tokens (user_id, expires_at)
  WHERE used_at IS NULL;

-- Block re-registration for 30 days after account deletion (abuse prevention)
CREATE TABLE IF NOT EXISTS deleted_account_cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized VARCHAR(320) NOT NULL,
  deleted_user_id UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ NOT NULL,
  reason VARCHAR(64) NOT NULL DEFAULT 'account_deleted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deleted_account_cooldowns_email_active
  ON deleted_account_cooldowns (email_normalized, blocked_until DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(128);
UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR TRIM(account_status) = '';

-- Creator Wall (social proof feed)
CREATE TABLE IF NOT EXISTS creator_wall_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thumbnail_url TEXT,
  preview_video_url TEXT,
  style_preset VARCHAR(64) NOT NULL,
  platform VARCHAR(32),
  language VARCHAR(16),
  country_code VARCHAR(8),
  feedback TEXT,
  creator_name VARCHAR(120),
  social_handle VARCHAR(120),
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_email VARCHAR(320),
  export_job_id VARCHAR(64),
  approved BOOLEAN NOT NULL DEFAULT false,
  featured BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_wall_posts_public
  ON creator_wall_posts (approved, hidden, featured DESC, sort_order DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_creator_wall_posts_pending
  ON creator_wall_posts (approved, created_at DESC)
  WHERE approved = false AND hidden = false;
