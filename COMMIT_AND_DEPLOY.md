# دستورات Git و Deploy

## 📦 مرحله 1: Commit کردن تغییرات به Git

### 1.1 اضافه کردن فایل‌ها
```bash
git add api/transcribe.js
git add api/upload.js
git add api/youtube.js
git add api/translate-srt.js
git add manifest.json
git add popup.css
git add popup.html
git add popup.js
git add server.js
```

یا به صورت خلاصه:
```bash
git add api/ popup.* manifest.json server.js
```

### 1.2 Commit کردن
```bash
git commit -m "Add YouTube subtitle support, translation, and history management

- Add YouTube auto-generated subtitle extraction
- Add SRT translation to multiple languages
- Add language selection dropdown in SRT tab
- Add history save and delete functionality
- Fix clipboard paste permission
- Improve language detection for English/Farsi
- Add Vazir font to tab buttons"
```

### 1.3 Push به GitHub
```bash
git push origin main
```

---

## 🚀 مرحله 2: Deploy به سرور

### 2.1 آپلود فایل‌ها با WinSCP

فایل‌های زیر را با WinSCP به `/var/www/cutup/` آپلود کنید:

**فایل‌های API:**
- `api/youtube.js`
- `api/translate-srt.js` (فایل جدید)
- `api/transcribe.js`
- `api/upload.js`

**فایل‌های Frontend:**
- `popup.html`
- `popup.js`
- `popup.css`
- `manifest.json`

**فایل‌های Server:**
- `server.js`

---

### 2.2 دستورات سرور (SSH)

بعد از آپلود فایل‌ها، به سرور SSH کنید و این دستورات را اجرا کنید:

```bash
# اتصال به سرور
ssh root@195.248.240.108

# رفتن به دایرکتوری پروژه
cd /var/www/cutup

# بررسی فایل‌های جدید
ls -la api/translate-srt.js
ls -la api/youtube.js

# نصب dependencies (اگر لازم باشد)
npm install

# Restart کردن PM2
pm2 restart cutup-api --update-env

# بررسی لاگ‌ها
pm2 logs cutup-api --lines 30

# بررسی وضعیت
pm2 status
```

---

### 2.3 بررسی Endpoint جدید

```bash
# تست health endpoint
curl http://localhost:3001/health

# باید این پاسخ را ببینید:
# {"status":"ok","timestamp":"..."}
```

---

## ✅ چک‌لیست بعد از Deploy

- [ ] فایل‌های جدید آپلود شده‌اند
- [ ] PM2 restart شده است
- [ ] لاگ‌ها خطایی نشان نمی‌دهند
- [ ] Endpoint `/api/translate-srt` در لاگ‌ها نمایش داده می‌شود
- [ ] Extension reload شده است
- [ ] تست YouTube subtitle extraction
- [ ] تست SRT translation
- [ ] تست history save/delete

---

## 🔧 عیب‌یابی

### اگر PM2 restart نشد:
```bash
pm2 stop cutup-api
pm2 start ecosystem.config.cjs
pm2 save
```

### اگر فایل جدید پیدا نشد:
```bash
# بررسی مسیر
ls -la /var/www/cutup/api/translate-srt.js

# اگر وجود ندارد، دوباره با WinSCP آپلود کنید
```

### اگر خطای module not found:
```bash
cd /var/www/cutup
npm install
pm2 restart cutup-api
```

---

## 📝 یادداشت

- Extension را بعد از تغییر `manifest.json` حتماً reload کنید
- اگر permission clipboard کار نکرد، Extension را remove و دوباره load کنید
- برای تست، از یک ویدیو یوتیوب با زیرنویس خودکار استفاده کنید

