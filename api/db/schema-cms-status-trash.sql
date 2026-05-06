-- CMS status: trash + restore previous status (idempotent; run after schema-cms-soft-delete.sql)

ALTER TABLE cms_pages ADD COLUMN IF NOT EXISTS status_before_trash TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS status_before_trash TEXT;

UPDATE cms_pages SET status = 'trash' WHERE status = 'deleted';
UPDATE blog_posts SET status = 'trash' WHERE status = 'deleted';

ALTER TABLE cms_pages DROP CONSTRAINT IF EXISTS cms_pages_status_check;
ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'));

ALTER TABLE blog_posts DROP CONSTRAINT IF EXISTS blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived', 'trash'));
