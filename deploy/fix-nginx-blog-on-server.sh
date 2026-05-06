#!/bin/bash
# Run on production as root: bash /var/www/cutup/deploy/fix-nginx-blog-on-server.sh
set -euo pipefail

ENABLED=/etc/nginx/sites-enabled
AVAILABLE=/etc/nginx/sites-available/cutup.shop
SNIPPET=/var/www/cutup/deploy/nginx-blog-locations.conf
MARKER="# CUTUP_BLOG_LOCATIONS"

echo "=== 1) Remove duplicate typo site (cutup.sho) ==="
rm -f "$ENABLED/cutup.sho"
rm -f "$ENABLED/cutup.shop.bak" "$ENABLED/default" 2>/dev/null || true

echo "=== 2) Ensure blog HTML files exist ==="
ls -la /var/www/cutup/blog/*.html | wc -l

if ! grep -q "$MARKER" "$AVAILABLE"; then
  echo "=== 3) Patch $AVAILABLE — add blog locations ==="
  cp -a "$AVAILABLE" "${AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
  # Insert include after first root line in each server block is fragile; use manual note:
  cat <<'EOF'

MANUAL STEP REQUIRED:
Open /etc/nginx/sites-available/cutup.shop and in EACH
  server { ... server_name cutup.shop ... }
block, add BEFORE  location /  :

    # CUTUP_BLOG_LOCATIONS
    include /var/www/cutup/deploy/nginx-blog-locations.conf;

Then run: sudo nginx -t && sudo systemctl reload nginx
EOF
  exit 0
fi

echo "=== 3) Already patched ==="
nginx -t
systemctl reload nginx
echo "=== 4) Test ==="
curl -sS -o /dev/null -w "blog-post:%{http_code}\n" https://cutup.shop/blog/best-ai-subtitle-generators-2026
