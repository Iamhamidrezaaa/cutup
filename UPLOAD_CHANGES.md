# راهنمای آپلود تغییرات جدید

## 📁 فایل‌هایی که باید آپلود شوند

### فایل‌های جدید:
- `api/youtube-download.js`
- `api/youtube-formats.js`
- `api/subscription.js`
- `website/dashboard.html`
- `website/dashboard.css`
- `website/dashboard.js`

### فایل‌های ویرایش شده:
- `server.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `website/index.html`
- `website/style.css`
- `website/script.js`
- `api/auth.js`
- `package.json`

---

## 🔧 دستورات سرور

### 1. نصب google-auth-library

```bash
cd /var/www/cutup
npm install google-auth-library
```

### 2. بررسی نصب

```bash
npm list google-auth-library
```

باید خروجی مشابه این را ببینید:
```
cutup@1.0.0
└── google-auth-library@9.x.x
```

### 3. Restart سرور

```bash
pm2 restart cutup-api
```

یا:

```bash
pm2 restart all
```

### 4. بررسی لاگ‌ها

```bash
pm2 logs cutup-api --lines 50
```

باید ببینید که همه route‌ها لود شده‌اند:
```
All routes loaded successfully
   POST /api/upload
   POST /api/transcribe
   ...
   POST /api/youtube-download
   POST /api/youtube-formats
   GET  /api/subscription?action=info
   ...
```

---

## ✅ تست سریع

### 1. تست API Health

```bash
curl https://cutup.shop/api/health
```

باید `{"status":"ok",...}` برگردد.

### 2. تست Auth Login

```bash
curl https://cutup.shop/api/auth?action=login
```

باید `{"authUrl":"https://accounts.google.com/..."}` برگردد.

### 3. تست Subscription Plans

```bash
curl https://cutup.shop/api/subscription?action=plans
```

باید لیست پلن‌ها برگردد.

---

## 🎯 بعد از آپلود

1. **افزونه را reload کنید:**
   - به `chrome://extensions/` بروید
   - روی "Reload" کلیک کنید

2. **Cache مرورگر را پاک کنید:**
   - `Ctrl+Shift+R` (یا `Cmd+Shift+R` در Mac)

3. **تست کنید:**
   - لاگین در افزونه
   - لاگین در سایت
   - همگام‌سازی session
   - دانلود از یوتیوب
   - خلاصه‌سازی با محدودیت

---

## ⚠️ نکات مهم

- اگر خطای `google-auth-library` دیدید، مطمئن شوید که `npm install` را اجرا کرده‌اید
- اگر route‌ها لود نشدند، `server.js` را بررسی کنید
- اگر session sync نمی‌شود، چند ثانیه صبر کنید (polling هر 2 ثانیه چک می‌کند)

