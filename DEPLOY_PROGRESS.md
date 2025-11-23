# دستورات Deploy برای Progress Indicator

## 📦 مرحله 1: Commit و Push به Git

```bash
git add popup.html popup.css popup.js
git commit -m "Add progress indicator and improve UX for long processing

- Add progress bar with percentage and status messages
- Increase timeout to 15 minutes for large files
- Improve error handling to show clear error messages
- Add stage-by-stage progress updates
- Better user feedback during processing"

git push origin main
```

---

## 🚀 مرحله 2: آپلود فایل‌ها با WinSCP

فایل‌های زیر را به `/var/www/cutup/` آپلود کنید:

**فایل‌های Frontend:**
- `popup.html`
- `popup.js`
- `popup.css`

---

## ⚙️ مرحله 3: دستورات سرور (SSH)

بعد از آپلود فایل‌ها، به سرور SSH کنید و این دستورات را اجرا کنید:

```bash
# 1. اتصال به سرور
ssh root@195.248.240.108

# 2. رفتن به دایرکتوری پروژه
cd /var/www/cutup

# 3. بررسی فایل‌های جدید
ls -la popup.html popup.js popup.css

# 4. Restart کردن PM2 (مهم!)
pm2 restart cutup-api --update-env

# 5. بررسی لاگ‌ها
pm2 logs cutup-api --lines 30

# 6. بررسی وضعیت
pm2 status
```

---

## ✅ چک‌لیست بعد از Deploy

- [ ] فایل‌های جدید آپلود شده‌اند
- [ ] PM2 restart شده است
- [ ] لاگ‌ها خطایی نشان نمی‌دهند
- [ ] Extension reload شده است
- [ ] Progress bar نمایش داده می‌شود
- [ ] پیام‌های مرحله‌ای کار می‌کنند
- [ ] Timeout برای فایل‌های بزرگ کافی است

---

## 🔧 عیب‌یابی

### اگر PM2 restart نشد:
```bash
pm2 stop cutup-api
pm2 start ecosystem.config.cjs
pm2 save
```

### اگر Extension تغییرات را نشان نمی‌دهد:
1. به `chrome://extensions` بروید
2. Extension را Remove کنید
3. دوباره Load unpacked کنید

### اگر Progress bar نمایش داده نمی‌شود:
- بررسی کنید که `popup.html` و `popup.css` به‌روزرسانی شده‌اند
- Console را بررسی کنید (F12) برای خطاهای JavaScript

---

## 📝 یادداشت

- **مهم:** حتماً PM2 را restart کنید تا تغییرات اعمال شوند
- Extension را بعد از تغییرات reload کنید
- برای تست، از یک ویدیو کوتاه شروع کنید

