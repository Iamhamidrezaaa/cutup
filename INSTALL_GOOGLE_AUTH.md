# نصب google-auth-library در سرور

## دستورات

```bash
cd /var/www/cutup
npm install google-auth-library
```

## بررسی نصب

```bash
npm list google-auth-library
```

باید خروجی مشابه این را ببینید:
```
cutup@1.0.0
└── google-auth-library@9.x.x
```

## Restart سرور

بعد از نصب:

```bash
pm2 restart cutup-api
```

یا:

```bash
pm2 restart all
```

## بررسی لاگ‌ها

```bash
pm2 logs cutup-api --lines 50
```

باید خطای مربوط به `google-auth-library` برطرف شده باشد.

