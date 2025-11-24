# رفع مشکل endpoint plans

## مشکل
endpoint `/api/subscription?action=plans` خطای 401 (Unauthorized) می‌دهد.

## علت
endpoint `plans` نیاز به session ندارد اما چک sessionId قبل از آن قرار داشت.

## راه‌حل

### 1. آپلود فایل
فایل `api/subscription.js` را آپلود کنید.

### 2. Restart PM2
```bash
pm2 restart cutup-api
```

### 3. بررسی لاگ‌ها
```bash
pm2 logs cutup-api --lines 50
```

### 4. تست endpoint
```bash
curl https://cutup.shop/api/subscription?action=plans
```

باید response زیر را ببینید:
```json
{
  "plans": [
    {
      "id": "free",
      "name": "رایگان",
      ...
    },
    {
      "id": "starter",
      "name": "Starter",
      ...
    },
    ...
  ]
}
```

---

## تغییرات اعمال شده

1. endpoint `plans` را قبل از چک sessionId قرار دادم
2. `handleCORS` را به `setCORSHeaders` تغییر دادم تا CORS headers همیشه set شوند

---

## اگر هنوز مشکل دارید

1. بررسی کنید که فایل `api/subscription.js` در سرور به‌روز شده است:
```bash
grep "Get all plans" /var/www/cutup/api/subscription.js
```

2. بررسی کنید که PM2 restart شده:
```bash
pm2 status
pm2 logs cutup-api --lines 20
```

3. بررسی کنید که endpoint درست کار می‌کند:
```bash
curl -v https://cutup.shop/api/subscription?action=plans
```

