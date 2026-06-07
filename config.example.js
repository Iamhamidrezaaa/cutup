// فایل پیکربندی برای Development
// این فایل را کپی کنید و نام آن را config.js بگذارید
// سپس API Key خود را وارد کنید

module.exports = {
  OPENAI_API_KEY: 'YOUR_OPENAI_API_KEY_HERE',
  // PostgreSQL (required for subscription + usage persistence)
  DATABASE_URL: 'postgresql://user:pass@host:5432/cutup',
  // Optional: DATABASE_SSL=true for managed providers
  // International billing (Stripe) — also set these in server .env for Node
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  // Monthly subscription Price IDs from Stripe Dashboard (Products → Prices, currency EUR). Create three prices (€7.99, €19.99, €49.99/mo) and paste each price_... id here.
  STRIPE_PRICE_STARTER: 'price_xxx',
  STRIPE_PRICE_PRO: 'price_xxx',
  STRIPE_PRICE_ADVANCED: 'price_xxx',
  // Return URLs for Stripe Checkout. For local dev use e.g. http://localhost:3001 (same PORT as server). If unset with sk_test_ key, server defaults to http://localhost:PORT.
  FRONTEND_URL: 'https://cutup.shop',
  // Transactional email (Gmail: smtp.gmail.com:587, app password). All four required to send.
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'Cutup <you@gmail.com>',
  /** Preferred: Resend API (billing@, security@, support@, noreply@cutup.shop) */
  RESEND_API_KEY: '',
  // Protect GET/POST /api/cron/conversion-emails (Vercel Cron sends Authorization: Bearer <secret>)
  CRON_SECRET: '',
  // --- YekPay (production): set these in the Node server `.env` or host env (never in the browser / never commit secrets) ---
  // YEKPAY_MERCHANT=your_live_merchant_code
  // Optional legacy name: YEKPAY_MERCHANT_ID (same value)
  // EUR_TO_IRR=550000
  // Optional legacy: YEKPAY_EUR_TO_IRR (same as EUR_TO_IRR)
  // YEKPAY_CALLBACK_URL=https://cutup.shop/api/payment/callback
  // YEKPAY_FETCH_TIMEOUT_MS=22000
  // Production default API: https://gate.ypsapi.com — override only with YEKPAY_API_BASE_URL if required
  // YEKPAY_SANDBOX_MODE must be false or unset in production; if true you must set YEKPAY_API_BASE_URL explicitly
};

// توجه: این فایل در .gitignore است و commit نمی‌شود
// برای production، از Environment Variables در Vercel استفاده کنید

