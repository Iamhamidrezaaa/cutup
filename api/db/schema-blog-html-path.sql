-- Blog HTML file path (physical file under repo /blog/{slug}.html)
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS html_path TEXT;

CREATE INDEX IF NOT EXISTS idx_blog_posts_html_path ON blog_posts(html_path) WHERE html_path IS NOT NULL;
