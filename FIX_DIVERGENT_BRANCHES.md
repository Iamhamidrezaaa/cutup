# رفع خطای Divergent Branches

## مشکل:
```
fatal: Need to specify how to reconcile divergent branches.
```

## راه‌حل:

دستورات زیر را به ترتیب اجرا کنید:

```bash
# 1. تنظیم merge strategy (merge - نه rebase)
git config pull.rebase false

# 2. Pull با merge
git pull origin main --allow-unrelated-histories --no-edit

# اگر conflict داشت:
# 3. Resolve conflicts (اگر داشت)
git add .
git commit -m "Merge server files with GitHub"

# 4. بررسی وضعیت
git status
```

## توضیح:

- `pull.rebase false` = از merge استفاده کن (ترکیب دو branch)
- `--allow-unrelated-histories` = اجازه merge دو history جداگانه
- `--no-edit` = از commit message پیش‌فرض استفاده کن

