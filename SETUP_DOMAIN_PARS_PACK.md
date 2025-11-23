# راهنمای اتصال دامنه cutup.shop به سرور ابری

## 📋 اطلاعات سرور
- **IP:** 195.248.240.108
- **دامنه:** cutup.shop
- **پنل:** پارس پک

---

## مرحله 1: تنظیم DNS در پنل پارس پک

### 1.1 ورود به پنل پارس پک
1. به سایت [parspack.com](https://parspack.com) بروید
2. وارد پنل کاربری شوید
3. به بخش "مدیریت دامنه" یا "Domain Management" بروید
4. دامنه `cutup.shop` را پیدا کنید

### 1.2 تنظیم DNS Records
در پنل پارس پک، DNS Records را به این صورت تنظیم کنید:

```
Type    Name    Value              TTL     Priority
A       @       195.248.240.108    3600     -
A       www     195.248.240.108    3600     -
```

**نکته:** اگر در پارس پک نمی‌توانید DNS تنظیم کنید، باید Nameserver را تغییر دهید.

### 1.3 تغییر Nameserver (اگر لازم باشد)
اگر پارس پک Nameserver اختصاصی نمی‌دهد، می‌توانید از Cloudflare (رایگان) استفاده کنید:

1. به [cloudflare.com](https://cloudflare.com) بروید و ثبت‌نام کنید
2. دامنه `cutup.shop` را اضافه کنید
3. Nameserver های Cloudflare را در پارس پک تنظیم کنید
4. در Cloudflare، DNS Records را تنظیم کنید:
   - Type: A, Name: @, Value: 195.248.240.108
   - Type: A, Name: www, Value: 195.248.240.108

---

## مرحله 2: بررسی DNS Propagation

بعد از تنظیم DNS، چند دقیقه تا چند ساعت طول می‌کشد تا DNS propagate شود.

```bash
# از کامپیوتر خودتان این دستورات را اجرا کنید:

# بررسی DNS
nslookup cutup.shop
# یا
dig cutup.shop

# باید IP سرور (195.248.240.108) را نشان دهد
```

---

## مرحله 3: نصب Nginx روی سرور

```bash
# اتصال به سرور
ssh root@195.248.240.108

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

## مرحله 4: تنظیم Nginx برای cutup.shop

```bash
# ایجاد فایل تنظیمات
nano /etc/nginx/sites-available/cutup.shop
```

محتوای فایل:

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

ذخیره: `Ctrl+X` سپس `Y` سپس `Enter`

```bash
# فعال کردن سایت
ln -s /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/

# حذف default site (اختیاری)
rm /etc/nginx/sites-enabled/default

# تست تنظیمات Nginx
nginx -t

# اگر خطایی نبود، restart کنید
systemctl restart nginx
```

---

## مرحله 5: دریافت SSL Certificate

```bash
# دریافت SSL با Let's Encrypt
certbot --nginx -d cutup.shop -d www.cutup.shop

# در حین اجرا، سوالات زیر را می‌پرسد:
# - Email: ایمیل خود را وارد کنید
# - Terms: A را بزنید (موافقت)
# - Redirect: 2 را بزنید (redirect HTTP to HTTPS)

# بررسی وضعیت SSL
certbot certificates

# تست auto-renewal
certbot renew --dry-run
```

**نکته:** اگر DNS هنوز propagate نشده باشد، certbot خطا می‌دهد. باید صبر کنید تا DNS کامل شود.

---

## مرحله 6: آماده‌سازی Frontend

```bash
cd /var/www/cutup

# بررسی وجود پوشه website
ls -la website/

# اگر پوشه website وجود ندارد، از Git pull کنید
git pull origin main

# بررسی محتوا
ls -la website/
# باید index.html, style.css, script.js وجود داشته باشد
```

---

## مرحله 7: تنظیم API URL در Frontend

```bash
# بررسی فایل‌های JavaScript در website
cd /var/www/cutup/website
ls -la *.js

# اگر script.js یا فایل JavaScript دیگری وجود دارد، ویرایش کنید
nano script.js
# یا
nano app.js
# یا هر فایل JavaScript دیگری
```

در فایل JavaScript، این خط را پیدا کنید و تغییر دهید:

```javascript
// قبل:
const API_BASE_URL = 'http://195.248.240.108:3001';
// یا
const API_BASE_URL = 'http://localhost:3001';

// بعد:
const API_BASE_URL = 'https://cutup.shop/api';
```

اگر فایل JavaScript ندارید، باید یک فایل ایجاد کنید که API را فراخوانی کند.

---

## مرحله 8: تنظیم CORS در Backend

```bash
cd /var/www/cutup
nano api/cors.js
```

در فایل `cors.js`، دامنه جدید را اضافه کنید:

```javascript
// اضافه کردن cutup.shop به allowed origins
const allowedOrigins = [
  'https://cutup.shop',
  'https://www.cutup.shop',
  'http://localhost:3000',
  'chrome-extension://...' // برای extension
];
```

یا در `server.js`:

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
```

---

## مرحله 9: تنظیم Firewall

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

## مرحله 10: تست

### 10.1 تست DNS
```bash
# از کامپیوتر خود
nslookup cutup.shop
# باید 195.248.240.108 را نشان دهد
```

### 10.2 تست Frontend
1. مرورگر را باز کنید
2. به `https://cutup.shop` بروید
3. باید صفحه اصلی نمایش داده شود

### 10.3 تست Backend API
```bash
# از سرور
curl http://localhost:3001/health

# از کامپیوتر خود
curl https://cutup.shop/api/health
```

### 10.4 تست Extension
Extension Chrome باید همچنان کار کند (چون از IP مستقیم استفاده می‌کند).

---

## 🔧 Troubleshooting

### مشکل: DNS propagate نشده
```bash
# بررسی از سرور
dig cutup.shop

# اگر IP اشتباه است، صبر کنید (تا 24 ساعت)
# یا با پشتیبانی پارس پک تماس بگیرید
```

### مشکل: SSL Certificate دریافت نمی‌شود
```bash
# بررسی Port 80
netstat -tulpn | grep :80

# بررسی Nginx
systemctl status nginx
nginx -t

# بررسی DNS
dig cutup.shop

# اگر DNS درست است، دوباره certbot را اجرا کنید
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

## ✅ چک‌لیست نهایی

- [ ] DNS در پارس پک تنظیم شده
- [ ] DNS propagate شده (nslookup کار می‌کند)
- [ ] Nginx نصب شده
- [ ] فایل تنظیمات Nginx ایجاد شده
- [ ] SSL Certificate دریافت شده
- [ ] Frontend در `/var/www/cutup/website` قرار دارد
- [ ] API URL در frontend تنظیم شده
- [ ] CORS در backend تنظیم شده
- [ ] Firewall تنظیم شده
- [ ] Frontend کار می‌کند: `https://cutup.shop`
- [ ] Backend API کار می‌کند: `https://cutup.shop/api/health`
- [ ] Extension همچنان کار می‌کند

---

## 📝 نکات مهم

1. **DNS Propagation:** ممکن است 5 دقیقه تا 24 ساعت طول بکشد
2. **SSL Auto-Renewal:** Certbot خودکار هر 90 روز renew می‌کند
3. **Backup:** تنظیم backup منظم از فایل‌های مهم
4. **Monitoring:** از PM2 monitoring استفاده کنید

---

## 🆘 اگر مشکلی پیش آمد

1. **لاگ Nginx:** `/var/log/nginx/error.log`
2. **لاگ Backend:** `pm2 logs cutup-api`
3. **تست Nginx:** `nginx -t`
4. **بررسی Ports:** `netstat -tulpn`

