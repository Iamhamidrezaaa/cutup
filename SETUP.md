# راهنمای راه‌اندازی Cutup

## پیش‌نیازها

1. **Chrome Browser** (نسخه 88+)
2. **Node.js** (برای Backend - نسخه 18+)
3. **حساب OpenAI** با API Key
4. **حساب Vercel** (یا Render) برای هاستینگ Backend

## مراحل راه‌اندازی

### 1. راه‌اندازی Backend (Vercel)

#### الف) نصب Vercel CLI

```bash
npm install -g vercel
```

#### ب) لاگین به Vercel

```bash
vercel login
```

#### ج) تنظیم متغیرهای محیطی

**روش 1: با CLI (پیشنهادی)**
```bash
vercel env add OPENAI_API_KEY production
```
سپس API Key را وارد کنید:
```
YOUR_OPENAI_API_KEY
```

**روش 2: از داشبورد Vercel**
1. به پروژه خود در Vercel بروید
2. Settings → Environment Variables
3. `OPENAI_API_KEY` را اضافه کنید
4. مقدار API Key را وارد کنید

#### د) Deploy کردن

```bash
cd cutup
vercel --prod
```

بعد از deploy، URL را کپی کنید (مثلاً: `https://cutup-api.vercel.app`)

### 2. تنظیم API URL در افزونه

API URL در فایل `popup.js` تنظیم شده است:

```javascript
const API_BASE_URL = 'https://cutup-a0p9oqk9z-hamidreza-askarizadehs-projects.vercel.app';
```

### 3. ساخت آیکون‌های افزونه

به پوشه `icons/` بروید و فایل‌های زیر را بسازید:
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

می‌توانید از SVG موجود در `icons/README.md` استفاده کنید.

### 4. نصب افزونه در Chrome

1. Chrome را باز کنید
2. به `chrome://extensions/` بروید
3. "Developer mode" را در گوشه بالا-راست فعال کنید
4. روی "Load unpacked" کلیک کنید
5. پوشه `cutup` را انتخاب کنید

### 5. تست افزونه

1. روی آیکون افزونه در نوار ابزار کلیک کنید
2. یک لینک یوتیوب یا فایل صوتی وارد کنید
3. روی "خلاصه‌سازی" کلیک کنید
4. منتظر نتیجه بمانید

## نکات مهم

### استخراج صوت از یوتیوب

برای استخراج صوت از یوتیوب، باید یک سرویس backend اضافه کنید. گزینه‌ها:

1. **استفاده از yt-dlp** (پیشنهادی):
   - در Vercel نمی‌توانید مستقیماً از yt-dlp استفاده کنید
   - باید از یک سرویس جداگانه استفاده کنید

2. **استفاده از API شخص ثالث**:
   - YouTube Data API (محدودیت دارد)
   - سرویس‌های شخص ثالث مثل RapidAPI

3. **راه‌حل موقت برای MVP**:
   - کاربر باید فایل صوتی را خودش دانلود و آپلود کند
   - یا از یک سرویس جداگانه برای استخراج استفاده کنید

### بهبودهای آینده

- [ ] پیاده‌سازی استخراج صوت از یوتیوب
- [ ] اضافه کردن Progress bar برای پردازش
- [ ] پشتیبانی از فرمت‌های بیشتر
- [ ] بهبود UI/UX
- [ ] اضافه کردن Export به PDF/Word

## عیب‌یابی

### خطای CORS

اگر خطای CORS دریافت کردید، مطمئن شوید که در API endpoints، هدرهای CORS را اضافه کرده‌اید.

### خطای API Key

اگر خطای "API Key is not set" دریافت کردید:
1. مطمئن شوید که `OPENAI_API_KEY` را در Vercel تنظیم کرده‌اید
2. بعد از تنظیم، دوباره deploy کنید

### افزونه کار نمی‌کند

1. Console را باز کنید (F12)
2. به تب Extensions بروید
3. روی "Errors" کلیک کنید
4. خطاها را بررسی کنید

## پشتیبانی

برای سوالات و مشکلات، لطفاً Issue در GitHub باز کنید.

