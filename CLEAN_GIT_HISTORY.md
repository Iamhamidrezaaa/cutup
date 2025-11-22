# پاک‌سازی Git History از Secrets

## مشکل:
GitHub secret scanning یک API key یا secret در commit های قبلی پیدا کرده.

## راه‌حل: پاک‌سازی History

### روش 1: ایجاد Repository جدید (ساده‌ترین)

```bash
# حذف .git
rm -rf .git

# Initialize جدید
git init
git add .
git commit -m "Initial commit: Cutup Chrome Extension"
git branch -M main
git remote add origin https://github.com/Iamhamidrezaaa/cutup.git
git push -u origin main --force
```

### روش 2: استفاده از git-filter-repo (پیشرفته)

```bash
# نصب git-filter-repo
pip install git-filter-repo

# حذف secret از history
git filter-repo --invert-paths --path VIEW_LOGS.md
git filter-repo --replace-text <(echo "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==>YOUR_OPENAI_API_KEY")

# Force push
git push -u origin main --force
```

### روش 3: حذف فایل‌های مشکوک از Git

```bash
# حذف فایل‌های مشکوک از Git (نه از disk)
git rm --cached *.gif
git rm --cached {
git rm --cached *password*
git rm --cached *secret*

# Commit
git add .
git commit -m "Remove sensitive files from repository"

# Force push
git push -u origin main --force
```

---

## توصیه:
از **روش 1** استفاده کنید (ساده‌ترین و مطمئن‌ترین).

