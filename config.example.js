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
  // Monthly subscription Price IDs from Stripe Dashboard (Products → Prices). Do not guess — create three prices ($9.99, $19.99, $39.99/mo) and paste each price_... id here.
  STRIPE_PRICE_STARTER: 'price_xxx',
  STRIPE_PRICE_PRO: 'price_xxx',
  STRIPE_PRICE_ADVANCED: 'price_xxx',
  // Return URLs for Stripe Checkout. For local dev use e.g. http://localhost:3001 (same PORT as server). If unset with sk_test_ key, server defaults to http://localhost:PORT.
  FRONTEND_URL: 'https://cutup.shop'
};

// توجه: این فایل در .gitignore است و commit نمی‌شود
// برای production، از Environment Variables در Vercel استفاده کنید

