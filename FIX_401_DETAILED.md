# رفع خطای 401 - راه‌حل دقیق

## 🔍 مشکل

API Key در Vercel تنظیم شده و Environment روی "all" است، اما هنوز 401 می‌دهد.

## ✅ راه‌حل مرحله‌ای

### 1. Redeploy (مهم!)

**بعد از تنظیم Environment Variable، حتماً باید redeploy کنید:**

در Vercel Dashboard:
1. به **Deployments** بروید
2. روی deployment **Current** کلیک کنید
3. روی **"Redeploy"** کلیک کنید
4. منتظر بمانید تا deployment کامل شود (حدود 20-30 ثانیه)

**⚠️ مهم**: Environment Variables فقط در deployment بعدی اعمال می‌شوند.

### 2. بررسی لاگ‌ها

بعد از redeploy:

1. به deployment جدید بروید
2. به تب **"Logs"** بروید
3. یک درخواست تست بفرستید (از افزونه)
4. لاگ‌ها را بررسی کنید

**باید این را ببینید:**
```
HAS_KEY true
KEY_PREFIX sk-proj
TRANSCRIBE: Environment check: {
  hasProcess: true,
  hasEnv: true,
  apiKeyPresent: true,
  apiKeyPrefix: "sk-proj-...",
  allEnvKeys: ["OPENAI_API_KEY"]
}
```

**اگر `HAS_KEY false` یا `apiKeyPresent: false` باشد:**
- یعنی Environment Variable در runtime در دسترس نیست
- باید دوباره redeploy کنید
- یا Environment Variable را دوباره بررسی کنید

### 3. تست مستقیم API

برای اطمینان از اینکه API Key درست است:

```bash
curl -X POST https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audioUrl\": \"data:audio/mpeg;base64,test\"}" \
  -v
```

**اگر 401 می‌دهد:**
- API Key در runtime در دسترس نیست
- باید redeploy کنید

**اگر 500 می‌دهد:**
- API Key در دسترس است اما مشکل دیگری است
- لاگ‌ها را بررسی کنید

### 4. بررسی Environment Variable

در Vercel Dashboard:

1. به **Settings** → **Environment Variables** بروید
2. `OPENAI_API_KEY` را پیدا کنید
3. مطمئن شوید که:
   - Value درست است (کامل و بدون فاصله)
   - Environments شامل **Production** است (یا "all")

### 5. اگر هنوز کار نمی‌کند

**بررسی کنید که API Key در OpenAI فعال است:**

1. به https://platform.openai.com/api-keys بروید
2. مطمئن شوید API Key فعال است
3. اگر "never used" است، یعنی درخواست اصلاً نمی‌رسد
4. اگر "last used" دارد، یعنی درخواست می‌رسد اما رد می‌شود

## 🔧 دیباگ بیشتر

برای دیباگ بهتر، می‌توانید در `popup.js` این را اضافه کنید:

```javascript
console.error('Transcribe error:', {
  status: response.status,
  statusText: response.statusText,
  error: error,
  url: `${API_BASE_URL}/api/transcribe`
});
```

این به شما کمک می‌کند که ببینید دقیقاً چه خطایی برمی‌گردد.

## 📋 چک‌لیست

- [ ] Environment Variable برای "all" تنظیم شده
- [ ] **Redeploy انجام شده** (مهم!)
- [ ] لاگ‌ها بررسی شده (`HAS_KEY true` باید باشد)
- [ ] تست مستقیم انجام شده
- [ ] افزونه reload شده

## 🎯 بعد از Redeploy

وقتی redeploy کردید:
1. منتظر بمانید تا deployment کامل شود
2. لاگ‌ها را بررسی کنید
3. دوباره تست کنید

اگر هنوز 401 می‌دهد، لاگ‌های کامل را بفرستید تا بررسی کنیم.

