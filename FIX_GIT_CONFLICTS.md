# رفع Git Conflicts در سرور

## مشکل:
فایل‌های سرور conflict markers دارند (`<<<<<<< HEAD`, `=======`, `>>>>>>>`)

## راه‌حل سریع:

### روش 1: آپلود فایل‌های صحیح از محلی (توصیه می‌شود)

فایل‌های زیر را از کامپیوتر محلی به سرور آپلود کنید (از طریق WinSCP):

1. `api/transcribe.js`
2. `api/chunk-processor.js`
3. `server.js`

مسیر در سرور: `/var/www/cutup/`

### روش 2: Resolve Conflicts در سرور

```bash
cd /var/www/cutup

# بررسی فایل‌های conflict
grep -r "<<<<<<< HEAD" api/ server.js

# برای هر فایل، conflict را resolve کنید
# یا فایل‌های صحیح را از GitHub pull کنید
git checkout --theirs api/transcribe.js
git checkout --theirs api/chunk-processor.js
git checkout --theirs server.js

# یا از HEAD استفاده کنید
git checkout --ours api/transcribe.js
git checkout --ours api/chunk-processor.js
git checkout --ours server.js

# بعد از resolve
git add .
git commit -m "Resolve merge conflicts"
```

### روش 3: Pull از GitHub (اگر فایل‌های GitHub صحیح هستند)

```bash
cd /var/www/cutup
git fetch origin
git reset --hard origin/main
pm2 restart cutup-api
```

## بعد از Fix:

```bash
# بررسی syntax
node -c api/transcribe.js
node -c api/chunk-processor.js
node -c server.js

# Restart PM2
pm2 restart cutup-api

# بررسی لاگ‌ها
pm2 logs cutup-api --lines 30
```

