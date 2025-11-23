# رفع مشکل Crash سرور

## مشکل:
- PM2 در حال اجرا است اما سرور روی port 3001 listen نمی‌کند
- PM2 39 بار restart شده (crash loop)
- `netstat` و `lsof` چیزی نشان نمی‌دهند

## راه‌حل:

### 1. بررسی لاگ‌های PM2

```bash
pm2 logs cutup-api --lines 100
```

### 2. بررسی خطاهای syntax یا import

```bash
cd /var/www/cutup
node server.js
```

اگر خطا داد، آن را برطرف کنید.

### 3. بررسی فایل‌های import شده

```bash
# بررسی اینکه chunk-processor.js وجود دارد
ls -la /var/www/cutup/api/chunk-processor.js

# بررسی syntax
node -c /var/www/cutup/api/transcribe.js
node -c /var/www/cutup/api/chunk-processor.js
```

### 4. Restart PM2

```bash
pm2 delete cutup-api
cd /var/www/cutup
pm2 start ecosystem.config.cjs
pm2 logs cutup-api --lines 50
```

### 5. بررسی ecosystem.config.cjs

```bash
cat /var/www/cutup/ecosystem.config.cjs
```


