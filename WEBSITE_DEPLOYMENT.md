# راهنمای Deploy نسخه وب Cutup

## 🎯 ساختار پیشنهادی

```
سرور فعلی (195.248.240.108):
├── Backend API (Port 3001) - همان که الان دارید
├── Frontend Website (Port 80/443) - نسخه وب جدید
└── Nginx (Reverse Proxy) - برای routing و SSL
```

## 📋 مراحل Deploy

### مرحله 1: خرید دامنه

**پیشنهادات:**
- **ایرانی:** `.ir` از nic.ir (ارزان‌تر، حدود 50-100 هزار تومان)
- **بین‌المللی:** `.com` از Namecheap یا GoDaddy (حدود 10-15 دلار)

**نام‌های پیشنهادی:**
- `cutup.ir` یا `cutupapp.ir`
- `cutup.com` یا `getcutup.com`

---

### مرحله 2: تنظیم DNS

بعد از خرید دامنه، DNS را به این صورت تنظیم کنید:

```
Type    Name    Value              TTL
A       @       195.248.240.108    3600
A       www     195.248.240.108    3600
```

---

### مرحله 3: نصب Nginx روی سرور

```bash
# اتصال به سرور
ssh root@195.248.240.108

# نصب Nginx
apt update
apt install -y nginx certbot python3-certbot-nginx

# بررسی وضعیت
systemctl status nginx
```

---

### مرحله 4: تنظیم Nginx برای Frontend و Backend

```bash
# ایجاد فایل تنظیمات
nano /etc/nginx/sites-available/cutup
```

محتوای فایل:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
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
    server_name yourdomain.com www.yourdomain.com;

    # SSL Certificate (بعد از certbot تنظیم می‌شود)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

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
        
        # برای فایل‌های بزرگ
        client_max_body_size 100M;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }

    # Static Assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# فعال کردن سایت
ln -s /etc/nginx/sites-available/cutup /etc/nginx/sites-enabled/

# حذف default site
rm /etc/nginx/sites-enabled/default

# تست تنظیمات
nginx -t

# Restart Nginx
systemctl restart nginx
```

---

### مرحله 5: دریافت SSL Certificate

```bash
# دریافت SSL با Let's Encrypt (رایگان)
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

---

### مرحله 6: آماده‌سازی Frontend

```bash
cd /var/www/cutup

# کپی فایل‌های website (اگر هنوز نیست)
# یا از Git pull کنید
git pull origin main

# بررسی پوشه website
ls -la website/
```

---

### مرحله 7: تنظیم API URL در Frontend

در فایل `website/script.js` یا فایل JavaScript مربوطه:

```javascript
// تغییر این خط:
const API_BASE_URL = 'http://195.248.240.108:3001';

// به این (برای production):
const API_BASE_URL = 'https://yourdomain.com/api';
// یا برای development:
// const API_BASE_URL = 'http://localhost:3001';
```

---

### مرحله 8: تنظیم CORS در Backend

در فایل `api/cors.js` یا `server.js`:

```javascript
// اضافه کردن دامنه جدید به allowed origins
const allowedOrigins = [
  'https://yourdomain.com',
  'https://www.yourdomain.com',
  'http://localhost:3000', // برای development
  'chrome-extension://...' // برای extension
];
```

---

### مرحله 9: تست

1. **Frontend:** `https://yourdomain.com`
2. **Backend API:** `https://yourdomain.com/api/health`
3. **Extension:** باید همچنان کار کند

---

## 🔄 گزینه 2: Frontend جدا (برای آینده)

اگر در آینده ترافیک زیاد شد، می‌توانید:

### Option A: CDN برای Static Files
- استفاده از Cloudflare (رایگان)
- یا Vercel/Netlify برای frontend

### Option B: هاست جدا برای Frontend
- یک VPS کوچک (1GB RAM) برای frontend
- Backend روی سرور فعلی باقی بماند

---

## 📊 مقایسه هزینه

| گزینه | هزینه ماهانه | پیچیدگی | مقیاس‌پذیری |
|-------|-------------|---------|------------|
| **همه روی یک سرور** | فقط دامنه (~$1-2) | ⭐ ساده | ⭐⭐ خوب |
| **Frontend جدا** | دامنه + هاست (~$5-10) | ⭐⭐ متوسط | ⭐⭐⭐ عالی |
| **CDN + Backend** | دامنه + CDN (~$0-5) | ⭐⭐⭐ پیچیده | ⭐⭐⭐⭐ عالی |

---

## ✅ چک‌لیست Deploy

- [ ] دامنه خریداری شده
- [ ] DNS تنظیم شده
- [ ] Nginx نصب شده
- [ ] SSL Certificate دریافت شده
- [ ] Frontend در `/var/www/cutup/website` قرار دارد
- [ ] API URL در frontend تنظیم شده
- [ ] CORS در backend تنظیم شده
- [ ] تست شده: Frontend کار می‌کند
- [ ] تست شده: API کار می‌کند
- [ ] تست شده: Extension همچنان کار می‌کند

---

## 🚀 بعد از Deploy

1. **Monitoring:** از PM2 برای monitoring استفاده کنید
2. **Backup:** تنظیم backup منظم
3. **Logs:** بررسی لاگ‌های Nginx و PM2
4. **Security:** تنظیم firewall و rate limiting

---

## 📝 نکات مهم

1. **HTTPS اجباری:** همیشه از HTTPS استفاده کنید
2. **Rate Limiting:** برای جلوگیری از abuse
3. **Backup:** تنظیم backup منظم از دیتابیس (اگر دارید)
4. **Monitoring:** استفاده از PM2 monitoring یا ابزارهای دیگر

---

## 🆘 Troubleshooting

### مشکل: SSL Certificate دریافت نمی‌شود
```bash
# بررسی DNS
dig yourdomain.com

# بررسی Port 80
netstat -tulpn | grep :80

# بررسی Nginx
systemctl status nginx
nginx -t
```

### مشکل: API کار نمی‌کند
```bash
# بررسی Backend
pm2 status
pm2 logs cutup-api

# بررسی Port 3001
netstat -tulpn | grep :3001

# تست API
curl http://localhost:3001/health
```

### مشکل: CORS Error
- بررسی `allowedOrigins` در `cors.js`
- بررسی header های response در browser console

