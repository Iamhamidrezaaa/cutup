# بررسی Environment Variables در Vercel

## 🔍 مراحل بررسی

### 1. بررسی Environment Variables

در Vercel Dashboard:

1. به https://vercel.com بروید
2. پروژه `cutup` را باز کنید
3. به **Settings** → **Environment Variables** بروید
4. بررسی کنید که `OPENAI_API_KEY` وجود دارد

**باید ببینید:**
- Key: `OPENAI_API_KEY`
- Value: `Encrypted` (مقدار نمایش داده نمی‌شود)
- Environments: باید شامل `Production` باشد

### 2. اگر وجود ندارد یا فقط Development است:

1. روی **"Add New"** کلیک کنید
2. Key: `OPENAI_API_KEY`
3. Value: `YOUR_OPENAI_API_KEY`
4. Environments: **Production** را انتخاب کنید (و Preview و Development اگر می‌خواهید)
5. روی **"Save"** کلیک کنید

### 3. Redeploy

بعد از تنظیم Environment Variable:

1. به **Deployments** بروید
2. روی deployment **Current** (`HEfp1Br3o`) کلیک کنید
3. روی **"Redeploy"** کلیک کنید
4. یا از بالای صفحه روی **"Redeploy"** کلیک کنید

**⚠️ مهم**: Environment Variables فقط در deployment بعدی اعمال می‌شوند.

### 4. بررسی لاگ‌ها

بعد از redeploy:

1. به deployment جدید بروید
2. به تب **"Logs"** بروید
3. یک درخواست تست بفرستید (از افزونه)
4. لاگ‌ها را بررسی کنید

**باید ببینید:**
```
HAS_KEY true
KEY_PREFIX sk-proj
TRANSCRIBE: Environment check: {
  apiKeyPresent: true,
  apiKeyPrefix: "sk-proj-..."
}
```

اگر `HAS_KEY false` باشد، یعنی Environment Variable درست تنظیم نشده یا deployment قبل از تنظیم انجام شده.

## 🔧 اگر Environment Variable وجود دارد اما هنوز 401 می‌دهد:

1. **مطمئن شوید برای Production تنظیم شده**:
   - در لیست Environment Variables، باید `Production` در ستون Environments باشد

2. **Redeploy کنید**:
   - Environment Variables فقط در deployment بعدی اعمال می‌شوند

3. **بررسی کنید که API Key درست است**:
   - مطمئن شوید که کامل و بدون فاصله کپی شده

## 📋 چک‌لیست

- [ ] Settings → Environment Variables بررسی شده
- [ ] `OPENAI_API_KEY` برای Production وجود دارد
- [ ] Redeploy انجام شده
- [ ] لاگ‌ها بررسی شده (`HAS_KEY true` باید باشد)
- [ ] تست انجام شده

## 🎯 بعد از رفع مشکل

وقتی Environment Variable درست تنظیم شد و redeploy کردید:
1. خطای 401 باید برطرف شود
2. درخواست به OpenAI می‌رسد
3. Transcription انجام می‌شود

