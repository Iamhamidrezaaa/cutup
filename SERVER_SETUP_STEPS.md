# راهنمای کامل تنظیمات سرور برای cutup.shop

## 📋 خلاصه Cloudflare

**Cloudflare برای ما چه کاری می‌کند:**
- ✅ مدیریت DNS (سریع و قابل اعتماد)
- ✅ محافظت از DDoS
- ❌ CDN/Cache (برای API استفاده نمی‌کنیم - Proxy Off)
- ❌ SSL از Cloudflare (از Let's Encrypt روی سرور استفاده می‌کنیم)

**نتیجه:** Cloudflare فقط DNS را مدیریت می‌کند و ترافیک را مستقیماً به سرور شما هدایت می‌کند.

---

## 🚀 مراحل تنظیمات سرور

### مرحله 1: اتصال به سرور

```bash
ssh root@195.248.240.108
```

---

### مرحله 2: بررسی DNS (قبل از شروع)

از کامپیوتر خود این دستور را اجرا کنید:

```bash
nslookup cutup.shop
```

**باید IP سرور (195.248.240.108) را نشان دهد.**

اگر نشان نداد، چند دقیقه صبر کنید (DNS propagation).

---

### مرحله 3: نصب Nginx و Certbot

```bash
# به‌روزرسانی سیستم
apt update && apt upgrade -y

# نصب Nginx
apt install -y nginx

# نصب Certbot برای SSL
apt install -y certbot python3-certbot-nginx

# بررسی وضعیت Nginx
systemctl status nginx
```

---

### مرحله 4: ایجاد پوشه Website

```bash
# ایجاد پوشه website
mkdir -p /var/www/cutup/website

# بررسی
ls -la /var/www/cutup/
```

---

### مرحله 5: تنظیم Nginx

```bash
# ایجاد فایل تنظیمات
nano /etc/nginx/sites-available/cutup.shop
```

**محتوای فایل را کپی کنید:**

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

**ذخیره:** `Ctrl+X` سپس `Y` سپس `Enter`

```bash
# فعال کردن سایت
ln -s /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/

# حذف default site (اختیاری)
rm -f /etc/nginx/sites-enabled/default

# تست تنظیمات Nginx
nginx -t

# اگر خطایی نبود، restart کنید
systemctl restart nginx
```

---

### مرحله 6: دریافت SSL Certificate

```bash
# دریافت SSL با Let's Encrypt
certbot --nginx -d cutup.shop -d www.cutup.shop
```

**در حین اجرا:**
- Email: ایمیل خود را وارد کنید
- Terms: `A` را بزنید (موافقت)
- Redirect: `2` را بزنید (redirect HTTP to HTTPS)

**نکته:** اگر DNS هنوز propagate نشده باشد، certbot خطا می‌دهد. باید صبر کنید.

```bash
# بررسی وضعیت SSL
certbot certificates

# تست auto-renewal
certbot renew --dry-run
```

---

### مرحله 7: تنظیم Firewall

```bash
# بررسی وضعیت firewall
ufw status

# اگر فعال نیست، فعال کنید
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw enable

# بررسی
ufw status
```

---

### مرحله 8: قرار دادن فایل‌های Website

```bash
cd /var/www/cutup

# اگر از Git استفاده می‌کنید:
git pull origin main

# بررسی پوشه website
ls -la website/
# باید index.html, style.css, script.js وجود داشته باشد
```

**اگر فایل‌های website ندارید:**
- از کامپیوتر خود با WinSCP یا FileZilla فایل‌ها را آپلود کنید
- یا از Git clone کنید

---

### مرحله 9: تنظیم API URL در Frontend

```bash
cd /var/www/cutup/website

# بررسی فایل‌های JavaScript
ls -la *.js

# ویرایش فایل JavaScript (مثلاً script.js یا app.js)
nano script.js
```

**در فایل JavaScript، این خط را پیدا کنید و تغییر دهید:**

```javascript
// قبل:
const API_BASE_URL = 'http://195.248.240.108:3001';
// یا
const API_BASE_URL = 'http://localhost:3001';

// بعد:
const API_BASE_URL = 'https://cutup.shop/api';
```

**ذخیره:** `Ctrl+X` سپس `Y` سپس `Enter`

---

### مرحله 10: تنظیم CORS در Backend

```bash
cd /var/www/cutup

# بررسی فایل cors.js
nano api/cors.js
```

**دامنه جدید را اضافه کنید:**

```javascript
const allowedOrigins = [
  'https://cutup.shop',
  'https://www.cutup.shop',
  'http://localhost:3000', // برای development
  'chrome-extension://...' // برای extension
];
```

**یا در server.js:**

```javascript
app.use(cors({
  origin: [
    'https://cutup.shop',
    'https://www.cutup.shop',
    'http://localhost:3000',
    /^chrome-extension:\/\//
  ],
  credentials: true
}));
```

```bash
# Restart PM2
pm2 restart cutup-api

# بررسی لاگ
pm2 logs cutup-api --lines 20
```

---

### مرحله 11: تست

#### 11.1 تست Frontend
1. مرورگر را باز کنید
2. به `https://cutup.shop` بروید
3. باید صفحه اصلی نمایش داده شود

#### 11.2 تست Backend API
```bash
# از سرور
curl http://localhost:3001/health

# از کامپیوتر خود
curl https://cutup.shop/api/health
```

#### 11.3 تست Extension
Extension Chrome باید همچنان کار کند (چون از IP مستقیم استفاده می‌کند).

---

## ✅ چک‌لیست نهایی

- [ ] DNS در Cloudflare تنظیم شده (A Records)
- [ ] DNS propagate شده (nslookup کار می‌کند)
- [ ] Nginx نصب شده
- [ ] فایل تنظیمات Nginx ایجاد شده
- [ ] SSL Certificate دریافت شده
- [ ] Firewall تنظیم شده
- [ ] Frontend در `/var/www/cutup/website` قرار دارد
- [ ] API URL در frontend تنظیم شده
- [ ] CORS در backend تنظیم شده
- [ ] Frontend کار می‌کند: `https://cutup.shop`
- [ ] Backend API کار می‌کند: `https://cutup.shop/api/health`
- [ ] Extension همچنان کار می‌کند

---

## 🆘 Troubleshooting

### مشکل: SSL Certificate دریافت نمی‌شود
```bash
# بررسی DNS
dig cutup.shop

# بررسی Port 80
netstat -tulpn | grep :80

# بررسی Nginx
systemctl status nginx
nginx -t

# دوباره certbot را اجرا کنید
certbot --nginx -d cutup.shop -d www.cutup.shop --force-renewal
```

### مشکل: 502 Bad Gateway
```bash
# بررسی Backend
pm2 status
pm2 logs cutup-api

# بررسی Port 3001
netstat -tulpn | grep :3001

# Restart Backend
pm2 restart cutup-api
```

### مشکل: CORS Error
```bash
# بررسی CORS در backend
grep -r "cutup.shop" /var/www/cutup/api/

# Restart Backend
pm2 restart cutup-api

# بررسی لاگ
pm2 logs cutup-api --lines 50
```

---

## 📝 نکات مهم

1. **HTTPS اجباری:** همه ترافیک HTTP به HTTPS redirect می‌شود
2. **Proxy Off:** در Cloudflare، Proxy برای API باید Off باشد
3. **SSL Auto-Renewal:** Certbot خودکار هر 90 روز renew می‌کند
4. **Backup:** تنظیم backup منظم از فایل‌های مهم

