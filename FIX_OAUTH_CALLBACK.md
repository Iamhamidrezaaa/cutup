# رفع مشکل OAuth Callback

## 🔍 مشکل

وقتی Google callback می‌کند، route `/api/auth/callback` فراخوانی می‌شود اما `action` در query string نیست، پس handler نمی‌داند که باید callback را handle کند.

## ✅ راه‌حل

در `server.js`، route `/api/auth/callback` را به این صورت تغییر دادیم:

```javascript
app.get('/api/auth/callback', async (req, res) => {
  if (!authHandler) {
    return res.status(500).json({ error: 'Auth handler not loaded' });
  }
  // Set action to 'callback' for this route
  req.query.action = 'callback';
  return authHandler(req, res);
});
```

## 📝 فایل آپدیت شده

فایل `server.js` آپدیت شده است. باید آن را در سرور آپدیت کنید.

## 🔧 دستورات سرور

```bash
cd /var/www/cutup

# آپدیت server.js (از WinSCP یا git pull)
# سپس:

pm2 restart cutup-api

# بررسی لاگ‌ها
pm2 logs cutup-api --lines 50
```

## ✅ تست

بعد از restart:
1. به `https://cutup.shop` بروید
2. روی "🔐 ورود با Google" کلیک کنید
3. بعد از لاگین، باید به `https://cutup.shop?auth=success&session=...` redirect شود
4. اطلاعات کاربر باید نمایش داده شود

