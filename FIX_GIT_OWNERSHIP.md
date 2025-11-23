# رفع خطای Git Ownership

## مشکل:
```
fatal: detected dubious ownership in repository at '/var/www/cutup'
```

## راه‌حل:

دستور زیر را در سرور اجرا کنید:

```bash
git config --global --add safe.directory /var/www/cutup
```

بعد از این، می‌توانید دستورات Git را ادامه دهید:

```bash
cd /var/www/cutup
git remote add origin https://github.com/Iamhamidrezaaa/cutup.git
git add .
git commit -m "Initial commit from server"
git branch -M main
git pull origin main --allow-unrelated-histories
```

## توضیح:

این خطا زمانی رخ می‌دهد که:
- Repository توسط کاربر دیگری (مثلاً root) ساخته شده
- یا در مسیری است که Git آن را "unsafe" می‌داند

با اضافه کردن `safe.directory`، به Git می‌گوییم که این مسیر امن است.

