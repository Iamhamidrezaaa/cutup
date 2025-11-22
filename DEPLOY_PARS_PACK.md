# راهنمای Deploy روی سرور پارس پک

## 📋 اطلاعات سرور شما:
- **نام سرور:** testology-de-app1
- **IP:** 195.248.240.108
- **موقعیت:** Frankfurt
- **نوع:** VPS Server

---

## مرحله 1: اتصال به سرور

### 1.1 دریافت SSH Key یا Password
از پنل پارس پک:
1. روی "مدیریت سرور" کلیک کنید
2. به بخش "SSH Keys" بروید
3. SSH Key خود را دانلود کنید یا Password را دریافت کنید

### 1.2 اتصال از Windows
```bash
# اگر SSH Key دارید:
ssh -i path/to/your-key.pem root@195.248.240.108

# اگر Password دارید:
ssh root@195.248.240.108
```

### 1.3 اتصال از Linux/Mac
```bash
ssh root@195.248.240.108
```

---

## مرحله 2: به‌روزرسانی سیستم

```bash
# به‌روزرسانی سیستم
apt update && apt upgrade -y

# نصب ابزارهای ضروری
apt install -y curl wget git build-essential
```

---

## مرحله 3: نصب Node.js

```bash
# نصب Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# بررسی نسخه
node --version
npm --version
```

---

## مرحله 4: نصب PM2 (برای مدیریت Process)

```bash
npm install -g pm2
```

---

## مرحله 5: آپلود کد به سرور

### 5.1 روش 1: از Git (پیشنهادی)
```bash
# ایجاد دایرکتوری پروژه
mkdir -p /var/www/cutup
cd /var/www/cutup

# Clone از Git (اگر repository دارید)
git clone https://github.com/your-username/cutup.git .

# یا اگر repository ندارید، از روش 2 استفاده کنید
```

### 5.2 روش 2: آپلود مستقیم
از کامپیوتر خود:
```bash
# نصب rsync (اگر ندارید)
# Windows: از Git Bash استفاده کنید
# Linux/Mac: rsync معمولاً نصب است

# آپلود فایل‌ها
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ root@195.248.240.108:/var/www/cutup/
```

یا از FileZilla/WinSCP استفاده کنید.

---

## مرحله 6: نصب Dependencies

```bash
cd /var/www/cutup
npm install
```

---

## مرحله 7: تنظیم Environment Variables

```bash
# ایجاد فایل .env
nano /var/www/cutup/.env
```

محتوای فایل:
```env
OPENAI_API_KEY=your-openai-api-key-here
NODE_ENV=production
PORT=3000
```

ذخیره: `Ctrl+X` سپس `Y` سپس `Enter`

---

## مرحله 8: ایجاد فایل server.js

```bash
nano /var/www/cutup/server.js
```

محتوای فایل:
```javascript
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// CORS middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve static files from api directory
app.use('/api', express.static(join(__dirname, 'api')));

// Import and use API routes
async function loadRoutes() {
  // Upload endpoint
  const uploadHandler = (await import('./api/upload.js')).default;
  app.post('/api/upload', uploadHandler);
  
  // Transcribe endpoint
  const transcribeHandler = (await import('./api/transcribe.js')).default;
  app.post('/api/transcribe', transcribeHandler);
  
  // Summarize endpoint
  const summarizeHandler = (await import('./api/summarize.js')).default;
  app.post('/api/summarize', summarizeHandler);
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
loadRoutes().then(() => {
  const server = createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to load routes:', err);
  process.exit(1);
});
```

---

## مرحله 9: نصب Express و CORS

```bash
cd /var/www/cutup
npm install express cors
```

---

## مرحله 10: تغییر API_BASE_URL در popup.js

در فایل `popup.js` در کامپیوتر خود:
```javascript
// تغییر این خط:
const API_BASE_URL = 'https://cutup-4kttf5m37-hamidreza-askarizadehs-projects.vercel.app';

// به این:
const API_BASE_URL = 'http://195.248.240.108:3000';
// یا اگر domain دارید:
// const API_BASE_URL = 'https://yourdomain.com';
```

