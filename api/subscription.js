// Subscription + usage API — PostgreSQL is the source of truth (DATABASE_URL).

import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { PLANS } from './plans-config.js';
import {
  isBillingDbConfigured,
  ensureUserByEmail,
  getSubscriptionRowByEmail,
  getLegacyUsageShape,
  canUseFeatureDb,
  getUsageHistoryDb,
  saveOutputDb,
  getSavedOutputsDb,
  resetAudioDownloadsDb,
  upgradePlanLegacyDb,
  applyStripeSubscriptionDbFromCheckout,
  syncStripeSubscriptionFromStripeObject,
  downgradeStripeSubscriptionDb
} from './billing-repository.js';

const SPECIAL_EMAIL = 'h.asgarizade@gmail.com';

/** Stripe checkout.session.completed — full IDs + period end. */
export async function applyStripeCheckoutCompleted(userEmail, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd) {
  if (!isBillingDbConfigured() || !userEmail || !PLANS[planKey]) {
    console.warn('[applyStripeCheckoutCompleted] skipped', userEmail, planKey);
    return false;
  }
  await applyStripeSubscriptionDbFromCheckout(
    userEmail,
    planKey,
    stripeCustomerId,
    stripeSubscriptionId,
    currentPeriodEnd
  );
  console.log(`[applyStripeCheckoutCompleted] ${userEmail} -> ${planKey}`);
  return true;
}

/** invoice.paid / subscription sync — merge Stripe fields without wiping customer id. */
export async function applyStripeSubscriptionRenewal(userEmail, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, status = 'active') {
  if (!isBillingDbConfigured() || !userEmail || !PLANS[planKey]) return false;
  await syncStripeSubscriptionFromStripeObject(
    userEmail,
    planKey,
    stripeCustomerId,
    stripeSubscriptionId,
    currentPeriodEnd,
    status
  );
  console.log(`[applyStripeSubscriptionRenewal] ${userEmail} -> ${planKey}`);
  return true;
}

export async function downgradeStripeSubscription(userEmail) {
  if (!isBillingDbConfigured() || !userEmail) return false;
  await downgradeStripeSubscriptionDb(userEmail);
  console.log(`[downgradeStripeSubscription] ${userEmail} -> free`);
  return true;
}

export async function canUseFeature(userId, feature, videoDurationMinutes = 0) {
  if (userId === SPECIAL_EMAIL) return { allowed: true };
  if (!isBillingDbConfigured()) {
    return { allowed: false, reason: 'Billing system unavailable (DATABASE_URL).' };
  }
  return canUseFeatureDb(userId, feature, videoDurationMinutes);
}

function specialSubscriptionPayload() {
  const end = new Date();
  end.setFullYear(end.getFullYear() + 10);
  return {
    plan: 'business',
    startDate: new Date(),
    endDate: end,
    billingPeriod: 'annual'
  };
}

