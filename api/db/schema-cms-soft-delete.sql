-- CMS soft-delete + blog rich HTML (idempotent; run after schema-cms.sql)
ALTER TABLE cms_pages DROP CONSTRAINT IF EXISTS cms_pages_status_check;
ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'));

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'));

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS content_html TEXT;
