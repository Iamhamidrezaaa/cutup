# Blog routing — deploy fix (`/blog/{slug}` 404)

> **Superseded by [BLOG_ARCHITECTURE.md](./BLOG_ARCHITECTURE.md)** — blog is now DB + static `blog/{slug}.html` (no SSR).

## Root cause

Production **nginx** serves only static files from `/var/www/cutup/website` (`try_files … =404`).

Only **`/api/`** is proxied to Node (port 3001).

Blog post URLs like `/blog/best-subtitle-workflow-youtube-shorts-2026` are **not** static files under `website/`, so nginx returns **404** before Node can run SSR.

Blog **cards and API** work: `/blog.html` is static, `/api/blog/posts` hits Node.

## Where content actually lives (no move required)

Editorial posts are **not** standalone HTML in `/var/www/cutup/blog/`.

They live in the repo as:

```
website/blog-pages/<slug>/meta.json
website/blog-pages/<slug>/body.html
```

Node renders them at runtime (`server.js` → `api/blog-ssr.js`).

**You do not need to `mv` HTML files into `/var/www/cutup/blog/`** unless you add optional pre-rendered exports.

## Fix on the server

### 1. Deploy latest code

Ensure these exist on the server:

- `server.js` (blog routes + `.html` slug support)
- `website/blog-pages/**` (all slugs)
- `api/blog-*.js`

### 2. Update nginx

Add **before** `location /`:

```nginx
location /blog/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /sitemap.xml {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Reference copy: `nginx-before-ssl.conf` in this repo.

### 3. Reload nginx + restart Node

```bash
sudo nginx -t && sudo systemctl reload nginx
# or: sudo nginx -s reload

cd /var/www/cutup   # your app root
pm2 restart cutup    # or your process manager
# verify Node listens on 3001
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/blog/best-ai-subtitle-generators-2026
```

### 4. Test public URLs

- https://cutup.shop/blog/best-ai-subtitle-generators-2026
- https://cutup.shop/blog/how-to-generate-srt-subtitles
- https://cutup.shop/blog/why-youtube-auto-captions-fail-2026
- https://cutup.shop/blog/best-subtitle-workflow-youtube-shorts-2026
- https://cutup.shop/blog/best-subtitle-workflow-youtube-shorts-2026.html (optional alias)

## Optional: pre-rendered HTML in `blog/`

If you export static HTML into the repo root `blog/{slug}.html`, Node serves that file first, then falls back to SSR.

Nginx-only alternative (not required if proxying `/blog/` to Node):

```nginx
# Only if you maintain /var/www/cutup/blog/*.html and want nginx to serve them directly
location /blog/ {
    alias /var/www/cutup/blog/;
    try_files $uri $uri.html =404;
}
```

Do **not** use this **instead of** Node proxy unless every post is pre-built HTML.

## Manual moves — only if you wrongly created files

| Wrong location | Action |
|----------------|--------|
| `website/blog-*.html` at website root | Keep redirects in `server.js` or delete after nginx proxy works |
| Random `website/*.html` blog dumps | Not used by SSR; safe to remove after backup |
| `/var/www/cutup/blog/*.html` only | Optional; Node can read `blog/` at app root if deployed |

**Do not** move `website/blog-pages/` — that is the source of truth.

## nginx reload required?

**Yes** — after editing `/etc/nginx/sites-available/cutup.shop`.
