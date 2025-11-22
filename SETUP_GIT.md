# راهنمای Setup Repository

## 1. Initialize Git (اگر قبلاً initialize نشده)

```bash
git init
```

## 2. اضافه کردن Remote

```bash
git remote add origin https://github.com/Iamhamidrezaaa/cutup.git
```

## 3. اضافه کردن فایل‌ها

```bash
git add .
```

## 4. Commit

```bash
git commit -m "Initial commit: Cutup Chrome Extension with Pars Pack server"
```

## 5. Push به GitHub

```bash
git branch -M main
git push -u origin main
```

---

## نکات مهم:

- فایل `.env` در `.gitignore` است (نباید push شود)
- `node_modules` در `.gitignore` است
- فایل‌های موقت در `.gitignore` هستند

---

## بعد از Push:

Repository شما در GitHub آماده است و می‌توانید از آن استفاده کنید.

