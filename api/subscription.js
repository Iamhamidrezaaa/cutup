// Subscription + usage API — PostgreSQL is the source of truth (DATABASE_URL).

import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { PLANS, getPlanDef, resolvePlanKey } from './plans-config.js';
import {
  getPlanPermissions,
  getComparisonMatrix,
  PLAN_LABELS,
  PLAN_CREDITS
} from './plans/permissions.js';
import { buildBillingDashboardPayload, emptyBillingPayload } from './billing-dashboard.js';
import { isSubscriptionPeriodExpired } from './billing-payable-invoices.js';
import {
  isBillingDbConfigured,
  ensureUserByEmail,
  getSubscriptionRowByEmail,
  backfillSubscriptionPeriodEndIfMissing,
  resolveSubscriptionPeriodEnd,
  getLegacyUsageShape,
  canUseFeatureDb,
  getUsageHistoryDb,
  saveOutputDb,
  getSavedOutputsDb,
  renameSavedOutputDb,
  toggleSavedOutputFavoriteDb,
  resetAudioDownloadsDb,
  upgradePlanLegacyDb,
  applyStripeSubscriptionDbFromCheckout,
  syncStripeSubscriptionFromStripeObject,
  downgradeStripeSubscriptionDb,
  getCreditsSnapshot,
  getLifetimeMetrics
} from './billing-repository.js';
import { getActivityFeedDb } from './activity-feed-repository.js';
import {
  listSavedOutputsLibraryDb,
  listCollectionsDb,
  createCollectionDb,
  assignOutputCollectionDb,
  deleteSavedOutputDb,
  deleteMp4ExportDb,
  duplicateSavedOutputDb,
  incrementOutputDownloadDb,
  incrementMp4DownloadDb
} from './saved-outputs-repository.js';

const SPECIAL_EMAIL = 'h.asgarizade@gmail.com';

