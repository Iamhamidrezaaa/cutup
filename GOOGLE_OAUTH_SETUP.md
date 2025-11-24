# راهنمای راه‌اندازی Google OAuth برای Cutup

## 📋 مراحل گرفتن Google OAuth Credentials

### 1. رفتن به Google Cloud Console

1. به [Google Cloud Console](https://console.cloud.google.com/) بروید
2. اگر حساب Google ندارید، یک حساب بسازید
3. اگر پروژه ندارید، یک پروژه جدید بسازید:
   - روی "Select a project" کلیک کنید
   - روی "New Project" کلیک کنید
   - نام پروژه را وارد کنید (مثلاً "Cutup")
   - روی "Create" کلیک کنید

### 2. فعال کردن Google+ API

1. در منوی سمت چپ، به **APIs & Services** → **Library** بروید
2. در جستجو، "Google+ API" را جستجو کنید
3. روی "Google+ API" کلیک کنید
4. روی "Enable" کلیک کنید

**یا** می‌توانید از "People API" استفاده کنید (پیشنهادی):
1. در Library، "People API" را جستجو کنید
2. روی "People API" کلیک کنید
3. روی "Enable" کلیک کنید

### 3. ساخت OAuth 2.0 Credentials

1. به **APIs & Services** → **Credentials** بروید
2. روی **"+ CREATE CREDENTIALS"** کلیک کنید
3. **"OAuth client ID"** را انتخاب کنید

### 4. تنظیم OAuth Consent Screen

اگر قبلاً تنظیم نکرده‌اید:
1. به **APIs & Services** → **OAuth consent screen** بروید
2. **User Type** را انتخاب کنید:
   - **External** (برای استفاده عمومی)
   - **Internal** (فقط برای سازمان شما)
3. روی **"Create"** کلیک کنید
4. اطلاعات را پر کنید:
   - **App name**: Cutup
   - **User support email**: ایمیل شما
   - **Developer contact information**: ایمیل شما
5. روی **"Save and Continue"** کلیک کنید
6. در **Scopes**، روی **"Add or Remove Scopes"** کلیک کنید
7. این scope ها را اضافه کنید:
   - `userinfo.email`
   - `userinfo.profile`
8. روی **"Update"** و سپس **"Save and Continue"** کلیک کنید
9. در **Test users** (اگر External انتخاب کردید)، ایمیل خود را اضافه کنید
10. روی **"Save and Continue"** کلیک کنید
11. روی **"Back to Dashboard"** کلیک کنید

### 5. ساخت OAuth Client ID

1. به **APIs & Services** → **Credentials** برگردید
2. روی **"+ CREATE CREDENTIALS"** → **"OAuth client ID"** کلیک کنید
3. **Application type** را انتخاب کنید:
   - **Web application** (برای وبسایت)
4. **Name** را وارد کنید: "Cutup Web Client"
5. **Authorized JavaScript origins** را اضافه کنید:
   ```
   https://cutup.shop
   ```
6. **Authorized redirect URIs** را اضافه کنید:
   ```
   https://cutup.shop/api/auth/callback
   ```
7. روی **"Create"** کلیک کنید

### 6. کپی کردن Credentials

بعد از ساخت، یک پنجره باز می‌شود که شامل:
- **Client ID**: یک رشته طولانی که با `xxxxx.apps.googleusercontent.com` تمام می‌شود
- **Client Secret**: یک رشته مخفی

**این دو را کپی کنید و برای من بفرستید!**

---

## 🔧 تنظیم در سرور

بعد از اینکه credentials را گرفتید، باید آنها را در فایل `.env` سرور اضافه کنید:

```bash
# در سرور
cd /var/www/cutup
nano .env
```

این خطوط را اضافه کنید:

```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=https://cutup.shop/api/auth/callback
FRONTEND_URL=https://cutup.shop
JWT_SECRET=your-random-secret-key-here
```

**نکات مهم:**
- `GOOGLE_CLIENT_ID`: Client ID که از Google Cloud Console گرفتید
- `GOOGLE_CLIENT_SECRET`: Client Secret که از Google Cloud Console گرفتید
- `GOOGLE_REDIRECT_URI`: باید دقیقاً همان باشد که در Google Cloud Console ثبت کردید
- `FRONTEND_URL`: آدرس وبسایت شما
- `JWT_SECRET`: یک رشته تصادفی برای امنیت (می‌توانید از `openssl rand -hex 32` استفاده کنید)

بعد از ذخیره، سرور را restart کنید:

```bash
pm2 restart cutup-api
# یا
pm2 restart all
```

---

## ✅ تست

1. به `https://cutup.shop` بروید
2. روی دکمه "🔐 ورود با Google" کلیک کنید
3. باید به صفحه Google OAuth redirect شوید
4. بعد از لاگین، باید به وبسایت برگردید و اطلاعات کاربر نمایش داده شود

---

## 🔒 نکات امنیتی

1. **هرگز Client Secret را در کد frontend قرار ندهید**
2. **Client Secret فقط باید در سرور باشد**
3. **از HTTPS استفاده کنید** (که با Let's Encrypt تنظیم شده)
4. **JWT_SECRET را یک رشته تصادفی قوی انتخاب کنید**

---

## 📝 برای افزونه Chrome

افزونه Chrome از همان API استفاده می‌کند، اما چون افزونه در یک context جداگانه اجرا می‌شود، باید:

1. در Google Cloud Console، برای افزونه یک **OAuth Client ID جداگانه** بسازید
2. یا از همان Client ID استفاده کنید (اگر Authorized redirect URIs شامل `chrome-extension://` باشد)

**نکته:** افزونه فعلاً از وبسایت برای لاگین استفاده می‌کند (tab جدید باز می‌شود).

---

## 🆘 عیب‌یابی

### خطا: "redirect_uri_mismatch"
- مطمئن شوید که `GOOGLE_REDIRECT_URI` در `.env` دقیقاً همان است که در Google Cloud Console ثبت کردید
- مطمئن شوید که از HTTPS استفاده می‌کنید

### خطا: "invalid_client"
- مطمئن شوید که `GOOGLE_CLIENT_ID` و `GOOGLE_CLIENT_SECRET` درست کپی شده‌اند
- مطمئن شوید که فاصله یا کاراکتر اضافی ندارند

### خطا: "access_denied"
- مطمئن شوید که OAuth Consent Screen را کامل تنظیم کرده‌اید
- اگر External انتخاب کردید، مطمئن شوید که ایمیل خود را به Test users اضافه کرده‌اید

---

## 📞 پشتیبانی

اگر مشکلی داشتید، لاگ‌های سرور را بررسی کنید:

```bash
pm2 logs cutup-api
```

یا:

```bash
tail -f /var/log/cutup/error.log
```

