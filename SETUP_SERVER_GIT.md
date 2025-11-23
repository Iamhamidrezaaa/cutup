# راهنمای Setup Git در سرور Pars Pack

## مشکل:
سرور repository گیت را نمی‌شناسد (`fatal: not a git repository`)

## راه‌حل: Initialize Repository در سرور

### روش 1: Initialize و اضافه کردن Remote (اگر فایل‌ها از قبل در سرور هستند)

```bash
# اتصال به سرور
ssh root@195.248.240.108

# رفتن به پوشه پروژه
cd /var/www/cutup

# Initialize repository
git init

# اضافه کردن remote
git remote add origin https://github.com/Iamhamidrezaaa/cutup.git

# اضافه کردن همه فایل‌ها
git add .

# Commit
git commit -m "Initial commit from server"

# تنظیم branch
git branch -M main

# Pull از GitHub (برای همگام‌سازی)
git pull origin main --allow-unrelated-histories

# اگر conflict داشت، resolve کنید و سپس:
git add .
git commit -m "Merge server files with GitHub"

# Push (اختیاری - فقط اگر می‌خواهید تغییرات سرور را push کنید)
# git push -u origin main
```

### روش 2: Clone از GitHub (اگر می‌خواهید فایل‌های سرور را جایگزین کنید)

⚠️ **هشدار:** این روش فایل‌های فعلی سرور را جایگزین می‌کند!

```bash
# اتصال به سرور
ssh root@195.248.240.108

# بکاپ از فایل‌های فعلی (مهم!)
cd /var/www
mv cutup cutup_backup

# Clone از GitHub
git clone https://github.com/Iamhamidrezaaa/cutup.git

# کپی فایل .env از بکاپ (اگر وجود دارد)
cp cutup_backup/.env cutup/.env

# نصب dependencies
cd cutup
npm install

# Restart PM2
pm2 restart cutup-api --update-env
```

### روش 3: فقط اضافه کردن Remote (ساده‌ترین - اگر فایل‌ها از قبل در سرور هستند)

```bash
# اتصال به سرور
ssh root@195.248.240.108
cd /var/www/cutup

# Initialize repository
git init

# اضافه کردن remote
git remote add origin https://github.com/Iamhamidrezaaa/cutup.git

# Fetch از GitHub
git fetch origin

# اضافه کردن فایل‌های سرور به staging
git add .

# Commit
git commit -m "Server files"

# تنظیم branch
git branch -M main

# Pull با allow-unrelated-histories
git pull origin main --allow-unrelated-histories --no-edit

# اگر conflict داشت:
# 1. فایل‌های conflict را resolve کنید
# 2. git add .
# 3. git commit -m "Merge conflicts resolved"
```

## بعد از Setup:

حالا می‌توانید از `git pull` استفاده کنید:

```bash
cd /var/www/cutup
git pull origin main
pm2 restart cutup-api
```

## نکات مهم:

- فایل `.env` در `.gitignore` است (نباید push شود)
- بعد از `git pull`، حتماً `pm2 restart cutup-api` را اجرا کنید
- اگر فایل `.env` در سرور دارید، آن را backup کنید قبل از clone

