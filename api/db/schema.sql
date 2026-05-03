-- Cutup billing / subscription persistence (PostgreSQL)
-- Run: node api/db/migrate.mjs   (requires DATABASE_URL)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan VARCHAR(32) NOT NULL DEFAULT 'free',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  billing_period VARCHAR(32) NOT NULL DEFAULT 'monthly',
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
  CONSTRAINT usage_one_per_user UNIQUE (user_id)
);

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
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
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
