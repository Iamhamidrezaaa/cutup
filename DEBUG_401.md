# رفع مشکل 401 - API Key Never Used

## 🔍 مشکل
- API Key در OpenAI Dashboard نشان می‌دهد "never used"
- یعنی درخواست اصلاً به OpenAI نمی‌رسد
- احتمالاً API Key در Vercel تنظیم نشده یا deploy نشده

## ✅ راه‌حل مرحله‌ای

### مرحله 1: بررسی API Key در Vercel (از Terminal)

```bash
# بررسی Environment Variables
vercel env ls
```

باید `OPENAI_API_KEY` را در لیست ببینید.

### مرحله 2: تنظیم API Key (اگر وجود ندارد)

```bash
# اضافه کردن API Key
vercel env add OPENAI_API_KEY production
```

وقتی از شما خواست:
1. Environment را انتخاب کنید: `production` (یا `all`)
2. مقدار را paste کنید:
```
YOUR_OPENAI_API_KEY
```

### مرحله 3: Deploy مجدد

```bash
vercel --prod
```

**⚠️ مهم**: بعد از تنظیم Environment Variable، حتماً باید deploy کنید.

### مرحله 4: پیدا کردن Logs در Vercel

**روش 1: از Dashboard**
1. به https://vercel.com بروید و لاگین کنید
2. پروژه `cutup` را باز کنید
3. به تب **"Deployments"** بروید
4. آخرین deployment را باز کنید
5. روی **"Functions"** کلیک کنید
6. `api/transcribe` را باز کنید
7. لاگ‌ها را ببینید

**روش 2: از Terminal**
```bash
# مشاهده لاگ‌های زنده
vercel logs --follow
```

### مرحله 5: تست مستقیم API

برای اطمینان از اینکه API کار می‌کند، می‌توانید مستقیماً تست کنید:

```bash
# تست transcribe endpoint
curl -X POST https://cutup-a0p9oqk9z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audioUrl": "data:audio/mpeg;base64,test"}'
```

یا از Postman/Insomnia استفاده کنید.

## 🔧 بررسی‌های اضافی

### بررسی 1: مطمئن شوید API Key درست است

در Terminal:
```bash
# بررسی مقدار Environment Variable
vercel env pull .env.local
cat .env.local
```

باید `OPENAI_API_KEY` را با مقدار کامل ببینید.

### بررسی 2: بررسی در کد

در `api/transcribe.js` خط 14-15 باید این لاگ‌ها را ببینید:
```javascript
console.log("HAS_KEY", !!process.env.OPENAI_API_KEY);
console.log("KEY_PREFIX", process.env.OPENAI_API_KEY?.slice(0, 7));
```

در لاگ‌های Vercel باید ببینید:
```
HAS_KEY true
KEY_PREFIX sk-proj
```

اگر `HAS_KEY false` باشد، یعنی API Key تنظیم نشده.

## 🐛 خطای "No such renderer"

این خطا معمولاً مربوط به افزونه Chrome است. برای رفع:

1. افزونه را **Remove** کنید
2. Chrome را **Restart** کنید
3. دوباره **Load unpacked** کنید

یا:

1. به `chrome://extensions/` بروید
2. روی **"Reload"** کلیک کنید
3. Console را باز کنید (F12)
4. دوباره تست کنید

## ✅ چک‌لیست نهایی

- [ ] `vercel env ls` اجرا شده و `OPENAI_API_KEY` وجود دارد
- [ ] API Key کامل و بدون فاصله کپی شده
- [ ] `vercel --prod` بعد از تنظیم API Key اجرا شده
- [ ] لاگ‌ها در Vercel بررسی شده (`HAS_KEY true` باید باشد)
- [ ] افزونه در Chrome reload شده
- [ ] تست مستقیم API انجام شده

## 🚨 اگر هنوز کار نمی‌کند

1. **بررسی API Key در OpenAI**:
   - به https://platform.openai.com/api-keys بروید
   - مطمئن شوید API Key فعال است
   - اگر "never used" است، یعنی درخواست اصلاً نمی‌رسد

2. **تست با curl**:
   ```bash
   curl -X POST https://cutup-a0p9oqk9z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe \
     -H "Content-Type: application/json" \
     -d '{"audioUrl": "data:audio/mpeg;base64,test"}' \
     -v
   ```
   
   اگر 401 می‌دهد، API Key مشکل دارد.
   اگر 500 می‌دهد، مشکل دیگری است.

3. **بررسی vercel.json**:
   مطمئن شوید که `vercel.json` درست است و routes درست تنظیم شده.

