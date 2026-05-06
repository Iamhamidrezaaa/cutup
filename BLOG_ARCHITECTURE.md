# Blog architecture (single source of truth)

## Model

| Layer | Location |
|-------|----------|
| **Database** | `blog_posts` — id, slug, title, excerpt, tags, category, cover, status, `content_html`, `html_path`, timestamps |
| **Public HTML** | `{repo}/blog/{slug}.html` → on server `/var/www/cutup/blog/{slug}.html` |
| **Public URL** | `https://cutup.shop/blog/{slug}` |
| **Blog index** | `website/blog.html` + `GET /api/blog/posts` (DB + published `website/blog-pages/` + `blog/*.html`, deduped by slug) |

Admin save/publish **writes the HTML file** and updates `html_path`. No runtime SSR.

## Removed / deprecated

- `website/blog-pages/` — editorial source for new articles; merged into the public index even before DB upsert; run `node api/db/migrate-blog-html.mjs` to sync DB + `blog/{slug}.html` + `website/blog-posts.json`
- `docs/BLOG_AGENT_BRIEF.md` — copy-paste agent briefing for new posts
- Blog card covers must be **1920×1080 (16:9)** — run `scripts/normalize-blog-cover.ps1 -InputPath … -OutputPath website/cms-media/images/blog/{slug}-cover.jpg` after generating art
- Runtime SSR pipeline (`resolveBlogArticle` + dynamic render on each request)
- nginx proxy of `/blog/` to Node for post HTML (use static files instead)

Still used at **build/migrate time only**: `api/blog-ssr.js` renders HTML when admin saves or when you run migration.

## Admin

- List: `GET /api/admin?action=blogPosts` or `blogPostsEnriched`
- Save: `saveBlogPost` / `saveBlogPostEnriched` → DB + `syncBlogPostHtml`
- Publish: `publishBlogPost` → sync HTML
- Regenerate: `POST action=regenerateBlogHtml` body `{ "id": "…" }` or `{ "slug": "…" }`
- Delete: soft delete removes HTML; purge deletes row + file

## Public routing

**Production (nginx, preferred):**

```nginx
location ~ ^/blog/([a-z0-9][a-z0-9-]*)/?$ {
    root /var/www/cutup;
    try_files /blog/$1.html =404;
}
```

**Dev / fallback:** Express `GET /blog/:slug` serves `blog/{slug}.html`.

Both support `/blog/{slug}` and `/blog/{slug}.html` (slug normalizer strips `.html`).

## Deploy checklist

```bash
cd /var/www/cutup
git pull
npm install
node api/db/migrate.mjs
node api/db/migrate-blog-html.mjs
pm2 restart cutup
sudo nginx -t && sudo systemctl reload nginx
```

## Test URLs

- https://cutup.shop/blog.html
- https://cutup.shop/blog/best-ai-subtitle-generators-2026
- https://cutup.shop/blog/how-to-generate-srt-subtitles
- https://cutup.shop/api/blog/posts
