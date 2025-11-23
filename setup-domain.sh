#!/bin/bash

# اسکریپت راه‌اندازی دامنه cutup.shop
# این اسکریپت را در سرور اجرا کنید

echo "🚀 شروع راه‌اندازی دامنه cutup.shop..."

# رنگ‌ها برای خروجی
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# بررسی root user
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}❌ لطفاً با دسترسی root اجرا کنید: sudo bash setup-domain.sh${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 به‌روزرسانی سیستم...${NC}"
apt update && apt upgrade -y

echo -e "${YELLOW}📦 نصب Nginx...${NC}"
apt install -y nginx certbot python3-certbot-nginx

echo -e "${YELLOW}📁 ایجاد پوشه website...${NC}"
mkdir -p /var/www/cutup/website

echo -e "${YELLOW}📝 ایجاد فایل تنظیمات Nginx...${NC}"
cat > /etc/nginx/sites-available/cutup.shop << 'EOF'
# HTTP Server - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name cutup.shop www.cutup.shop;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name cutup.shop www.cutup.shop;

    ssl_certificate /etc/letsencrypt/live/cutup.shop/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cutup.shop/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    root /var/www/cutup/website;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        client_max_body_size 100M;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;
}
EOF

echo -e "${YELLOW}🔗 فعال کردن سایت...${NC}"
ln -sf /etc/nginx/sites-available/cutup.shop /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo -e "${YELLOW}✅ تست تنظیمات Nginx...${NC}"
if nginx -t; then
    echo -e "${GREEN}✅ تنظیمات Nginx صحیح است${NC}"
    systemctl restart nginx
else
    echo -e "${RED}❌ خطا در تنظیمات Nginx${NC}"
    exit 1
fi

echo -e "${YELLOW}🔥 تنظیم Firewall...${NC}"
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw --force enable

echo -e "${GREEN}✅ تنظیمات اولیه کامل شد!${NC}"
echo ""
echo -e "${YELLOW}📋 مراحل بعدی:${NC}"
echo "1. DNS را در پارس پک تنظیم کنید (A Record: 195.248.240.108)"
echo "2. صبر کنید تا DNS propagate شود (چند دقیقه تا چند ساعت)"
echo "3. بعد از propagate شدن DNS، این دستور را اجرا کنید:"
echo "   ${GREEN}certbot --nginx -d cutup.shop -d www.cutup.shop${NC}"
echo ""
echo "4. فایل‌های website را در /var/www/cutup/website قرار دهید"
echo "5. CORS را در backend تنظیم کنید"
echo ""
echo -e "${YELLOW}برای بررسی DNS:${NC}"
echo "nslookup cutup.shop"

