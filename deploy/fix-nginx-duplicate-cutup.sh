#!/bin/bash
# Run on server: sudo bash /var/www/cutup/deploy/fix-nginx-duplicate-cutup.sh
set -euo pipefail

echo "=== Enabled sites ==="
ls -la /etc/nginx/sites-enabled/

echo ""
echo "=== Files mentioning cutup.shop server_name ==="
grep -l "server_name cutup.shop" /etc/nginx/sites-enabled/* /etc/nginx/sites-available/* 2>/dev/null || true

echo ""
echo "=== REMOVE duplicates (keep only sites-enabled/cutup.shop symlink) ==="
rm -f /etc/nginx/sites-enabled/cutup.sho
rm -f /etc/nginx/sites-enabled/cutup.sh
rm -f /etc/nginx/sites-enabled/cutup.conf
rm -f /etc/nginx/sites-enabled/default

if [ ! -L /etc/nginx/sites-enabled/cutup.shop ]; then
  ln -sf /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/cutup.shop
fi

echo ""
echo "=== nginx -t (should have NO conflicting server name warnings) ==="
nginx -t 2>&1

echo ""
echo "=== Active blog location blocks ==="
nginx -T 2>/dev/null | grep -A4 'location ~ \^/blog' || echo "NO BLOG LOCATION FOUND"

echo ""
echo "=== Blog HTML files on disk ==="
ls -la /var/www/cutup/blog/*.html 2>/dev/null | wc -l

echo ""
echo "=== HTTP test ==="
curl -sS -o /dev/null -w "blog-post:%{http_code}\n" https://cutup.shop/blog/subtitle-workflows-mobile-2026