export default async function handler(req, res) {
  setCORSHeaders(res);

  const { method, query } = req;
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch (e) {
      console.warn('Failed to parse body as JSON:', e.message);
    }
  }
  if (!body) body = {};

  const action = query.action || body?.action;
  const sessionId = req.headers['x-session-id'] || query.session || body?.session;

  if (!isBillingDbConfigured()) {
    return res.status(503).json({
      error: 'DATABASE_URL is not configured',
      hint: 'Set DATABASE_URL and run: node api/db/migrate.mjs'
    });
  }

  try {
    if (method === 'GET' && action === 'plans') {
      const plans = Object.keys(PLANS)
        .filter((key) => PLANS[key].publicOffer !== false)
        .map((key) => ({
          id: key,
          ...PLANS[key]
        }));
      return res.json({ plans });
    }

    if (!sessionId) {
      return res.status(401).json({ error: 'No session provided' });
    }

    const session = sessions.get(sessionId);
    if (!session || !session.user || !session.user.email) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (session.expiresAt && Date.now() > session.expiresAt) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: 'Session expired' });
    }

    const userId = session.user.email;

    if (method === 'GET' && action === 'info') {
      await ensureUserByEmail(userId);

      let subscriptionRow;
      let planKey;
      let subShape;

      if (userId === SPECIAL_EMAIL) {
        planKey = 'business';
        subShape = specialSubscriptionPayload();
        subscriptionRow = { plan: 'business', current_period_end: subShape.endDate, billing_period: 'annual', created_at: subShape.startDate };
      } else {
        subscriptionRow = await getSubscriptionRowByEmail(userId);
        planKey = subscriptionRow?.plan || 'free';
        subShape = {
          plan: planKey,
          startDate: subscriptionRow?.created_at || new Date(),
          endDate: subscriptionRow?.current_period_end || null,
          billingPeriod: subscriptionRow?.billing_period || 'monthly'
        };
      }

      const plan = PLANS[planKey];
      const usage = userId === SPECIAL_EMAIL
        ? await zeroUsageShape()
        : await getLegacyUsageShape(userId);

      const responseData = {
        plan: planKey,
        planName: plan.nameEn || plan.name,
        planNameEn: plan.nameEn,
        features: plan.features,
        usage: {
          daily: usage.daily,
          monthly: usage.monthly,
          dailyLimit: plan.dailyLimit || null,
          monthlyLimit: plan.monthlyLimit,
          downloads: {
            audio: {
              count: usage.downloads.audio.count,
              limit: plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null
            },
            video: {
              count: usage.downloads.video.count,
              limit: plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null
            }
          }
        },
        subscription: {
          startDate: subShape.startDate,
          endDate: subShape.endDate,
          billingPeriod: subShape.billingPeriod
        }
      };

      return res.json(responseData);
    }

    if (method === 'POST' && action === 'check') {
      let requestBody = body;
      if (typeof body === 'string') {
        try {
          requestBody = body.length ? JSON.parse(body) : {};
        } catch {
          requestBody = {};
        }
      }
      if (!requestBody || typeof requestBody !== 'object') requestBody = {};

      const { feature, videoDurationMinutes = 0 } = requestBody;

      if (!feature) {
        await ensureUserByEmail(userId);
        const usage = userId === SPECIAL_EMAIL ? await zeroUsageShape() : await getLegacyUsageShape(userId);
        const subscriptionRow = userId === SPECIAL_EMAIL
          ? { plan: 'business' }
          : await getSubscriptionRowByEmail(userId);
        const pk = subscriptionRow?.plan || 'free';
        const plan = PLANS[pk];
        return res.json({
          allowed: true,
          usage: {
            daily: usage.daily,
            monthly: usage.monthly,
            downloads: {
              audio: { count: usage.downloads.audio.count, limit: plan.downloadAudioLimit ?? null },
              video: { count: usage.downloads.video.count, limit: plan.downloadVideoLimit ?? null }
            }
          }
        });
      }

      const check = await canUseFeature(userId, feature, videoDurationMinutes);
      return res.json(check);
    }

    if (method === 'GET' && action === 'history') {
      const limit = parseInt(query.limit, 10) || 100;
      const history = await getUsageHistoryDb(userId, limit);
      return res.json({ history, total: history.length });
    }

    if (method === 'GET' && action === 'savedOutputs') {
      const limit = parseInt(query.limit, 10) || 100;
      const outputs = await getSavedOutputsDb(userId, limit);
      return res.json({ outputs, total: outputs.length });
    }

    if (method === 'POST' && action === 'saveOutput') {
      const { type, title, platform, sourceUrl, language, content, metadata } = body || {};
      if (!type || !content) {
        return res.status(400).json({ error: 'type and content are required' });
      }
      const allowedTypes = new Set(['transcript', 'summary', 'srt']);
      if (!allowedTypes.has(type)) {
        return res.status(400).json({ error: 'Invalid output type' });
      }
      const id = await saveOutputDb(userId, {
        type,
        title,
        platform,
        sourceUrl,
        language,
        content,
        metadata: metadata || {}
      });
      return res.json({ success: true, id });
    }

    if (method === 'POST' && action === 'resetAudioDownloads') {
      if (userId !== SPECIAL_EMAIL) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      await resetAudioDownloadsDb(userId);
      return res.json({ success: true, message: 'Audio downloads reset successfully' });
    }

    if (method === 'POST' && action === 'upgrade') {
      const { plan, billingPeriod = 'monthly' } = body;
      if (!PLANS[plan]) {
        return res.status(400).json({ error: 'Invalid plan' });
      }
      await upgradePlanLegacyDb(userId, plan, billingPeriod);
      const subscriptionRow = await getSubscriptionRowByEmail(userId);
      return res.json({
        success: true,
        subscription: {
          plan: subscriptionRow.plan,
          endDate: subscriptionRow.current_period_end,
          billingPeriod: subscriptionRow.billing_period
        }
      });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    console.error('Subscription error:', error);
    setCORSHeaders(res);
    return res.status(500).json({
      error: 'Subscription error',
      message: error.message
    });
  }
}

async function zeroUsageShape() {
  const now = new Date();
  return {
    daily: { date: new Date().toISOString().slice(0, 10), minutes: 0 },
    monthly: { month: now.getMonth(), year: now.getFullYear(), minutes: 0 },
    downloads: {
      audio: { month: now.getMonth(), year: now.getFullYear(), count: 0 },
      video: { month: now.getMonth(), year: now.getFullYear(), count: 0 }
    }
  };
}
