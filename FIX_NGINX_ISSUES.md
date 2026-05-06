# حل مشکلات Nginx

## 🔍 مشکل 1: Port 80 در حال استفاده است

خطای `bind() to 0.0.0.0:80` یعنی Port 80 قبلاً توسط پروسس دیگری استفاده می‌شود.

### بررسی چه پروسسی از Port 80 استفاده می‌کند:

```bash
# بررسی Port 80
netstat -tulpn | grep :80
# یا
lsof -i :80
# یا
ss -tulpn | grep :80
```

### راه حل:

**اگر پروسس دیگری از Port 80 استفاده می‌کند:**
```bash
# پیدا کردن PID
lsof -i :80

# متوقف کردن پروسس (اگر لازم است)
kill -9 <PID>
```

**یا اگر Nginx قبلاً در حال اجرا است:**
```bash
# بررسی وضعیت Nginx
ps aux | grep nginx

# متوقف کردن همه پروسس‌های Nginx
pkill -9 nginx

# یا
systemctl stop nginx
```

---

## 🔍 مشکل 2: خطای SSL Certificate

فایل Nginx هنوز شامل بخش HTTPS با SSL است که باید حذف شود.

### بررسی فایل:

```bash
# بررسی محتوای فایل
cat /etc/nginx/sites-available/cutup.shop | grep ssl_certificate
```

اگر خروجی داشت، یعنی هنوز SSL در فایل است.

### راه حل: جایگزینی کامل فایل

```bash
# پاک کردن فایل قبلی
rm /etc/nginx/sites-available/cutup.shop

# ایجاد فایل جدید
nano /etc/nginx/sites-available/cutup.shop
```

**محتوای فایل (بدون SSL):**

```nginx
# HTTP Server (قبل از SSL)
server {
    listen 80;
    listen [::]:80;
    server_name cutup.shop www.cutup.shop;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Frontend (Static Files)
    root /var/www/cutup/website;
    index index.html;

    # Blog posts — static files at /var/www/cutup/blog/{slug}.html
    location ~ ^/blog/([a-z0-9][a-z0-9-]*)/?$ {
        root /var/www/cutup;
        try_files /blog/$1.html =404;
    }

    location /images/blog/ {
        alias /var/www/cutup/public/images/blog/;
    }

    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend Routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # برای فایل‌های بزرگ (ویدئو و صوت)
        client_max_body_size 100M;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Static Assets - Cache
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;
}
```

---

## ✅ مراحل کامل حل مشکل

### مرحله 1: متوقف کردن همه پروسس‌های Nginx

```bash
# متوقف کردن Nginx
systemctl stop nginx

# کشتن همه پروسس‌های Nginx (اگر لازم است)
pkill -9 nginx

# بررسی Port 80
netstat -tulpn | grep :80
```

### مرحله 2: بررسی و پاک کردن فایل قبلی

```bash
# بررسی محتوای فایل
cat /etc/nginx/sites-available/cutup.shop

# اگر شامل SSL است، پاک کنید
rm /etc/nginx/sites-available/cutup.shop
```

### مرحله 3: ایجاد فایل جدید (بدون SSL)

```bash
nano /etc/nginx/sites-available/cutup.shop
```

**کپی کردن محتوای بالا (بدون SSL)**

### مرحله 4: تست و Restart

```bash
# تست syntax
nginx -t

# اگر OK بود:
systemctl start nginx
systemctl status nginx
```

### مرحله 5: دریافت SSL

```bash
certbot --nginx -d cutup.shop -d www.cutup.shop
```

---

## 🔍 بررسی مشکلات دیگر

### اگر هنوز خطا داشت:

```bash
# بررسی لاگ Nginx
tail -f /var/log/nginx/error.log

# بررسی همه فایل‌های Nginx
ls -la /etc/nginx/sites-enabled/

# بررسی default site
cat /etc/nginx/sites-enabled/default
```

### اگر default site مشکل ایجاد می‌کند:

```bash
# حذف default site
rm /etc/nginx/sites-enabled/default

# تست دوباره
nginx -t
```

