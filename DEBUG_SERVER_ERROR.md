# Debug Server Error

## بررسی لاگ‌های خطا

```bash
# بررسی لاگ‌های خطا
pm2 logs cutup-api --err --lines 50

# یا همه لاگ‌ها
pm2 logs cutup-api --lines 50
```

## بررسی syntax error

```bash
# تست syntax فایل‌ها
cd /var/www/cutup
node --check server.js
node --check api/generate-docx.js
node --check api/oauth-google-start.js
```

## بررسی import errors

```bash
# تست import مستقیم
cd /var/www/cutup
node -e "import('./api/generate-docx.js').then(() => console.log('OK')).catch(e => console.error('ERROR:', e.message))"
```

