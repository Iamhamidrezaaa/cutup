-- Cutup email platform — send log + future preferences/analytics hooks

CREATE TABLE IF NOT EXISTS email_send_log (
  id BIGSERIAL PRIMARY KEY,
  template_id VARCHAR(64) NOT NULL,
  event_name VARCHAR(64),
  recipient_email TEXT NOT NULL,
  subject TEXT,
  provider VARCHAR(16),
  message_id TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'sent',
  error_message TEXT,
  idempotency_key TEXT,
  locale VARCHAR(8) DEFAULT 'en',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient_created
  ON email_send_log (lower(recipient_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_send_log_template_created
  ON email_send_log (template_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_idempotency
  ON email_send_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

-- Future: per-user notification preferences
CREATE TABLE IF NOT EXISTS email_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marketing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  product_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  security_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  locale VARCHAR(8) DEFAULT 'en',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
