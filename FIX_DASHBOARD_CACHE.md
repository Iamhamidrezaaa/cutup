# رفع مشکل Cache داشبورد

## مشکل
بعد از آپلود فایل‌های جدید، تغییرات نمایش داده نمی‌شوند.

## راه‌حل‌ها

### 1. Clear Cache مرورگر (مهم!)

**Chrome/Edge:**
- `Ctrl + Shift + R` (Windows/Linux)
- `Cmd + Shift + R` (Mac)
- یا `F12` → Network tab → تیک "Disable cache" → Refresh

**Firefox:**
- `Ctrl + Shift + R` (Windows/Linux)
- `Cmd + Shift + R` (Mac)

**Safari:**
- `Cmd + Option + R`

---

### 2. بررسی مسیر فایل‌ها

```bash
# بررسی وجود فایل‌ها
ls -la /var/www/cutup/website/dashboard.js
ls -la /var/www/cutup/website/dashboard.html
ls -la /var/www/cutup/website/dashboard.css

# بررسی تاریخ آخرین تغییر
stat /var/www/cutup/website/dashboard.js
```

---

### 3. Reload Nginx

```bash
# تست تنظیمات
nginx -t

# Reload Nginx (بدون قطع شدن)
systemctl reload nginx

# یا Restart کامل
systemctl restart nginx
```

---

### 4. بررسی محتوای فایل

```bash
# بررسی چند خط اول dashboard.js
head -20 /var/www/cutup/website/dashboard.js

# بررسی وجود تابع addToCart
grep "addToCart" /var/www/cutup/website/dashboard.js
```

---

### 5. بررسی Cache Nginx (اختیاری)

اگر هنوز مشکل دارید، می‌توانید cache Nginx را غیرفعال کنید:

```bash
# ویرایش فایل Nginx
nano /etc/nginx/sites-available/cutup.shop
```

در بخش Static Assets، این خط را تغییر دهید:

```nginx
# قبل (cache 1 ساله)
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# بعد (cache 1 ساعت - برای توسعه)
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1h;
    add_header Cache-Control "public";
}
```

سپس:
```bash
nginx -t
systemctl reload nginx
```

---

### 6. بررسی Console مرورگر

1. `F12` را بزنید
2. به تب Console بروید
3. صفحه را Refresh کنید
4. خطاها را بررسی کنید

اگر خطایی مثل "404 Not Found" برای `dashboard.js` می‌بینید، یعنی فایل در مسیر درست نیست.

---

### 7. بررسی Network Tab

1. `F12` → Network tab
2. صفحه را Refresh کنید
3. `dashboard.js` را پیدا کنید
4. بررسی کنید:
   - Status باید `200` باشد
   - Size باید بزرگتر از قبل باشد (فایل جدید بزرگتر است)
   - Response باید محتوای جدید را نشان دهد

---

## دستورات سریع

```bash
# بررسی فایل‌ها
ls -lh /var/www/cutup/website/dashboard.*

# بررسی محتوا
grep "addToCart" /var/www/cutup/website/dashboard.js

# Reload Nginx
systemctl reload nginx

# بررسی وضعیت Nginx
systemctl status nginx
```

---

## نکته مهم

**فایل‌های JS/CSS در Nginx با cache 1 ساله تنظیم شده‌اند!**

این یعنی مرورگر فایل‌های قدیمی را cache کرده و حتی اگر فایل جدید آپلود شود، مرورگر فایل قدیمی را استفاده می‌کند.

**راه‌حل:**
1. Hard Refresh (`Ctrl + Shift + R`)
2. یا Clear Cache مرورگر
3. یا تغییر cache Nginx (مرحله 5)