---

## مرحله 11: راه‌اندازی با PM2

```bash
cd /var/www/cutup

# ایجاد فایل ecosystem.config.js
nano ecosystem.config.js
```

محتوای فایل:
```javascript
module.exports = {
  apps: [{
    name: 'cutup-api',
    script: 'server.js',
    instances: 2, // تعداد instance ها
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: '/var/log/cutup/error.log',
    out_file: '/var/log/cutup/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G'
  }]
};
```

```bash
# ایجاد دایرکتوری log
mkdir -p /var/log/cutup

# راه‌اندازی با PM2
pm2 start ecosystem.config.js

# ذخیره تنظیمات PM2
pm2 save

# تنظیم auto-start در boot
pm2 startup
# دستور خروجی را اجرا کنید
```

---

## مرحله 12: تنظیم Firewall

```bash
# نصب ufw (اگر نصب نیست)
apt install -y ufw

# باز کردن پورت‌های ضروری
ufw allow 22/tcp    # SSH
ufw allow 3000/tcp  # API
ufw allow 80/tcp    # HTTP (برای Nginx)
ufw allow 443/tcp  # HTTPS (برای Nginx)

# فعال کردن firewall
ufw enable

# بررسی وضعیت
ufw status
```

---

## مرحله 13: (اختیاری) تنظیم Nginx به عنوان Reverse Proxy

```bash
# نصب Nginx
apt install -y nginx

# ایجاد فایل تنظیمات
nano /etc/nginx/sites-available/cutup
```

محتوای فایل:
```nginx
server {
    listen 80;
    server_name 195.248.240.108; # یا domain شما

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# فعال کردن سایت
ln -s /etc/nginx/sites-available/cutup /etc/nginx/sites-enabled/

# تست تنظیمات
nginx -t

# راه‌اندازی مجدد Nginx
systemctl restart nginx
systemctl enable nginx
```

---

## مرحله 14: تست API

```bash
# تست از سرور
curl http://localhost:3000/api/upload

# یا از کامپیوتر خود
curl http://195.248.240.108:3000/api/upload
```

---

## مرحله 15: مانیتورینگ

```bash
# مشاهده لاگ‌های PM2
pm2 logs cutup-api

# مشاهده وضعیت
pm2 status

# مشاهده استفاده از منابع
pm2 monit
```

---

## 🔧 دستورات مفید

### راه‌اندازی مجدد
```bash
pm2 restart cutup-api
```

### توقف
```bash
pm2 stop cutup-api
```

### مشاهده لاگ‌ها
```bash
pm2 logs cutup-api --lines 100
```

### حذف از PM2
```bash
pm2 delete cutup-api
```

---

## ⚠️ نکات مهم

1. **امنیت:**
   - حتماً SSH Key استفاده کنید
   - Firewall را فعال کنید
   - از Password قوی استفاده کنید

2. **Backup:**
   - به صورت منظم از کد backup بگیرید
   - از PM2 برای auto-restart استفاده کنید

3. **Monitoring:**
   - لاگ‌ها را بررسی کنید
   - استفاده از CPU و RAM را مانیتور کنید

4. **Domain:**
   - اگر domain دارید، آن را به IP سرور متصل کنید
   - SSL Certificate نصب کنید (Let's Encrypt)

---

## 🆘 عیب‌یابی

### اگر API کار نمی‌کند:
```bash
# بررسی وضعیت PM2
pm2 status

# بررسی لاگ‌ها
pm2 logs cutup-api

# بررسی پورت
netstat -tulpn | grep 3000
```

### اگر فایل آپلود نمی‌شود:
- بررسی `client_max_body_size` در Nginx
- بررسی محدودیت‌های Express

---

## 📞 پشتیبانی

اگر مشکلی پیش آمد، لاگ‌ها را بررسی کنید و به من اطلاع دهید.

