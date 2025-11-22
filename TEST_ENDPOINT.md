# تست مستقیم Endpoint

## 🔍 مشکل

لاگی نشان نمی‌دهد یعنی:
- درخواست اصلاً به Vercel نمی‌رسد
- یا function اجرا نمی‌شود
- یا routing مشکل دارد

## ✅ تست مستقیم

### 1. تست OPTIONS (Preflight)

در Console مرورگر (F12):

```javascript
fetch('https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe', {
  method: 'OPTIONS'
}).then(r => {
  console.log('Status:', r.status);
  console.log('Headers:', [...r.headers.entries()]);
  return r.text();
}).then(console.log).catch(console.error);
```

**باید ببینید:**
- Status: 200
- Headers شامل CORS headers

### 2. تست POST

در Console مرورگر (F12):

```javascript
fetch('https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    audioUrl: 'data:audio/mpeg;base64,test'
  })
}).then(r => {
  console.log('Status:', r.status);
  console.log('Response:', r);
  return r.json();
}).then(console.log).catch(console.error);
```

**اگر 404 می‌دهد:**
- Routing مشکل دارد
- Function deploy نشده

**اگر 401 می‌دهد:**
- Function کار می‌کند اما API Key مشکل دارد

**اگر 500 می‌دهد:**
- Function کار می‌کند اما خطا دارد

### 3. تست از Terminal

```powershell
# تست OPTIONS
Invoke-WebRequest -Uri "https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method OPTIONS `
  -UseBasicParsing

# تست POST
$body = @{
    audioUrl = "data:audio/mpeg;base64,test"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## 🔧 بررسی Deployment

در Vercel Dashboard:

1. به **Deployments** بروید
2. روی deployment **Current** کلیک کنید
3. به تب **"Source"** بروید
4. بررسی کنید که فایل‌های `api/transcribe.js` و `api/cors.js` وجود دارند

## 🔍 بررسی Routing

در `vercel.json` باید این باشد:

```json
{
  "routes": [
    {
      "src": "/api/transcribe",
      "dest": "/api/transcribe.js"
    }
  ]
}
```

## 📋 چک‌لیست

- [ ] تست OPTIONS انجام شده
- [ ] تست POST انجام شده
- [ ] Status Code بررسی شده
- [ ] Source files بررسی شده
- [ ] vercel.json بررسی شده

## 🎯 بعد از تست

وقتی تست کردید، بگویید:
1. چه Status Code می‌دهد؟
2. چه خطایی می‌دهد؟
3. آیا Response می‌آید؟

با این اطلاعات می‌توانیم دقیق‌تر مشکل را پیدا کنیم.

