-- Idempotent fragment: user_profiles for PostgreSQL (Cutup canonical schema).
-- users.id is UUID — user_profiles.user_id MUST be UUID (not integer).
-- Also applied automatically at runtime via ensureUserProfilesTable() in billing-repository.js

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(64),
  country VARCHAR(2),
  address TEXT,
  postal_code VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON user_profiles (country);
