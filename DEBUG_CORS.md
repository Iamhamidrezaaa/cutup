# دیباگ CORS - Failed to fetch

## 🔍 بررسی مشکل

خطای "Failed to fetch" می‌تواند به دلایل زیر باشد:

1. **CORS هنوز مشکل دارد** - preflight request رد می‌شود
2. **درخواست اصلاً نمی‌رسد** - مشکل شبکه یا URL
3. **Deployment جدید درست کار نمی‌کند**

## ✅ مراحل بررسی

### 1. بررسی Console در Chrome

در افزونه:
1. Console را باز کنید (F12)
2. به تب "Console" بروید
3. یک درخواست تست بفرستید
4. خطای کامل را کپی کنید

باید چیزی شبیه این ببینید:
```
Access to fetch at 'https://...' from origin 'chrome-extension://...' has been blocked by CORS policy
```

یا:
```
Failed to fetch
```

### 2. بررسی Network Tab

1. Console را باز کنید (F12)
2. به تب "Network" بروید
3. یک درخواست تست بفرستید
4. درخواست `api/transcribe` را پیدا کنید
5. روی آن کلیک کنید
6. تب "Headers" را ببینید

**بررسی کنید:**
- Request URL: باید `https://cutup-ln74y877z-...` باشد
- Request Method: باید `POST` باشد
- Status Code: چه کدی است؟ (200, 401, 404, CORS error?)

### 3. تست مستقیم از Browser

در Chrome:
1. Console را باز کنید (F12)
2. این کد را اجرا کنید:

```javascript
fetch('https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe', {
  method: 'OPTIONS',
  headers: {
    'Origin': 'chrome-extension://test',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type'
  }
}).then(r => {
  console.log('Status:', r.status);
  console.log('Headers:', [...r.headers.entries()]);
  return r.text();
}).then(console.log).catch(console.error);
```

باید این هدرها را ببینید:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: ...
```

### 4. بررسی لاگ‌های Vercel

در Vercel Dashboard:
1. به deployment بروید: `HEfp1Br3opn26rwUvDeYZ5KjHpy2`
2. به تب "Logs" بروید
3. یک درخواست تست بفرستید
4. لاگ‌ها را بررسی کنید

باید این را ببینید:
```
CORS: Handling OPTIONS preflight request
```

یا:
```
TRANSCRIBE: Request method: POST
```

## 🔧 راه‌حل‌های احتمالی

### اگر CORS هنوز مشکل دارد:

1. **مطمئن شوید deployment جدید انجام شده**:
   ```bash
   vercel ls
   ```
   آخرین deployment باید `cutup-ln74y877z-...` باشد

2. **بررسی کنید که فایل cors.js deploy شده**:
   در Vercel Dashboard → Source → بررسی کنید که `api/cors.js` وجود دارد

3. **تست مستقیم OPTIONS**:
   ```bash
   curl -X OPTIONS https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
     -H "Origin: chrome-extension://test" \
     -H "Access-Control-Request-Method: POST" \
     -v
   ```

### اگر درخواست اصلاً نمی‌رسد:

1. **بررسی URL**:
   مطمئن شوید که `API_BASE_URL` در `popup.js` درست است

2. **بررسی manifest.json**:
   مطمئن شوید که `host_permissions` شامل URL جدید است

3. **بررسی Network**:
   در Console → Network، ببینید آیا درخواست ارسال می‌شود یا نه

## 📋 اطلاعات مورد نیاز

برای کمک بیشتر، لطفاً این اطلاعات را بفرستید:

1. **خطای کامل از Console** (کپی کنید)
2. **Status Code از Network tab**
3. **لاگ‌های Vercel** (اگر در دسترس است)
4. **نتیجه تست مستقیم OPTIONS** (از Console)

## 🎯 بعد از بررسی

وقتی اطلاعات را جمع کردید، می‌توانیم دقیق‌تر مشکل را پیدا کنیم و حل کنیم.

