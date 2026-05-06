# راهنمای گام به گام ایجاد فایل Nginx

## 📝 روش 1: استفاده از nano (پیشنهادی - ساده‌تر)

### مرحله 1: ایجاد و باز کردن فایل

```bash
nano /etc/nginx/sites-available/cutup.shop
```

این دستور:
- فایل را ایجاد می‌کند (اگر وجود نداشته باشد)
- فایل را باز می‌کند برای ویرایش

---

### مرحله 2: کپی کردن محتوا

**تمام محتوای زیر را کپی کنید:**

```nginx
# HTTP Server - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name cutup.shop www.cutup.shop;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name cutup.shop www.cutup.shop;

    # SSL Certificate (بعد از certbot تنظیم می‌شود)
    ssl_certificate /etc/letsencrypt/live/cutup.shop/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cutup.shop/privkey.pem;
    
    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend (Static Files)
    root /var/www/cutup/website;
    index index.html;

    # Blog posts — static HTML only
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

### مرحله 3: Paste کردن در nano

**در nano:**
1. **کلیک راست** روی terminal → Paste
   - یا `Shift + Insert` (در اکثر terminal ها)
   - یا `Ctrl + Shift + V` (در بعضی terminal ها)

**نکته:** اگر paste نشد، می‌توانید:
- از mouse راست کلیک کنید
- یا از منوی terminal → Edit → Paste

---

### مرحله 4: ذخیره و خروج

**در nano:**
1. `Ctrl + X` (برای خروج)
2. `Y` (برای تایید ذخیره)
3. `Enter` (برای تایید نام فایل)

---

### مرحله 5: فعال کردن سایت

```bash
# فعال کردن سایت
ln -s /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/

# حذف default site (اختیاری)
rm -f /etc/nginx/sites-enabled/default

# تست تنظیمات Nginx
nginx -t
```

**اگر پیام "syntax is ok" و "test is successful" دیدید، یعنی درست است!**

```bash
# Restart Nginx
systemctl restart nginx

# بررسی وضعیت
systemctl status nginx
```

---

## 📝 روش 2: استفاده از cat (سریع‌تر)

اگر می‌خواهید سریع‌تر باشد، می‌توانید از این روش استفاده کنید:

```bash
cat > /etc/nginx/sites-available/cutup.shop << 'EOF'
# HTTP Server - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name cutup.shop www.cutup.shop;

    # Let's Encrypt verification
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name cutup.shop www.cutup.shop;

    # SSL Certificate (بعد از certbot تنظیم می‌شود)
    ssl_certificate /etc/letsencrypt/live/cutup.shop/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cutup.shop/privkey.pem;
    
    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend (Static Files)
    root /var/www/cutup/website;
    index index.html;

    # Blog posts — static HTML only
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
EOF
```

**این دستور به صورت خودکار فایل را ایجاد می‌کند!**

---

## ✅ بررسی فایل

بعد از ایجاد فایل، می‌توانید بررسی کنید:

```bash
# بررسی وجود فایل
ls -la /etc/nginx/sites-available/cutup.shop

# نمایش محتوای فایل
cat /etc/nginx/sites-available/cutup.shop

# تست syntax
nginx -t
```

---

## 🆘 اگر مشکل داشتید

### مشکل: نمی‌توانم paste کنم
- از `Shift + Insert` استفاده کنید
- یا از mouse راست کلیک کنید
- یا از منوی terminal → Edit → Paste

### مشکل: خطای syntax
```bash
# بررسی خطا
nginx -t

# اگر خطا داشت، فایل را دوباره ویرایش کنید
nano /etc/nginx/sites-available/cutup.shop
```

### مشکل: فایل ایجاد نشد
```bash
# بررسی دسترسی
ls -la /etc/nginx/sites-available/

# اگر دسترسی ندارید، با sudo اجرا کنید
sudo nano /etc/nginx/sites-available/cutup.shop
```

---

## 📝 نکات مهم

1. **دقت در کپی:** مطمئن شوید همه محتوا را کپی کرده‌اید
2. **براکت‌ها:** همه `{` و `}` باید بسته شوند
3. **تست:** حتماً `nginx -t` را اجرا کنید قبل از restart

