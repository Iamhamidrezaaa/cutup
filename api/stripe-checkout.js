import Stripe from 'stripe';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getSubscriptionRowByEmail, isBillingDbConfigured } from './billing-repository.js';

const STRIPE_PLAN_KEYS = ['starter', 'pro', 'advanced'];

/** Public URLs for Checkout return. Prefer FRONTEND_URL; with Stripe test keys default to localhost for safer local QA. */
function getFrontendBaseUrl() {
  const explicit = (process.env.FRONTEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (secret.startsWith('sk_test_')) {
    const port = process.env.PORT || '3001';
    return `http://localhost:${port}`;
  }
  return 'https://cutup.shop';
}

function resolvePriceId(priceKey) {
  const envMap = {
    starter: process.env.STRIPE_PRICE_STARTER,
    pro: process.env.STRIPE_PRICE_PRO,
    advanced: process.env.STRIPE_PRICE_ADVANCED
  };
  return envMap[priceKey] || null;
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('[stripe-checkout] STRIPE_SECRET_KEY missing');
    return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
  }

  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(401).json({ error: 'No session' });
  }

  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return res.status(401).json({ error: 'Session expired' });
  }

  let body = req.body;
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const raw = String(body?.priceKey || 'pro').toLowerCase();
  const priceKey = STRIPE_PLAN_KEYS.includes(raw) ? raw : 'pro';
  const priceId = resolvePriceId(priceKey);

  if (!priceId) {
    console.error(
      '[stripe-checkout] Missing Stripe price env for',
      priceKey,
      '(set STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_ADVANCED)'
    );
    return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
  }

  const stripe = new Stripe(secret);
  const plan = priceKey;
  const email = session.user.email;
  const baseUrl = getFrontendBaseUrl();

  let existingStripeCustomerId = null;
  if (isBillingDbConfigured()) {
    try {
      const row = await getSubscriptionRowByEmail(email);
      if (row?.stripe_customer_id) {
        existingStripeCustomerId = row.stripe_customer_id;
      }
    } catch (e) {
      console.error('[stripe-checkout] Could not load subscription row', e);
      return res.status(503).json({ error: 'Payment could not be started. Please try again later.' });
    }
  }

  try {
    const sessionPayload = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard.html?session=${encodeURIComponent(sessionId)}&payment=success`,
      cancel_url: `${baseUrl}/dashboard.html?session=${encodeURIComponent(sessionId)}&payment=cancel`,
      client_reference_id: sessionId,
      metadata: { userEmail: email, plan },
      subscription_data: {
        metadata: { userEmail: email, plan }
      }
    };

    if (existingStripeCustomerId) {
      sessionPayload.customer = existingStripeCustomerId;
    } else {
      sessionPayload.customer_email = email;
    }

    const checkoutSession = await stripe.checkout.sessions.create(sessionPayload);

    console.log('[stripe-checkout] Created session', checkoutSession.id, 'for', email, plan);
    return res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    console.error('[stripe-checkout] Checkout session create failed', err);
    return res.status(500).json({
      error: 'Payment failed. Please try again.'
    });
  }
}
