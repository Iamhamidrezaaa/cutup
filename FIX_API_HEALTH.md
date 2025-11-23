# حل مشکل API Health Endpoint

## 🔍 مشکل

- Endpoint در backend: `/health`
- درخواست از frontend: `/api/health`
- Nginx proxy_pass: `/api/` → `http://localhost:3001/api/`
- نتیجه: `http://localhost:3001/api/health` که وجود ندارد!

## ✅ راه حل

### گزینه 1: تغییر endpoint در backend (پیشنهادی)

```bash
cd /var/www/cutup
nano server.js
```

**پیدا کنید:**
```javascript
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

**تغییر دهید به:**
```javascript
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
```

**ذخیره:** `Ctrl+X` سپس `Y` سپس `Enter`

```bash
# Restart PM2
pm2 restart cutup-api

# بررسی لاگ
pm2 logs cutup-api --lines 20
```

### گزینه 2: تنظیم Nginx برای proxy کردن `/api/health` به `/health`

```bash
nano /etc/nginx/sites-available/cutup.shop
```

**در بخش `location /api/` اضافه کنید:**

```nginx
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
    
    client_max_body_size 100M;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
}

# Health check endpoint (مستقیم به /health)
location /api/health {
    proxy_pass http://localhost:3001/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**ذخیره:** `Ctrl+X` سپس `Y` سپس `Enter`

```bash
# تست Nginx
nginx -t

# Restart Nginx
systemctl restart nginx
```

## 🎯 پیشنهاد

**گزینه 1 بهتر است** چون:
- ساده‌تر است
- همه endpoint ها در `/api/` هستند
- یکنواخت‌تر است

## ✅ تست

بعد از اعمال تغییرات:

```bash
# از سرور
curl http://localhost:3001/api/health

# از کامپیوتر
curl https://cutup.shop/api/health
```

**باید این خروجی را ببینید:**
```json
{"status":"ok","timestamp":"2025-11-23T..."}
```

