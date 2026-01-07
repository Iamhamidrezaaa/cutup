# بررسی وضعیت سرور Node.js

## مشکل: 502 Bad Gateway

این خطا یعنی nginx نمی‌تواند به سرور Node.js وصل شود.

## دستورات بررسی

### 1. بررسی وضعیت سرور

```bash
# بررسی وضعیت service
systemctl status cutup

# یا اگر از PM2 استفاده می‌کنید:
pm2 status
pm2 list
```

### 2. بررسی پورت 3001

```bash
# بررسی اینکه آیا پورت 3001 در حال استفاده است
netstat -tlnp | grep 3001

# یا
ss -tlnp | grep 3001

# یا
lsof -i :3001
```

### 3. بررسی لاگ‌های سرور

```bash
# اگر از systemd استفاده می‌کنید:
journalctl -u cutup -n 50 --no-pager

# یا اگر از PM2 استفاده می‌کنید:
pm2 logs cutup --lines 50

# یا لاگ‌های real-time:
pm2 logs cutup --lines 0
```

### 4. تست مستقیم سرور

```bash
# تست مستقیم از سرور
curl http://localhost:3001/api/oauth/google/start -X POST -H "Content-Type: application/json" -v

# یا
curl http://127.0.0.1:3001/api/oauth/google/start -X POST -H "Content-Type: application/json" -v
```

### 5. Restart سرور

```bash
# اگر از systemd استفاده می‌کنید:
systemctl restart cutup
systemctl status cutup

# یا اگر از PM2 استفاده می‌کنید:
pm2 restart cutup
pm2 status
```

### 6. بررسی nginx error logs

```bash
# بررسی لاگ‌های nginx
tail -f /var/log/nginx/error.log

# یا
grep "502" /var/log/nginx/error.log | tail -20
```

## راه‌حل احتمالی

اگر سرور در حال اجرا نیست:

```bash
cd /var/www/cutup

# بررسی فایل .env
cat .env | grep GOOGLE

# بررسی node_modules
ls -la node_modules | head -5

# نصب dependencies اگر لازم باشد
npm install

# اجرای دستی سرور برای تست
node server.js
```

اگر خطا داد، لاگ را بفرستید.

