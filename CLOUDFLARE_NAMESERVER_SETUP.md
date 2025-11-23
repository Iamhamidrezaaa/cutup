# راهنمای تنظیم Nameserver در پارس پک برای Cloudflare

## 📋 Nameserverهای Cloudflare شما:

```
rose.ns.cloudflare.com
rudy.ns.cloudflare.com
```

---

## 🔧 مراحل تنظیم در پنل پارس پک:

### مرحله 1: ورود به پنل پارس پک

1. به [parspack.com](https://parspack.com) بروید
2. وارد حساب کاربری خود شوید
3. به بخش "مدیریت دامنه" یا "Domain Management" بروید

---

### مرحله 2: پیدا کردن دامنه cutup.shop

1. در لیست دامنه‌ها، `cutup.shop` را پیدا کنید
2. روی دامنه کلیک کنید

---

### مرحله 3: تغییر Nameserver

**گزینه A: اگر بخش "Nameservers" یا "تنظیمات Nameserver" دارید:**

1. به بخش "Nameservers" یا "تنظیمات Nameserver" بروید
2. Nameserverهای فعلی را حذف کنید (یا جایگزین کنید)
3. این دو Nameserver را اضافه کنید:
   ```
   rose.ns.cloudflare.com
   rudy.ns.cloudflare.com
   ```
4. ذخیره کنید

**گزینه B: اگر بخش "DNS Management" دارید:**

1. به بخش "DNS Management" بروید
2. به دنبال "Nameservers" یا "تنظیمات Nameserver" بگردید
3. Nameserverهای Cloudflare را وارد کنید

**گزینه C: اگر نمی‌توانید Nameserver را تغییر دهید:**

با پشتیبانی پارس پک تماس بگیرید و بگویید:
> "می‌خواهم Nameserver دامنه cutup.shop را تغییر دهم به:
> rose.ns.cloudflare.com
> rudy.ns.cloudflare.com"

---

### مرحله 4: خاموش کردن DNSSEC (اگر فعال است)

1. در همان بخش تنظیمات دامنه
2. به دنبال "DNSSEC" بگردید
3. اگر فعال است، آن را خاموش کنید
4. ذخیره کنید

---

### مرحله 5: بازگشت به Cloudflare

1. به صفحه Cloudflare برگردید
2. روی دکمه آبی "Continue" کلیک کنید
3. Cloudflare به صورت خودکار Nameserverها را بررسی می‌کند

---

## ⏱️ زمان فعال شدن

- معمولاً 5 دقیقه تا 2 ساعت طول می‌کشد
- Cloudflare به صورت خودکار بررسی می‌کند
- می‌توانید از [whatsmydns.net](https://www.whatsmydns.net/#NS/cutup.shop) بررسی کنید

---

## ✅ بعد از فعال شدن Nameserver

بعد از اینکه Cloudflare Nameserverها را تایید کرد:

1. **به بخش "DNS" در Cloudflare بروید**
2. **رکوردهای A را اضافه کنید:**

   **رکورد اول:**
   ```
   Type: A
   Name: @
   IPv4 address: 195.248.240.108
   Proxy: Off (مهم! باید خاکستری باشد، نه نارنجی)
   TTL: Auto
   ```

   **رکورد دوم:**
   ```
   Type: A
   Name: www
   IPv4 address: 195.248.240.108
   Proxy: Off (مهم! باید خاکستری باشد، نه نارنجی)
   TTL: Auto
   ```

3. **ذخیره کنید**

---

## 🔍 بررسی Nameserver

بعد از تنظیم، می‌توانید بررسی کنید:

```bash
# از کامپیوتر خود
nslookup -type=NS cutup.shop
```

باید Nameserverهای Cloudflare را نشان دهد:
- rose.ns.cloudflare.com
- rudy.ns.cloudflare.com

---

## 🆘 اگر مشکل داشتید

### مشکل: نمی‌توانم Nameserver را تغییر دهم
- با پشتیبانی پارس پک تماس بگیرید
- یا از بخش "تیکت" در پنل درخواست دهید

### مشکل: Nameserver تغییر نمی‌کند
- چند ساعت صبر کنید
- Cache DNS را پاک کنید: `ipconfig /flushdns` (Windows)

### مشکل: Cloudflare Nameserver را نمی‌پذیرد
- مطمئن شوید که هر دو Nameserver را درست وارد کرده‌اید
- نقطه‌ها و حروف را دقیقاً کپی کنید

---

## 📝 نکات مهم

1. **Proxy را Off نگه دارید:** وقتی رکورد A اضافه می‌کنید، Proxy باید Off باشد (خاکستری)
2. **DNSSEC:** اگر در پارس پک فعال است، خاموش کنید
3. **صبر:** Nameserver propagation ممکن است چند ساعت طول بکشد

