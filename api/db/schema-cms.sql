-- Content Studio (pages, media, revisions) — idempotent
-- Applied via schema.sql

CREATE TABLE IF NOT EXISTS cms_pages (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  hero_title TEXT,
  hero_subtitle TEXT,
  content TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  template VARCHAR(64) NOT NULL DEFAULT 'default',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  is_homepage BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  og_title TEXT,
  og_description TEXT,
  og_image_url TEXT,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  published_by TEXT,
  CONSTRAINT cms_pages_status_check CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'))
);

CREATE INDEX IF NOT EXISTS idx_cms_pages_status_updated ON cms_pages (status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_pages_one_homepage ON cms_pages (is_homepage) WHERE is_homepage = TRUE;

CREATE TABLE IF NOT EXISTS cms_page_revisions (
  id BIGSERIAL PRIMARY KEY,
  page_id BIGINT NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_cms_page_revisions_page ON cms_page_revisions (page_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_post_revisions (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_post ON blog_post_revisions (post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_categories (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blog_tags (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS media_library (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_type VARCHAR(16) NOT NULL DEFAULT 'image',
  file_size BIGINT NOT NULL DEFAULT 0,
  width INT,
  height INT,
  duration_sec DOUBLE PRECISION,
  url TEXT NOT NULL,
  alt_text TEXT,
  caption TEXT,
  folder TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_starred BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_library_type_created ON media_library (media_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_library_filename ON media_library (filename);

CREATE TABLE IF NOT EXISTS media_usage (
  id BIGSERIAL PRIMARY KEY,
  media_id BIGINT NOT NULL REFERENCES media_library(id) ON DELETE CASCADE,
  entity_type VARCHAR(32) NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_usage_media ON media_usage (media_id);
CREATE INDEX IF NOT EXISTS idx_media_usage_entity ON media_usage (entity_type, entity_id);

-- Extend blog_posts (backward compatible)
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author_email TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS reading_time_minutes INT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS og_image_url TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS seo_title TEXT;

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'));
