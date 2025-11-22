# چک‌لیست Deploy و رفع مشکل 401

## ✅ تغییرات انجام شده

### 1. استفاده از OpenAI SDK
- [x] `openai` package به `package.json` اضافه شد
- [x] `api/transcribe.js` با OpenAI SDK بازنویسی شد
- [x] `api/summarize.js` با OpenAI SDK بازنویسی شد
- [x] استفاده از `process.env.OPENAI_API_KEY` در هر دو فایل

### 2. لاگ‌های بهتر
- [x] لاگ‌های دقیق برای دیباگ اضافه شد
- [x] خطاهای OpenAI به صورت کامل لاگ می‌شوند
- [x] بررسی وجود API Key قبل از استفاده

### 3. manifest.json
- [x] `host_permissions` برای دامین Vercel اضافه شد

### 4. popup.js
- [x] مسیرهای API به `/api/transcribe` و `/api/summarize` اصلاح شد

## 🚀 مراحل Deploy

### 1. نصب Dependencies

```bash
npm install
```

این دستور `openai` package را نصب می‌کند.

### 2. بررسی API Key در Vercel

```bash
# بررسی Environment Variables
vercel env ls
```

مطمئن شوید که `OPENAI_API_KEY` وجود دارد:

```bash
# اگر وجود ندارد، اضافه کنید
vercel env add OPENAI_API_KEY production
```

سپس این مقدار را وارد کنید:
```
YOUR_OPENAI_API_KEY
```

### 3. Deploy

```bash
vercel --prod
```

### 4. بررسی Logs

بعد از deploy، در Vercel Dashboard:
1. به پروژه بروید
2. Functions → Logs
3. یک درخواست تست بفرستید
4. لاگ‌ها را بررسی کنید

## 🔍 عیب‌یابی 401

### بررسی 1: API Key در Vercel

```bash
# بررسی کنید که API Key تنظیم شده
vercel env ls
```

اگر `OPENAI_API_KEY` وجود ندارد یا مقدار آن اشتباه است:

```bash
# حذف (اگر وجود دارد)
vercel env rm OPENAI_API_KEY production

# اضافه کردن مجدد
vercel env add OPENAI_API_KEY production
```

### بررسی 2: بررسی در کد

در `api/transcribe.js` و `api/summarize.js`:

```javascript
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,  // ✅ باید این باشد
});
```

**❌ اشتباه:**
```javascript
apiKey: process.env.OPENAI_KEY,  // ❌
apiKey: process.env.OPENAT_API_KEY,  // ❌
```

### بررسی 3: لاگ‌ها

بعد از deploy، در Vercel Logs باید ببینید:

```
TRANSCRIBE: Processing audio file, size: 12345 bytes, type: audio/mpeg
TRANSCRIBE: Success, text length: 500
```

اگر خطا دارید:
```
TRANSCRIBE_ERROR: {
  message: "...",
  status: 401,
  response: { ... }
}
```

### بررسی 4: تست API مستقیماً

```bash
# تست transcribe endpoint
curl -X POST https://cutup-a0p9oqk9z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audioUrl": "data:audio/mpeg;base64,..."}'
```

## ✅ چک‌لیست نهایی

قبل از تست افزونه:

- [ ] `npm install` اجرا شده
- [ ] `OPENAI_API_KEY` در Vercel تنظیم شده
- [ ] `vercel --prod` اجرا شده
- [ ] لاگ‌ها در Vercel بررسی شده
- [ ] افزونه در Chrome reload شده
- [ ] Console باز است (F12) برای بررسی خطاها

## 🐛 مشکلات رایج

### خطای "OPENAI_API_KEY is not set"
**علت**: API Key در Vercel تنظیم نشده
**راه حل**: `vercel env add OPENAI_API_KEY production`

### خطای 401 Unauthorized
**علت**: API Key اشتباه یا منقضی شده
**راه حل**: 
1. API Key را در Vercel بررسی کنید
2. مطمئن شوید که کامل و بدون فاصله است
3. اگر قدیمی است، یک API Key جدید از OpenAI بگیرید

### خطای "File is not defined"
**علت**: Node.js version قدیمی است
**راه حل**: Vercel از Node.js 18+ استفاده می‌کند که `File` را پشتیبانی می‌کند

### خطای CORS
**علت**: دامین در `manifest.json` اضافه نشده
**راه حل**: `host_permissions` را بررسی کنید

## 📞 بعد از رفع مشکل

اگر همه چیز کار کرد:
1. [ ] یک فایل صوتی تست کنید
2. [ ] نتایج را بررسی کنید
3. [ ] لاگ‌ها را در Vercel چک کنید
4. [ ] اگر همه چیز درست بود، آماده برای استفاده است! 🎉

