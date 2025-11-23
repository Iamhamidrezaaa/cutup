# راهنمای نصب yt-dlp روی سرور

برای استفاده از قابلیت دانلود ویدئو از یوتیوب، باید `yt-dlp` روی سرور نصب شود.

## روش نصب

### روش 1: استفاده از apt (پیشنهادی - برای Ubuntu/Debian)

```bash
apt-get update
apt-get install -y yt-dlp
```

### روش 2: دانلود مستقیم binary (پیشنهادی - اگر apt کار نکرد)

```bash
# دانلود yt-dlp binary
wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp

# دادن مجوز اجرا
chmod a+rx /usr/local/bin/yt-dlp
```

### روش 3: استفاده از pipx (اگر pipx نصب است)

```bash
# نصب pipx اگر نصب نیست
apt-get update
apt-get install -y pipx

# نصب yt-dlp با pipx
pipx install yt-dlp
```

### روش 4: استفاده از pip با --break-system-packages (نه پیشنهادی)

⚠️ **توجه:** این روش ممکن است سیستم را خراب کند. فقط در صورت ضرورت استفاده کنید.

```bash
pip3 install yt-dlp --break-system-packages
```

## بررسی نصب

برای بررسی اینکه `yt-dlp` نصب شده است:

```bash
yt-dlp --version
```

یا:

```bash
which yt-dlp
```

اگر خطای "command not found" دریافت کردید، مسیر `/usr/local/bin` را به PATH اضافه کنید یا از مسیر کامل استفاده کنید:

```bash
/usr/local/bin/yt-dlp --version
```

## تست

برای تست اینکه آیا `yt-dlp` کار می‌کند:

```bash
yt-dlp --version
```

## نکات مهم

1. **محدودیت حجم:** ویدئوهای بزرگتر از 25MB نمی‌توانند پردازش شوند (محدودیت Whisper API)
2. **Timeout:** دانلود ویدئوهای خیلی بلند ممکن است timeout شود (5 دقیقه)
3. **فضای دیسک:** مطمئن شوید که فضای کافی برای دانلود موقت ویدئوها وجود دارد

## عیب‌یابی

اگر خطای "yt-dlp not found" دریافت کردید:

1. بررسی کنید که `yt-dlp` نصب است: `which yt-dlp`
2. اگر نصب نیست، یکی از روش‌های بالا را استفاده کنید
3. بعد از نصب، سرور را restart کنید: `pm2 restart cutup-api`

