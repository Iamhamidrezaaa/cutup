# دستورات Git و Deploy

## 1. Commit و Push به GitHub

```bash
# اضافه کردن فایل‌های تغییر یافته
git add popup.js popup.html popup.css manifest.json

# Commit
git commit -m "Fix history expand/collapse and save button

- Remove expand/collapse from history items (only result section expands)
- Fix save button functionality and JSZip loading
- Move result section below history section
- Add collapse functionality for result section
- Fix JSZip CDN and CSP policy
- Improve UX for save/delete modes"

# Push به GitHub
git push origin main
```

## 2. آپلود فایل‌ها به سرور (WinSCP)

فایل‌های زیر را به `/var/www/cutup/` آپلود کنید:

**فایل‌های Extension:**
- `popup.js`
- `popup.html`
- `popup.css`
- `manifest.json`

**فایل‌های Backend (اگر تغییر کرده‌اند):**
- `server.js` (اگر تغییر کرده)
- `api/youtube-title.js` (اگر تغییر کرده)

## 3. Restart PM2 در سرور

```bash
ssh root@195.248.240.108
cd /var/www/cutup
pm2 restart cutup-api --update-env
pm2 logs cutup-api --lines 30
```

## 4. Reload Extension

1. به `chrome://extensions/` بروید
2. افزونه Cutup را **Remove** کنید
3. دوباره **Load unpacked** کنید (مهم: باید Remove و دوباره Load کنید تا `manifest.json` جدید اعمال شود)

## 5. تست

1. Extension را reload کنید
2. یک تاریخچه را کلیک کنید → تب نتیجه زیر تاریخچه باز می‌شود
3. دوباره روی همان تاریخچه کلیک کنید → تب نتیجه بسته می‌شود
4. روی emoji Save کلیک کنید → Save mode فعال می‌شود
5. تاریخچه‌ها را انتخاب کنید → دکمه "ذخیره" فعال می‌شود
6. روی "ذخیره" کلیک کنید → فایل ZIP دانلود می‌شود

## نکات مهم

- **Extension را حتماً Remove و دوباره Load کنید** - فقط Reload کافی نیست
- **PM2 را restart کنید** - تغییرات در `server.js` نیاز به restart دارد
- **JSZip از CDN jsdelivr بارگذاری می‌شود** - اگر مشکل داشت، بررسی کنید که اینترنت وصل است
