# راهنمای Deploy برای رفع مشکل عنوان یوتیوب

## مشکل
- عنوان ویدیو در تاریخچه نمایش داده نمی‌شود
- `/api/youtube-title` خطای 404 می‌دهد (endpoint جدید deploy نشده)

## فایل‌های تغییر یافته

1. **manifest.json** - به‌روزرسانی CSP برای YouTube
2. **popup.js** - استفاده از endpoint جدید و بهبود logging
3. **server.js** - اضافه کردن route برای `/api/youtube-title`
4. **api/youtube-title.js** - endpoint جدید (ایجاد شد)
5. **api/youtube.js** - بهبود logging برای debug

## مراحل Deploy

### 1. Commit و Push به GitHub

```bash
git add manifest.json popup.js server.js api/youtube-title.js api/youtube.js
git commit -m "Add YouTube title extraction endpoint and improve logging

- Add /api/youtube-title endpoint for fast title extraction
- Update CSP in manifest.json to allow YouTube connections
- Improve logging in api/youtube.js for debugging
- Use backend API instead of direct page fetch (avoids CSP issues)"
git push origin main
```

### 2. آپلود فایل‌ها به سرور (WinSCP)

فایل‌های زیر را آپلود کنید:
- `manifest.json`
- `popup.js`
- `server.js`
- `api/youtube-title.js` (فایل جدید)
- `api/youtube.js`

مسیر در سرور: `/var/www/cutup/`

### 3. Restart PM2 در سرور

```bash
ssh root@195.248.240.108
cd /var/www/cutup
pm2 restart cutup-api --update-env
pm2 logs cutup-api --lines 30
```

### 4. Reload Extension

1. به `chrome://extensions/` بروید
2. افزونه Cutup را **Remove** کنید
3. دوباره **Load unpacked** کنید (مهم: باید Remove و دوباره Load کنید تا `manifest.json` جدید اعمال شود)

### 5. تست

1. یک ویدیو یوتیوب را تست کنید
2. Console را باز کنید (F12)
3. بررسی کنید:
   - آیا `/api/youtube-title` کار می‌کند؟
   - آیا عنوان در `youtubeResult.title` وجود دارد؟
   - آیا عنوان در تاریخچه نمایش داده می‌شود؟

## Debug

اگر هنوز عنوان نمایش داده نمی‌شود:

### بررسی لاگ‌های سرور

```bash
pm2 logs cutup-api --lines 50
```

باید این لاگ‌ها را ببینید:
- `YOUTUBE: Video title extracted: ...`
- `YOUTUBE: Returning title in response: ...`

### بررسی Console Extension

در Console Extension (نه Console صفحه):
- `YOUTUBE: Title extracted from API: ...`
- `YOUTUBE: Final title selected: ...`
- `HISTORY: Using video title: ...`

اگر این لاگ‌ها را نمی‌بینید، مشکل در استخراج metadata است.

## نکات مهم

1. **Extension را حتماً Remove و دوباره Load کنید** - فقط Reload کافی نیست
2. **PM2 را restart کنید** - تغییرات در `server.js` نیاز به restart دارد
3. **فایل `api/youtube-title.js` را حتماً آپلود کنید** - این فایل جدید است

