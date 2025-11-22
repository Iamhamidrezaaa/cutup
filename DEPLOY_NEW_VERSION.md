# Deploy کد جدید با Retry Logic

## 🔍 مشکل

لاگ‌ها نشان می‌دهند که کد جدید deploy نشده است:
- لاگ `TRANSCRIBE: VERSION 2.0 - Retry logic enabled` دیده نمی‌شود
- لاگ `TRANSCRIBE: Calling OpenAI Whisper API with retry logic...` دیده نمی‌شود
- لاگ `TRANSCRIBE: Attempt 1/3...` دیده نمی‌شود

## ✅ راه‌حل

### 1. Deploy جدید

```bash
vercel --prod
```

### 2. بررسی Deployment

بعد از deploy:
1. به Vercel Dashboard بروید
2. به Deployments بروید
3. مطمئن شوید که deployment جدید (با timestamp جدید) ساخته شده
4. روی deployment جدید کلیک کنید
5. به Runtime Logs بروید

### 3. بررسی لاگ‌ها

بعد از یک درخواست تست، باید این لاگ‌ها را ببینید:

```
TRANSCRIBE: Processing audio file, size: 11926 bytes, type: audio/ogg
TRANSCRIBE: VERSION 2.0 - Retry logic enabled
=== TRANSCRIBE: Starting OpenAI API call with retry logic ===
TRANSCRIBE: Calling OpenAI Whisper API with retry logic...
TRANSCRIBE: Attempt 1/3...
TRANSCRIBE: File size: 11926 bytes, type: audio/ogg
```

اگر این لاگ‌ها را نمی‌بینید، یعنی:
- Deployment جدید انجام نشده
- یا function قدیمی هنوز در حال اجرا است

### 4. اگر هنوز مشکل دارید

1. **Clear Vercel Cache:**
   - در Vercel Dashboard، به Settings > General بروید
   - روی "Clear Build Cache" کلیک کنید

2. **Redeploy:**
   ```bash
   vercel --prod --force
   ```

3. **بررسی vercel.json:**
   - مطمئن شوید که `vercel.json` درست است
   - مطمئن شوید که routes درست تنظیم شده‌اند

## 📋 چک‌لیست

- [ ] `vercel --prod` اجرا شده
- [ ] Deployment جدید ساخته شده
- [ ] لاگ `TRANSCRIBE: VERSION 2.0` دیده می‌شود
- [ ] لاگ `TRANSCRIBE: Attempt 1/3...` دیده می‌شود
- [ ] Retry logic کار می‌کند

## 🎯 بعد از Deploy

وقتی deployment جدید انجام شد:
1. یک فایل صوتی کوچک تست کنید
2. لاگ‌های کامل را بررسی کنید
3. اگر retry logic کار می‌کند، باید ببینید که 3 بار تلاش می‌شود



