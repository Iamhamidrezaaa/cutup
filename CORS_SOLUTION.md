# راه‌حل نهایی CORS

## 🔍 مشکل
خطای CORS یعنی preflight request (OPTIONS) درست handle نمی‌شود یا CORS headers درست تنظیم نشده‌اند.

## ✅ تغییرات انجام شده

1. **فایل `api/cors.js` ایجاد شد** - یک helper function برای CORS
2. **همه API endpoints از cors.js استفاده می‌کنند**
3. **CORS headers در همه حالات (موفق، خطا) تنظیم می‌شوند**

## 🚀 Deploy مجدد

```bash
vercel --prod
```

## 🧪 تست CORS

بعد از deploy، می‌توانید مستقیماً تست کنید:

### از Terminal (PowerShell):
```powershell
# تست OPTIONS request
Invoke-WebRequest -Uri "https://cutup-dlmwpf6z4-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method OPTIONS `
  -Headers @{
    "Origin" = "chrome-extension://test"
    "Access-Control-Request-Method" = "POST"
    "Access-Control-Request-Headers" = "Content-Type"
  } `
  -UseBasicParsing
```

باید این هدرها را ببینید:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Accept, Origin
```

## 🔧 اگر هنوز کار نمی‌کند

### بررسی 1: مطمئن شوید deployment جدید انجام شده
```bash
vercel ls
```
آخرین deployment باید کمتر از 1 دقیقه پیش باشد.

### بررسی 2: بررسی لاگ‌ها
در Vercel Dashboard → Deployments → آخرین deployment → Logs

باید این را ببینید:
```
CORS: Handling OPTIONS preflight request
```

### بررسی 3: تست مستقیم API
```powershell
$body = @{
    audioUrl = "data:audio/mpeg;base64,test"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://cutup-dlmwpf6z4-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## 📋 چک‌لیست

- [x] فایل cors.js ایجاد شد
- [x] همه endpoints از cors.js استفاده می‌کنند
- [ ] `vercel --prod` اجرا شده
- [ ] افزونه reload شده
- [ ] تست انجام شده

## 🎯 بعد از رفع CORS

وقتی CORS رفع شد:
1. باید خطای 401 را ببینید (اگر API Key مشکل دارد)
2. یا درخواست موفق شود (اگر همه چیز درست است)

## ⚠️ نکته مهم

**مشکل از OpenAI API Key نیست** - مشکل از CORS است. API Key فقط وقتی استفاده می‌شود که CORS رفع شود و درخواست POST به endpoint برسد.

