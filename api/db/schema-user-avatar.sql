-- Custom profile photo (uploaded by user; overrides Google picture in dashboard)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
