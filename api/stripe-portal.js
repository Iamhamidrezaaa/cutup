import Stripe from 'stripe';
import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getSubscriptionRowByEmail, isBillingDbConfigured } from './billing-repository.js';

function frontendBaseUrl() {
  const explicit = (process.env.FRONTEND_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (secret.startsWith('sk_test_')) {
    return `http://localhost:${process.env.PORT || 3001}`;
  }
  return 'https://cutup.shop';
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return res.status(503).json({ error: 'Stripe is not configured' });
  }

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ error: 'Billing database not configured' });
  }

  const sessionId = req.headers['x-session-id'];
  if (!sessionId) {
    return res.status(401).json({ error: 'No session' });
  }

  const session = sessions.get(sessionId);
  if (!session?.user?.email) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const sub = await getSubscriptionRowByEmail(session.user.email);
  if (!sub?.stripe_customer_id) {
    return res.status(404).json({
      error: 'no_stripe_customer',
      message: 'No Stripe billing profile found. Complete a subscription checkout first.'
    });
  }

  try {
    const stripe = new Stripe(secret);
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${frontendBaseUrl()}/dashboard.html#financial`
    });
    return res.status(200).json({ ok: true, url: portal.url });
  } catch (err) {
    console.error('[stripe-portal]', err?.message || err);
    return res.status(500).json({ error: 'Could not open billing portal' });
  }
}
