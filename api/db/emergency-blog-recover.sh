#!/bin/bash
# Run ON THE SERVER as root or deploy user. Backs up then restores blog DB + HTML files.
set -euo pipefail
APP_ROOT="${APP_ROOT:-/var/www/cutup}"
cd "$APP_ROOT"

STAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$APP_ROOT/backups/blog_$STAMP"
mkdir -p "$BACKUP_DIR"

echo "=== Backup ==="
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" -t blog_posts --data-only -f "$BACKUP_DIR/blog_posts.sql" 2>/dev/null || echo "warn: pg_dump blog_posts skipped"
fi
cp -a "$APP_ROOT/blog" "$BACKUP_DIR/blog" 2>/dev/null || mkdir -p "$BACKUP_DIR/blog"
cp -a "$APP_ROOT/website/blog-pages" "$BACKUP_DIR/blog-pages" 2>/dev/null || true

echo "=== Migrate schema ==="
node api/db/migrate.mjs

echo "=== Export HTML + upsert DB ==="
node api/db/migrate-blog-html.mjs

echo "=== Done. Reload nginx + restart Node ==="
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "  pm2 restart cutup"
