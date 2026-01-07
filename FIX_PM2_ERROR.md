# حل مشکل PM2 Errored

## مشکل: سرور در حالت errored است

سرور 15 بار restart شده و crash می‌کند.

## دستورات بررسی

### 1. بررسی لاگ‌های PM2

```bash
# بررسی لاگ‌های خطا
pm2 logs cutup-api --err --lines 50

# بررسی همه لاگ‌ها
pm2 logs cutup-api --lines 50

# بررسی لاگ‌های real-time
pm2 logs cutup-api --lines 0
```

### 2. بررسی جزئیات خطا

```bash
# بررسی جزئیات process
pm2 describe cutup-api

# بررسی info
pm2 info cutup-api
```

### 3. حذف و restart

```bash
# حذف process
pm2 delete cutup-api

# اجرای مجدد
cd /var/www/cutup
pm2 start server.js --name cutup-api

# یا اگر ecosystem file دارید:
pm2 start ecosystem.config.js
```

### 4. بررسی خطاهای احتمالی

```bash
cd /var/www/cutup

# بررسی فایل .env
cat .env

# بررسی node_modules
ls -la node_modules | head -5

# تست اجرای دستی
node server.js
```

اگر خطا داد، لاگ را بفرستید.

