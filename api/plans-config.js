/**
 * Plan definitions (limits + pricing). Feature access is defined in api/plans/permissions.js.
 */
import {
  PLAN_CREDITS,
  PLAN_LABELS,
  buildLegacyFeatures,
  resolvePlanKey as resolvePermissionPlanKey
} from './plans/permissions.js';

/**
 * Quota model: `monthlyLimit` tracks completed generations (1 per successful transcript run).
 * `maxJobMinutes`: single-run cap for abuse (precheck only).
 */
export const PLANS = {
  free: {
    name: PLAN_LABELS.free.name,
    nameEn: PLAN_LABELS.free.name,
    tagline: PLAN_LABELS.free.tagline,
    monthlyGenerationLimit: PLAN_CREDITS.free,
    maxJobMinutes: 180,
    dailyLimit: 100000,
    monthlyLimit: PLAN_CREDITS.free,
    downloadAudioLimit: 3,
    downloadVideoLimit: 3,
    features: buildLegacyFeatures('free'),
    price: { monthly: 0, quarterly: 0, semiannual: 0, annual: 0 },
    priceEur: { monthly: 0 }
  },
  starter: {
    name: PLAN_LABELS.starter.name,
    nameEn: PLAN_LABELS.starter.name,
    tagline: PLAN_LABELS.starter.tagline,
    monthlyGenerationLimit: PLAN_CREDITS.starter,
    maxJobMinutes: 240,
    dailyLimit: 100000,
    monthlyLimit: PLAN_CREDITS.starter,
    downloadAudioLimit: 20,
    downloadVideoLimit: 20,
    features: buildLegacyFeatures('starter'),
    price: { monthly: 360000, quarterly: 972000, semiannual: 1836000, annual: 3240000 },
    priceEur: { monthly: 7.99 }
  },
  pro: {
    name: PLAN_LABELS.pro.name,
    nameEn: PLAN_LABELS.pro.name,
    tagline: PLAN_LABELS.pro.tagline,
    monthlyGenerationLimit: PLAN_CREDITS.pro,
    maxJobMinutes: 300,
    dailyLimit: 100000,
    monthlyLimit: PLAN_CREDITS.pro,
    downloadAudioLimit: 100,
    downloadVideoLimit: 100,
    features: buildLegacyFeatures('pro'),
    price: { monthly: 900000, quarterly: 2430000, semiannual: 4590000, annual: 8100000 },
    priceEur: { monthly: 19.99 }
  },
  business: {
    name: PLAN_LABELS.business.name,
    nameEn: PLAN_LABELS.business.name,
    tagline: PLAN_LABELS.business.tagline,
    monthlyGenerationLimit: PLAN_CREDITS.business,
    maxJobMinutes: 480,
    dailyLimit: 100000,
    monthlyLimit: PLAN_CREDITS.business,
    downloadAudioLimit: 200,
    downloadVideoLimit: 200,
    features: buildLegacyFeatures('business'),
    price: { monthly: 1800000, quarterly: 4860000, semiannual: 9180000, annual: 16200000 },
    priceEur: { monthly: 49.99 }
  }
};

/** Legacy DB / Stripe metadata key maps to Business entitlements. */
export function resolvePlanKey(planKey) {
  return resolvePermissionPlanKey(planKey);
}

export function getPlanDef(planKey) {
  const k = resolvePlanKey(planKey);
  return PLANS[k] || null;
}