/** Stripe checkout.session.completed — full IDs + period end. */
export async function applyStripeCheckoutCompleted(userEmail, planKey, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd) {
  if (!isBillingDbConfigured() || !userEmail || !getPlanDef(planKey)) {
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
export async function applyStripeSubscriptionRenewal(
  userEmail,
  planKey,
  stripeCustomerId,
  stripeSubscriptionId,
  currentPeriodEnd,
  status = 'active',
  currentPeriodStart = null
) {
  if (!isBillingDbConfigured() || !userEmail || !getPlanDef(planKey)) return false;
  await syncStripeSubscriptionFromStripeObject(
    userEmail,
    planKey,
    stripeCustomerId,
    stripeSubscriptionId,
    currentPeriodEnd,
    status,
    currentPeriodStart
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
        .map((key) => {
          const p = PLANS[key];
          return {
            id: key,
            ...p,
            monthlyGenerationLimit: p.monthlyGenerationLimit ?? p.monthlyLimit,
            permissions: getPlanPermissions(key),
            tagline: PLAN_LABELS[key]?.tagline || null
          };
        });
      return res.json({ plans });
    }

    if (method === 'GET' && action === 'permissions') {
      return res.json(getComparisonMatrix());
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
        await backfillSubscriptionPeriodEndIfMissing(userId);
        subscriptionRow = await getSubscriptionRowByEmail(userId);
        planKey = resolvePlanKey(subscriptionRow?.plan || 'free');
        const creditsForEnd = await getCreditsSnapshot(userId);
        const periodEnd = resolveSubscriptionPeriodEnd(subscriptionRow, creditsForEnd);
        subShape = {
          plan: planKey,
          startDate:
            subscriptionRow?.current_period_start ||
            subscriptionRow?.started_at ||
            subscriptionRow?.created_at ||
            new Date(),
          endDate: periodEnd,
          billingPeriod: subscriptionRow?.billing_period || 'monthly'
        };
      }

      const plan = getPlanDef(planKey);
      const usage = await getLegacyUsageShape(userId);
      const creditsSnapshot = userId === SPECIAL_EMAIL
        ? { used: 0, remaining: 999999, limit: 999999, cycleStart: null, cycleEnd: subShape.endDate }
        : await getCreditsSnapshot(userId);
      const lifetime = userId === SPECIAL_EMAIL
        ? { outputs: 0, mp4Exports: 0, processingJobs: 0 }
        : await getLifetimeMetrics(userId);
      const subscriptionStatus = userId === SPECIAL_EMAIL ? 'active' : (subscriptionRow?.status || 'active');

      const responseData = {
        plan: planKey,
        planName: plan.nameEn || plan.name,
        planNameEn: plan.nameEn,
        planTagline: plan.tagline || PLAN_LABELS[planKey]?.tagline || null,
        features: plan.features,
        permissions: getPlanPermissions(planKey),
        monthlyGenerationLimit: creditsSnapshot.limit,
        creditsSnapshot,
        credits: {
          used: creditsSnapshot.used,
          limit: creditsSnapshot.limit,
          remaining: creditsSnapshot.remaining
        },
        lifetime,
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
          status: subscriptionStatus,
          startDate: subShape.startDate,
          endDate: subShape.endDate,
          billingPeriod: subShape.billingPeriod,
          stripeCustomerId: subscriptionRow?.stripe_customer_id || null,
          stripeSubscriptionId: subscriptionRow?.stripe_subscription_id || null,
          isExpired: userId === SPECIAL_EMAIL ? false : isSubscriptionPeriodExpired(subscriptionRow)
        }
      };

      return res.json(responseData);
    }

    if (method === 'GET' && action === 'billing') {
      try {
        const payload = await buildBillingDashboardPayload(userId);
        if (payload.error) {
          return res.status(503).json(emptyBillingPayload(payload.error));
        }
        return res.json({ ok: true, ...payload });
      } catch (billingErr) {
        console.error('[subscription] action=billing failed', billingErr);
        return res.status(500).json(emptyBillingPayload(billingErr?.message || 'Billing dashboard error'));
      }
    }

    if (method === 'GET' && action === 'check') {
      await ensureUserByEmail(userId);
      const feature = String(query.feature || 'transcription');
      const videoDurationMinutes = Math.max(0, Number.parseFloat(String(query.videoDurationMinutes || '0')) || 0);

      const check = await canUseFeature(userId, feature, videoDurationMinutes);

      const subscriptionRow =
        userId === SPECIAL_EMAIL ? { plan: 'business' } : await getSubscriptionRowByEmail(userId);
      const planKey = subscriptionRow?.plan || 'free';
      const plan = getPlanDef(planKey);
      const usage = await getLegacyUsageShape(userId);

      let nearLimit = false;
      if (planKey === 'free' && plan) {
        const dLim = plan.dailyLimit;
        const mLim = plan.monthlyLimit;
        const dUsed = Number(usage.daily?.minutes) || 0;
        const mUsed = Number(usage.monthly?.minutes) || 0;
        if (dLim != null && dLim > 0 && dUsed / dLim >= 0.8) nearLimit = true;
        if (mLim != null && mLim > 0 && mUsed / mLim >= 0.8) nearLimit = true;
      }

      return res.json({
        allowed: check.allowed !== false,
        reason: check.reason || null,
        nearLimit,
        plan: planKey,
        usage: {
          daily: usage.daily,
          monthly: usage.monthly,
          dailyLimit: plan?.dailyLimit ?? null,
          monthlyLimit: plan?.monthlyLimit ?? null
        }
      });
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
        const usage = await getLegacyUsageShape(userId);
        const subscriptionRow = userId === SPECIAL_EMAIL
          ? { plan: 'business' }
          : await getSubscriptionRowByEmail(userId);
        const pk = resolvePlanKey(subscriptionRow?.plan || 'free');
        const plan = getPlanDef(pk);
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

    if (method === 'GET' && action === 'activity') {
      const limit = parseInt(query.limit, 10) || 10;
      const filter = String(query.filter || 'all').toLowerCase();
      const allowedFilters = new Set(['all', 'processing', 'billing']);
      const events = await getActivityFeedDb(userId, {
        limit,
        filter: allowedFilters.has(filter) ? filter : 'all'
      });
      return res.json({ events, total: events.length });
    }

    if (method === 'GET' && action === 'savedOutputs') {
      const limit = parseInt(query.limit, 10) || 100;
      const outputs = await getSavedOutputsDb(userId, limit);
      return res.json({ outputs, total: outputs.length });
    }

    if (method === 'GET' && action === 'savedOutputsLibrary') {
      const payload = await listSavedOutputsLibraryDb(userId, {
        search: query.search || '',
        filter: query.filter || 'all',
        sort: query.sort || 'newest',
        collectionId: query.collectionId || null,
        limit: parseInt(query.limit, 10) || 500
      });
      console.log('[savedOutputsLibrary]', userId, payload.audit);
      return res.json({ ok: true, ...payload });
    }

    if (method === 'GET' && action === 'savedOutputCollections') {
      const collections = await listCollectionsDb(userId);
      return res.json({ collections });
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

    if (method === 'POST' && action === 'renameSavedOutput') {
      const { id, title } = body || {};
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }
      const ok = await renameSavedOutputDb(userId, id, title);
      if (!ok) return res.status(404).json({ error: 'Saved output not found' });
      return res.json({ success: true });
    }

    if (method === 'POST' && action === 'toggleSavedOutputFavorite') {
      const { id, favorite } = body || {};
      if (!id || typeof favorite !== 'boolean') {
        return res.status(400).json({ error: 'id and favorite are required' });
      }
      const ok = await toggleSavedOutputFavoriteDb(userId, id, favorite);
      if (!ok) return res.status(404).json({ error: 'Saved output not found' });
      return res.json({ success: true });
    }

    if (method === 'POST' && action === 'deleteSavedOutput') {
      const { id, kind } = body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      let ok = false;
      if (kind === 'mp4' || String(id).startsWith('mp4:')) {
        const exportId = String(id).replace(/^mp4:/, '');
        ok = await deleteMp4ExportDb(userId, exportId);
      } else {
        ok = await deleteSavedOutputDb(userId, id);
      }
      if (!ok) return res.status(404).json({ error: 'Output not found' });
      return res.json({ success: true });
    }

    if (method === 'POST' && action === 'duplicateSavedOutput') {
      const { id } = body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const newId = await duplicateSavedOutputDb(userId, id);
      if (!newId) return res.status(404).json({ error: 'Saved output not found' });
      return res.json({ success: true, id: newId });
    }

    if (method === 'POST' && action === 'recordSavedOutputDownload') {
      const { id, kind } = body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      let count = false;
      if (kind === 'mp4' || String(id).startsWith('mp4:')) {
        const exportId = String(id).replace(/^mp4:/, '');
        count = await incrementMp4DownloadDb(userId, exportId);
      } else {
        count = await incrementOutputDownloadDb(userId, id);
      }
      if (count === false) return res.status(404).json({ error: 'Output not found' });
      return res.json({ success: true, downloadCount: count });
    }

    if (method === 'POST' && action === 'createSavedOutputCollection') {
      const { name } = body || {};
      const col = await createCollectionDb(userId, name);
      if (!col) return res.status(400).json({ error: 'Collection name is required' });
      return res.json({ success: true, collection: col });
    }

    if (method === 'POST' && action === 'assignSavedOutputCollection') {
      const { id, collectionId } = body || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      const ok = await assignOutputCollectionDb(userId, id, collectionId || null);
      if (!ok) return res.status(404).json({ error: 'Output or collection not found' });
      return res.json({ success: true });
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
      if (!getPlanDef(plan)) {
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
