# راهنمای نهایی تنظیم API Key

## ✅ وضعیت فعلی

Environment Variables شما:
- ✅ Production - تنظیم شده (44 دقیقه پیش)
- ✅ Development - تنظیم شده (15 ثانیه پیش)
- ⚠️ Preview - تنظیم نشده

## 🔧 اضافه کردن برای Preview (اختیاری اما توصیه می‌شود)

```bash
vercel env add OPENAI_API_KEY
```

وقتی از شما خواست:
1. مقدار را وارد کنید: `YOUR_OPENAI_API_KEY`
2. Environment را انتخاب کنید: **Preview** (یا همه را انتخاب کنید)

## 🚀 Deploy مجدد

بعد از تنظیم Environment Variables، **حتماً باید deploy کنید**:

```bash
vercel --prod
```

## ✅ بررسی

بعد از deploy:

1. **تست از افزونه**:
   - افزونه را باز کنید
   - یک فایل صوتی انتخاب کنید
   - روی "خلاصه‌سازی" کلیک کنید

2. **بررسی لاگ‌ها**:
   - به Vercel Dashboard بروید
   - Deployments → آخرین deployment
   - Functions → `api/transcribe`
   - لاگ‌ها را ببینید

در لاگ‌ها باید ببینید:
```
TRANSCRIBE: Environment check: {
  hasProcess: true,
  hasEnv: true,
  apiKeyPresent: true,
  apiKeyPrefix: "sk-proj-...",
  allEnvKeys: ["OPENAI_API_KEY"]
}
```

## 🐛 اگر هنوز 401 می‌دهد

1. **مطمئن شوید deploy شده**:
   ```bash
   vercel ls
   ```
   آخرین deployment باید کمتر از 1 دقیقه پیش باشد.

2. **بررسی لاگ‌ها**:
   اگر `apiKeyPresent: false` است، یعنی Environment Variable در runtime در دسترس نیست.

3. **تست مستقیم**:
   ```bash
   curl -X POST https://cutup-dlmwpf6z4-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
     -H "Content-Type: application/json" \
     -d "{\"audioUrl\": \"data:audio/mpeg;base64,test\"}"
   ```

## 📋 چک‌لیست نهایی

- [x] API Key برای Production تنظیم شده
- [x] API Key برای Development تنظیم شده
- [ ] API Key برای Preview تنظیم شده (اختیاری)
- [ ] `vercel --prod` اجرا شده
- [ ] افزونه تست شده
- [ ] لاگ‌ها بررسی شده

## 🎯 بعد از رفع مشکل

وقتی همه چیز کار کرد:
1. یک فایل صوتی واقعی تست کنید
2. منتظر نتیجه بمانید (30-60 ثانیه)
3. اگر موفق بود، آماده است! 🎉

