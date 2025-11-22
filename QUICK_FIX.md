# راه‌حل سریع - Failed to fetch

## ✅ تغییرات انجام شده

1. **manifest.json به‌روز شد**:
   - URL قدیمی حذف شد
   - Pattern جدید اضافه شد: `https://cutup-*.vercel.app/*`
   - این یعنی همه deployment های جدید کار می‌کنند

2. **API_BASE_URL به‌روز شد**:
   - به URL جدید deployment تغییر کرد

## 🚀 مراحل بعدی

### 1. Reload افزونه (مهم!)

1. به `chrome://extensions/` بروید
2. افزونه را **Remove** کنید
3. دوباره **Load unpacked** کنید
4. یا حداقل روی **"Reload"** کلیک کنید

**⚠️ مهم**: فقط reload کردن کافی نیست، باید دوباره load کنید تا `manifest.json` جدید اعمال شود.

### 2. تست

1. افزونه را باز کنید
2. یک فایل صوتی انتخاب کنید
3. روی "خلاصه‌سازی" کلیک کنید
4. Console را باز کنید (F12)

## 🔍 بررسی

### اگر هنوز "Failed to fetch" می‌دهد:

1. **Console را باز کنید** (F12)
2. **خطای کامل را کپی کنید**
3. **به تب Network بروید**
4. **درخواست `api/transcribe` را پیدا کنید**
5. **Status Code را ببینید**

### تست مستقیم:

در Console (F12)، این کد را اجرا کنید:

```javascript
fetch('https://cutup-ln74y877z-hamidreza-askarizadehs-projects.vercel.app/api/transcribe', {
  method: 'OPTIONS',
  headers: {
    'Origin': 'chrome-extension://test'
  }
}).then(r => {
  console.log('Status:', r.status);
  console.log('CORS Headers:', {
    'Access-Control-Allow-Origin': r.headers.get('Access-Control-Allow-Origin'),
    'Access-Control-Allow-Methods': r.headers.get('Access-Control-Allow-Methods')
  });
}).catch(console.error);
```

باید `Status: 200` و CORS headers را ببینید.

## 📋 چک‌لیست

- [x] manifest.json به‌روز شد
- [x] API_BASE_URL به‌روز شد
- [ ] افزونه reload/remove و load مجدد شد
- [ ] تست انجام شد
- [ ] Console بررسی شد

## 🎯 اگر هنوز کار نمی‌کند

لطفاً این اطلاعات را بفرستید:
1. خطای کامل از Console
2. Status Code از Network tab
3. نتیجه تست مستقیم OPTIONS

