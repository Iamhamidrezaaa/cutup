import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { getSubscriptionRowByEmail, getUserIdByEmail } from './billing-repository.js';
import { getPool } from './db/pool.js';
import { getActiveOffersForUser, normalizePlanName, validateOfferForCheckout } from './offers-repository.js';
import { ensureOffersSchema } from './offers-bootstrap.js';

function effectiveTargetFromOffer(o) {
  const t = normalizePlanName(o.targetPlan);
  if (t) return t;
  if (Array.isArray(o.applicablePlans) && o.applicablePlans.length) {
    return normalizePlanName(o.applicablePlans[0]);
  }
  return '';
}

function buildOfferPipelineDiagnostics(offers, planKey, nowTs, redeemedOfferIds) {
  return offers.map((o) => {
    const blockedActive = [];
    if (!o.active) blockedActive.push('inactive');
    if (o.userOfferStatus !== 'active') blockedActive.push(`assignment_${o.userOfferStatus || 'unknown'}`);
    if (o.expiresAt && new Date(o.expiresAt).getTime() <= nowTs) blockedActive.push('expired');
    if (redeemedOfferIds?.has(String(o.id))) blockedActive.push('already_redeemed');

    const sourcePlan = normalizePlanName(o.sourcePlan);
    const targetPlan = effectiveTargetFromOffer(o);
    const blockedEligible = [];
    if (planKey) {
      if (sourcePlan && sourcePlan !== planKey) blockedEligible.push('source_plan_mismatch');
      if (targetPlan && targetPlan === planKey) blockedEligible.push('target_equals_user_plan');
      if (Array.isArray(o.applicablePlans) && o.applicablePlans.length) {
        const needle = targetPlan || planKey;
        if (!o.applicablePlans.includes(needle)) blockedEligible.push('applicable_plans_mismatch');
      }
    }

    return {
      code: o.code,
      offerIdShort: String(o.id || '').replace(/-/g, '').slice(0, 8),
      offer_source_plan: o.sourcePlan,
      offer_target_plan: o.targetPlan,
      applicablePlans: o.applicablePlans,
      effectiveTargetInferred: targetPlan || null,
      blockedFromActive: blockedActive,
      blockedFromEligible: blockedEligible
    };
  });
}

function requireSession(req, res) {
  const sid = req.headers['x-session-id'];
  if (!sid) {
    res.status(401).json({ ok: false, error: 'no_session' });
    return null;
  }
  const s = sessions.get(sid);
  if (!s?.user?.email) {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return null;
  }
  return { email: s.user.email };
}

export default async function handler(req, res) {
  try {
    setCORSHeaders(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const auth = requireSession(req, res);
    if (!auth) return;
    const userId = await getUserIdByEmail(auth.email);
    if (!userId) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const schema = await ensureOffersSchema();
    if (!schema.ok) {
      if (req.method === 'GET') return res.status(200).json({ ok: true, offers: [], recommended: null, degraded: true });
      return res.status(503).json({ ok: false, error: 'offers_unavailable', degraded: true });
    }

    if (req.method === 'GET') {
      const subRow = await getSubscriptionRowByEmail(auth.email);
      const dbPlanRaw = subRow?.plan != null ? String(subRow.plan) : null;
      const normalizedFromDb = normalizePlanName(dbPlanRaw);
      const planFromQuery = normalizePlanName(req.query?.plan);
      const planKey = planFromQuery || normalizedFromDb;

      console.log('[user-plan-debug]', {
        userIdShort: String(userId).replace(/-/g, '').slice(0, 8),
        dbPlanRaw,
        normalizedPlan: normalizedFromDb || null,
        planFromQuery: planFromQuery || null,
        effectivePlanKeyUsed: planKey || null,
        queryMatchesSubscription: !planFromQuery || !normalizedFromDb || planFromQuery === normalizedFromDb
      });

      const offers = await getActiveOffersForUser(userId);
      let redeemedIds = new Set();
      try {
        const redemptionR = await getPool().query(
          `SELECT offer_id::text AS oid FROM offer_redemptions WHERE user_id = $1::uuid`,
          [userId]
        );
        redeemedIds = new Set((redemptionR.rows || []).map((row) => row.oid));
      } catch (_e) {
        redeemedIds = new Set();
      }

      const now = Date.now();
      const active = offers.filter((o) =>
        o.active &&
        o.userOfferStatus === 'active' &&
        (!o.expiresAt || new Date(o.expiresAt).getTime() > now) &&
        !redeemedIds.has(String(o.id))
      );
      const eligible = planKey
        ? active.filter((o) => {
          const sourcePlan = normalizePlanName(o.sourcePlan);
          const targetPlan = effectiveTargetFromOffer(o);
          if (sourcePlan && sourcePlan !== planKey) return false;
          if (targetPlan && targetPlan === planKey) return false;
          if (!Array.isArray(o.applicablePlans) || !o.applicablePlans.length) return true;
          const needle = targetPlan || planKey;
          return o.applicablePlans.includes(needle);
        })
        : active;
      const recommended = eligible
        .slice()
        .sort((a, b) => Number(b.discountValue || 0) - Number(a.discountValue || 0))[0] || null;

      const pipeline = buildOfferPipelineDiagnostics(offers, planKey, now, redeemedIds);
      console.log('[offers-api]', {
        userPlan: planKey || null,
        rawAssignedRows: offers.length,
        afterActiveGate: active.length,
        eligibleOffers: eligible.length,
        selectedOffer: recommended?.code || null,
        responseShape: { offersCountReturned: active.length, recommendedCode: recommended?.code || null },
        pipeline
      });
      return res.status(200).json({ ok: true, offers: active, recommended });
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      const code = String(body.code || '').trim();
      const planKey = normalizePlanName(body.planKey || body.plan);
      const amountEur = Number(body.amountEur || 0);
      const out = await validateOfferForCheckout({ userId, planKey, code, amountEur });
      if (!out.ok) {
        return res.status(400).json({ ok: false, error: out.reason || 'invalid_or_expired' });
      }
      return res.status(200).json({
        ok: true,
        offer: out.offer,
        pricing: {
          originalAmountEur: out.originalAmountEur,
          discountAmountEur: out.discountAmountEur,
          finalAmountEur: out.finalAmountEur
        }
      });
    }
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (e) {
    if (req.method === 'GET') return res.status(200).json({ ok: true, offers: [], recommended: null, degraded: true });
    return res.status(500).json({ ok: false, error: 'offers_handler_failed' });
  }
}
