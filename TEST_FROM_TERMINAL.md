# تست از Terminal - رفع مشکل CSP

## 🔍 مشکل

از Console مرورگر نمی‌توان تست کرد چون CSP block می‌کند. باید از Terminal تست کنیم.

## ✅ تست از Terminal (PowerShell)

### 1. تست OPTIONS

```powershell
Invoke-WebRequest -Uri "https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method OPTIONS `
  -UseBasicParsing
```

**باید ببینید:**
- StatusCode: 200
- Headers شامل CORS headers

### 2. تست POST

```powershell
$body = @{
    audioUrl = "data:audio/mpeg;base64,test"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

**اگر 404 می‌دهد:**
- Routing مشکل دارد
- Function deploy نشده

**اگر 401 می‌دهد:**
- Function کار می‌کند اما API Key مشکل دارد
- باید redeploy کنید

**اگر 500 می‌دهد:**
- Function کار می‌کند اما خطا دارد
- لاگ‌ها را بررسی کنید

## 🔧 بررسی مشکل افزونه

اگر از Terminal کار می‌کند اما از افزونه کار نمی‌کند:

1. **بررسی manifest.json**:
   - مطمئن شوید `host_permissions` شامل `https://*.vercel.app/*` است

2. **بررسی Console افزونه**:
   - افزونه را باز کنید
   - Console را باز کنید (F12)
   - یک درخواست تست بفرستید
   - خطاها را ببینید

3. **بررسی Network Tab**:
   - Console → Network
   - درخواست `api/transcribe` را پیدا کنید
   - Status Code را ببینید

## 📋 چک‌لیست

- [ ] تست از Terminal انجام شده
- [ ] Status Code بررسی شده
- [ ] manifest.json بررسی شده
- [ ] Console افزونه بررسی شده
- [ ] Network Tab بررسی شده

## 🎯 بعد از تست

وقتی از Terminal تست کردید، بگویید:
1. چه Status Code می‌دهد؟
2. چه خطایی می‌دهد؟
3. آیا Response می‌آید؟

با این اطلاعات می‌توانیم دقیق‌تر مشکل را پیدا کنیم.

