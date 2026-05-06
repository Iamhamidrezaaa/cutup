# Deprecated — do not add new posts here

Blog content now lives in:

1. **PostgreSQL** `blog_posts` (metadata + `content_html` for editing)
2. **Physical file** `blog/{slug}.html` at repo root (public URL `/blog/{slug}`)

Migrate legacy folders with:

```bash
node api/db/migrate-blog-html.mjs
```

After migration, this directory is archival only.
