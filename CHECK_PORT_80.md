# بررسی مشکل Port 80

## 🔍 بررسی چه چیزی از Port 80 استفاده می‌کند

```bash
# بررسی Port 80
netstat -tulpn | grep :80

# یا
lsof -i :80

# یا
ss -tulpn | grep :80
```

## 🔧 راه حل‌ها

### اگر Nginx قبلی از Port 80 استفاده می‌کند:

```bash
# پیدا کردن PID
ps aux | grep nginx

# کشتن همه پروسس‌های Nginx
pkill -9 nginx

# بررسی دوباره
netstat -tulpn | grep :80
```

### اگر پروسس دیگری از Port 80 استفاده می‌کند:

```bash
# پیدا کردن PID
lsof -i :80

# متوقف کردن پروسس
kill -9 <PID>
```

### بررسی لاگ برای جزئیات بیشتر:

```bash
# بررسی لاگ systemd
journalctl -xeu nginx.service --no-pager

# یا
systemctl status nginx.service -l
```

