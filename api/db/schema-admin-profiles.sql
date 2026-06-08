-- Admin agent profiles for Support Center (display identity — never expose admin email to customers)

CREATE TABLE IF NOT EXISTS admin_profiles (
  admin_user_id INTEGER PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  display_name VARCHAR(120) NOT NULL,
  avatar_url TEXT,
  job_title VARCHAR(120),
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_profiles_visible ON admin_profiles (is_visible) WHERE is_visible = TRUE;
