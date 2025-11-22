# Force Deploy کد جدید

## 🔍 مشکل

لاگ‌ها نشان می‌دهند که کد جدید deploy نشده:
- لاگ `=== TRANSCRIBE V4.0 ===` دیده نمی‌شود
- هنوز از OpenAI SDK استفاده می‌شود (`OpenAI.makeRequest`)
- خطا در خط 112 رخ می‌دهد (کد قدیمی)

## ✅ راه‌حل - Force Deploy

### 1. Clear Build Cache

در Vercel Dashboard:
1. به **Settings** > **General** بروید
2. به پایین صفحه بروید
3. روی **"Clear Build Cache"** کلیک کنید
4. تأیید کنید

### 2. Deploy با Force

در Terminal:

```bash
# 1. مطمئن شوید که در directory پروژه هستید
cd "E:\Machine Learning\cutup"

# 2. Dependencies را نصب کنید
npm install

# 3. Force deploy
vercel --prod --force
```

### 3. بررسی Deployment

بعد از deploy:
1. به Vercel Dashboard بروید
2. به **Deployments** بروید
3. مطمئن شوید که deployment جدید (با timestamp جدید) ساخته شده
4. روی deployment جدید کلیک کنید
5. به **Runtime Logs** بروید

### 4. بررسی لاگ‌ها

بعد از یک درخواست تست، باید این لاگ‌ها را ببینید:

```
=== TRANSCRIBE FUNCTION CALLED ===
TRANSCRIBE: Processing audio file, size: 64221 bytes, type: audio/mpeg
=== TRANSCRIBE V4.0: NO OpenAI SDK - Using node-fetch directly ===  ← این باید باشد!
=== TRANSCRIBE V4.0: Using node-fetch (NO SDK) ===
TRANSCRIBE V4.0: Attempt 1/5 starting...
TRANSCRIBE V4.0: Sending request to OpenAI API (attempt 1)...
```

اگر این لاگ‌ها را نمی‌بینید:
- Deployment جدید انجام نشده
- یا function قدیمی هنوز در حال اجرا است

## 🔧 اگر هنوز مشکل دارید

### راه‌حل 1: Delete و Recreate Deployment

1. در Vercel Dashboard، به **Deployments** بروید
2. روی deployment قدیمی کلیک کنید
3. روی **"..."** کلیک کنید
4. **"Delete"** را انتخاب کنید
5. دوباره `vercel --prod` را اجرا کنید

### راه‌حل 2: بررسی Git Integration

اگر از Git استفاده می‌کنید:
1. تغییرات را commit کنید
2. push کنید
3. Vercel باید خودکار deploy کند

### راه‌حل 3: بررسی vercel.json

مطمئن شوید که `vercel.json` درست است و routes درست تنظیم شده‌اند.

## 📋 چک‌لیست

- [ ] Build Cache cleared شده
- [ ] `npm install` اجرا شده
- [ ] `vercel --prod --force` اجرا شده
- [ ] Deployment جدید ساخته شده
- [ ] لاگ `=== TRANSCRIBE V4.0 ===` دیده می‌شود
- [ ] Retry logic کار می‌کند

## 🎯 بعد از Deploy

وقتی deployment جدید انجام شد و لاگ `V4.0` را دیدید:
1. یک فایل صوتی کوچک تست کنید
2. لاگ‌های کامل را بررسی کنید
3. اگر retry logic کار می‌کند، باید ببینید که 5 بار تلاش می‌شود



