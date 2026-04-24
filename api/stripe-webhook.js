import Stripe from 'stripe';
import {
  isBillingDbConfigured,
  tryClaimStripeEventStandalone,
  releaseStripeWebhookClaim
} from './billing-repository.js';
import {
  applyStripeCheckoutCompleted,
  applyStripeSubscriptionRenewal,
  downgradeStripeSubscription
} from './subscription.js';

const PUBLIC_STRIPE_PLANS = new Set(['starter', 'pro', 'advanced']);

function planKeyFromStripeMetadata(meta) {
  const p = String(meta || '').toLowerCase();
  if (PUBLIC_STRIPE_PLANS.has(p)) return p;
  return 'pro';
}

function normalizeStripeId(ref) {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object' && ref.id) return ref.id;
  return null;
}

/** Keep a single active subscription per Stripe customer after a successful checkout. */
async function cancelOtherActiveSubscriptions(stripe, customerId, keepSubscriptionId) {
  if (!customerId || !keepSubscriptionId) return;
  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 30
    });
    for (const s of list.data) {
      if (s.id === keepSubscriptionId) continue;
      if (s.status !== 'active' && s.status !== 'trialing') continue;
      try {
        await stripe.subscriptions.cancel(s.id);
        console.log('[stripe-webhook] Cancelled prior subscription', s.id, s.status, 'kept', keepSubscriptionId);
      } catch (e) {
        console.warn('[stripe-webhook] Could not cancel subscription', s.id, e.message);
      }
    }
  } catch (e) {
    console.error('[stripe-webhook] cancelOtherActiveSubscriptions failed', e);
    throw e;
  }
}

/**
 * Raw body on req.body — route must use express.raw({ type: 'application/json' }).
 */
export default async function handler(req, res) {
  const secret = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !whSecret) {
    console.error('[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    console.warn('[stripe-webhook] Missing stripe-signature header');
    return res.status(400).send('Missing stripe-signature');
  }

  const stripe = new Stripe(secret);
  let event;

  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    event = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
  } catch (err) {
    console.error('[stripe-webhook] Signature verify failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (!isBillingDbConfigured()) {
    console.error('[stripe-webhook] DATABASE_URL not set');
    return res.status(503).send('Database not configured');
  }

  const claimed = await tryClaimStripeEventStandalone(event.id);
  if (!claimed) {
    console.log('[stripe-webhook] Duplicate event ignored:', event.id, event.type);
    return res.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const email = s.metadata?.userEmail || s.customer_email || s.customer_details?.email;
        const plan = planKeyFromStripeMetadata(s.metadata?.plan);
        let subId = normalizeStripeId(s.subscription);
        let custId = normalizeStripeId(s.customer);
        let periodEnd = null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          periodEnd = new Date(sub.current_period_end * 1000);
          if (!custId) {
            custId = normalizeStripeId(sub.customer);
          }
        }
        if (custId && subId) {
          await cancelOtherActiveSubscriptions(stripe, custId, subId);
        }
        if (email) {
          await applyStripeCheckoutCompleted(email, plan, custId || null, subId || null, periodEnd);
          console.log('[stripe-webhook] checkout.session.completed', plan, email, s.id);
        } else {
          console.warn('[stripe-webhook] checkout.session.completed without email', s.id);
        }
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object;
        if (inv.status !== 'paid') break;
        const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const email = sub.metadata?.userEmail || inv.customer_email;
        const plan = planKeyFromStripeMetadata(sub.metadata?.plan);
        const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const periodEnd = new Date(sub.current_period_end * 1000);
        if (email) {
          await applyStripeSubscriptionRenewal(
            email,
            plan,
            custId || null,
            sub.id,
            periodEnd,
            sub.status === 'active' ? 'active' : 'active'
          );
          console.log('[stripe-webhook] invoice.paid', plan, email, inv.id);
        } else {
          console.warn('[stripe-webhook] invoice.paid: missing userEmail metadata', subId);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const email = sub.metadata?.userEmail;
        if (email) {
          await downgradeStripeSubscription(email);
          console.log('[stripe-webhook] customer.subscription.deleted -> free', email);
        } else {
          console.warn('[stripe-webhook] subscription.deleted without userEmail', sub.id);
        }
        break;
      }
      case 'invoice.payment_failed':
        console.warn('[stripe-webhook] invoice.payment_failed', event.data.object?.id);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error', event?.type, err);
    await releaseStripeWebhookClaim(event.id);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  return res.json({ received: true });
}
