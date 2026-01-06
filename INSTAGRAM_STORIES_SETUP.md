# راهنمای تنظیم Cookies برای دانلود استوری‌های اینستاگرام

## مشکل
استوری‌های اینستاگرام نیاز به authentication دارند و `yt-dlp` نمی‌تواند بدون cookies آن‌ها را دانلود کند.

## راه حل 1: استفاده از Cookies از مرورگر (اگر Chrome نصب باشد)
کد به صورت خودکار از `--cookies-from-browser chrome` استفاده می‌کند. اگر Chrome در سرور نصب باشد، این روش کار می‌کند.

### نصب Chrome در سرور (Ubuntu/Debian):
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb
```

## راه حل 2: استفاده از فایل Cookies
اگر Chrome نصب نیست، می‌توانید یک فایل cookies ایجاد کنید:

### مراحل:
1. در مرورگر خود (Chrome/Firefox) به اینستاگرام لاگین کنید
2. از افزونه‌های مرورگر (مثل "Get cookies.txt LOCALLY" یا "cookies.txt") استفاده کنید تا cookies را export کنید
3. فایل cookies را در مسیر `/var/www/cutup/cookies/instagram_cookies.txt` قرار دهید
4. مطمئن شوید که فایل قابل خواندن است:
   ```bash
   chmod 644 /var/www/cutup/cookies/instagram_cookies.txt
   ```

### ساختار فایل cookies:
فایل باید به فرمت Netscape cookies باشد:
```
# Netscape HTTP Cookie File
.instagram.com	TRUE	/	FALSE	1735689600	sessionid	YOUR_SESSION_ID
.instagram.com	TRUE	/	FALSE	1735689600	csrftoken	YOUR_CSRF_TOKEN
```

### نکات مهم:
- Cookies باید به‌روز باشند (معمولاً هر چند هفته یکبار باید به‌روز شوند)
- Cookies باید از یک حساب اینستاگرام واقعی باشند
- فایل cookies باید در مسیر صحیح قرار گیرد: `/var/www/cutup/cookies/instagram_cookies.txt`

## تست:
بعد از تنظیم، یک استوری اینستاگرام را تست کنید. اگر خطا داد، لاگ‌ها را بررسی کنید:
```bash
pm2 logs
```

## پیام خطا:
اگر cookies درست تنظیم نشده باشد، پیام خطای زیر نمایش داده می‌شود:
"دانلود استوری‌های اینستاگرام نیاز به احراز هویت دارد. در حال حاضر این قابلیت در دسترس نیست. لطفاً از پست‌ها یا ریلز استفاده کنید."



