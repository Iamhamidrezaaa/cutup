# رفع مشکل CORS

## 🔍 مشکل
خطای CORS یعنی درخواست preflight (OPTIONS) درست handle نمی‌شود یا هدرهای CORS درست تنظیم نشده‌اند.

## ✅ تغییرات انجام شده

1. **CORS headers بهبود یافت**:
   - `Access-Control-Allow-Origin: *`
   - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With`
   - `Access-Control-Max-Age: 86400`

2. **OPTIONS request handling بهبود یافت**:
   - لاگ اضافه شد برای دیباگ
   - پاسخ سریع‌تر

## 🚀 Deploy مجدد

```bash
vercel --prod
```

## 🧪 تست

بعد از deploy:

1. **از افزونه**:
   - افزونه را reload کنید
   - یک فایل صوتی انتخاب کنید
   - تست کنید

2. **از Console**:
   - Console را باز کنید (F12)
   - خطاهای CORS را بررسی کنید

3. **مستقیم از Terminal**:
   ```bash
   curl -X OPTIONS https://cutup-dlmwpf6z4-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
     -H "Origin: chrome-extension://dfiblkodfhpmgkbopkddcmifpjbcdiih" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -v
   ```

   باید این هدرها را ببینید:
   ```
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
   Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
   ```

## 🐛 اگر هنوز CORS می‌دهد

### بررسی 1: مطمئن شوید deploy شده
```bash
vercel ls
```

### بررسی 2: بررسی لاگ‌ها
در Vercel Dashboard → Deployments → Functions → `api/transcribe`

باید این را ببینید:
```
TRANSCRIBE: Handling OPTIONS preflight request
```

### بررسی 3: تست مستقیم
```bash
curl -X POST https://cutup-dlmwpf6z4-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
  -H "Content-Type: application/json" \
  -H "Origin: chrome-extension://test" \
  -d "{\"audioUrl\": \"data:audio/mpeg;base64,test\"}" \
  -v
```

## 📋 چک‌لیست

- [x] CORS headers بهبود یافت
- [x] OPTIONS handling بهبود یافت
- [ ] `vercel --prod` اجرا شده
- [ ] افزونه reload شده
- [ ] تست انجام شده

## 🎯 بعد از رفع CORS

وقتی CORS رفع شد، باید خطای 401 را ببینید (اگر API Key مشکل دارد) یا درخواست موفق شود.

