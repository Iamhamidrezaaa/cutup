# Production nginx — duplicate `server_name` fix

Run **on the server** (not locally). Paste outputs into your deploy notes.

## Phase 1 — find duplicates

```bash
ls -la /etc/nginx/sites-enabled/
ls -la /etc/nginx/sites-available/
grep -R "server_name cutup.shop" /etc/nginx/
```

**Common causes of `conflicting server name "cutup.shop"`:**
- `cutup.shop` enabled twice in `sites-enabled/`
- Old backup like `cutup.shop.bak` symlinked
- Same `server { }` block duplicated inside one file (HTTP + HTTPS is OK in **separate** files if only one listens per port)

## Phase 2 — which config is active

```bash
sudo nginx -T 2>&1 | tee /tmp/nginx-full.txt
grep -n "server_name cutup.shop" /tmp/nginx-full.txt
grep -n "root \|location /blog\|location /api\|try_files" /tmp/nginx-full.txt
```

You want **one** active `root` for the site (usually `/var/www/cutup/website`) and **one** blog location.

**If `nginx -T | grep location` shows NO `/blog` block — articles will 404 even when `/var/www/cutup/blog/*.html` exists.**

Add in **both** HTTP and HTTPS `server { }` blocks (before `location /`):

```nginx
    include /var/www/cutup/deploy/nginx-blog-locations.conf;
```

Or paste from `deploy/nginx-blog-locations.conf` in this repo.

**Remove typo duplicate:** `sudo rm -f /etc/nginx/sites-enabled/cutup.sho`

## Phase 3 — clean enabled sites

```bash
# Example: keep only cutup.shop
sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f /etc/nginx/sites-enabled/cutup.shop.bak
sudo ln -sf /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/cutup.shop
sudo nginx -t && sudo systemctl reload nginx
```

## Phase 4 — deploy blog HTML + covers

```bash
ls -la /var/www/cutup/blog/*.html | wc -l    # expect 10
ls -la /var/www/cutup/website/cms-media/images/blog/ | head
```

## Phase 5 — validate

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://cutup.shop/blog/best-ai-subtitle-generators-2026
curl -sS -o /dev/null -w "%{http_code}\n" https://cutup.shop/cms-media/images/blog/ai-subtitle-generators-2026-cover.jpg
curl -sS https://cutup.shop/api/blog/posts | head -c 400
```

Expected: post `200`, cover `200`, API posts with non-empty `coverImageUrl` starting with `/cms-media/`.
