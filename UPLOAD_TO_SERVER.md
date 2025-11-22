# روش‌های آپلود فایل به سرور

## روش 1: استفاده از SCP (ساده‌ترین)

### نصب SCP در Windows:
SCP معمولاً با Git Bash یا OpenSSH در Windows 10+ موجود است.

### دستور:
```bash
# از Git Bash
scp -r -o StrictHostKeyChecking=no \
  --exclude='node_modules' \
  --exclude='.git' \
  ./* root@195.248.240.108:/var/www/cutup/
```

اما SCP در Git Bash exclude ندارد. پس بهتر است:

```bash
# ایجاد فایل tar.gz (بدون node_modules و .git)
tar -czf cutup.tar.gz --exclude='node_modules' --exclude='.git' --exclude='cutup.tar.gz' .

# آپلود فایل
scp cutup.tar.gz root@195.248.240.108:/var/www/cutup/

# در سرور:
ssh root@195.248.240.108
cd /var/www/cutup
tar -xzf cutup.tar.gz
rm cutup.tar.gz
```

---

## روش 2: استفاده از WinSCP (پیشنهادی برای Windows)

### دانلود و نصب:
1. دانلود WinSCP: https://winscp.net/eng/download.php
2. نصب WinSCP

### اتصال:
1. Host name: `195.248.240.108`
2. Username: `root`
3. Password: (password سرور)
4. Protocol: `SFTP`

### آپلود:
1. فایل‌های پروژه را انتخاب کنید
2. `node_modules` و `.git` را exclude کنید
3. Drag & Drop به `/var/www/cutup/`

---

## روش 3: استفاده از FileZilla

### دانلود:
https://filezilla-project.org/download.php?type=client

### اتصال:
- Protocol: `SFTP`
- Host: `195.248.240.108`
- Username: `root`
- Password: (password سرور)
- Port: `22`

---

## روش 4: استفاده از Git (اگر repository دارید)

### در سرور:
```bash
ssh root@195.248.240.108
cd /var/www
git clone https://github.com/your-username/cutup.git
cd cutup
npm install
```

---

## روش 5: استفاده از tar + scp (ساده برای Git Bash)

### در Git Bash (از دایرکتوری پروژه):
```bash
# ایجاد فایل tar.gz
tar -czf cutup.tar.gz --exclude='node_modules' --exclude='.git' --exclude='cutup.tar.gz' .

# آپلود
scp cutup.tar.gz root@195.248.240.108:/var/www/cutup/
```

### در سرور (بعد از اتصال):
```bash
cd /var/www/cutup
tar -xzf cutup.tar.gz
rm cutup.tar.gz
npm install
```

---

## فایل‌های ضروری برای آپلود:

✅ باید آپلود شوند:
- `api/` (تمام فایل‌های API)
- `server.js`
- `ecosystem.config.js`
- `package.json`
- `.env` (بعد از ایجاد در سرور)

❌ نباید آپلود شوند:
- `node_modules/`
- `.git/`
- `cutup.tar.gz`
- فایل‌های موقت

---

## بعد از آپلود:

```bash
# در سرور
cd /var/www/cutup
npm install
nano .env  # اضافه کردن OPENAI_API_KEY
pm2 start ecosystem.config.js
pm2 save
```

