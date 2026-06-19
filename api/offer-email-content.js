import { PLAN_CREDITS, PLAN_LABELS, PLAN_PERMISSIONS, resolvePlanKey } from './plans/permissions.js';

const SITE_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

const FEATURE_LABELS = {
  canTranslate: 'AI Translation for multilingual captions',
  canExportTxt: 'TXT export for transcripts',
  canExportDocx: 'DOCX export',
  canDownloadSrt: 'SRT subtitle download',
  canViewProjectHistory: 'Full project history',
  canExportMp4: 'MP4 export with burned-in captions',
  canUseCreatorStyles: 'Creator caption styles',
  canUsePremiumStyles: 'Premium caption styles',
  canUseBurnedCaptions: 'Burned-in captions on exports',
  canUsePriorityQueue: 'Priority export queue',
  canUseTeams: 'Team workspace & collaboration',
  canUsePrioritySupport: 'Priority support',
};

export function formatPlanLabel(planKey) {
  const k = resolvePlanKey(planKey);
  return PLAN_LABELS[k]?.name || k.charAt(0).toUpperCase() + k.slice(1);
}

export function formatDiscountLabel(discountType, discountValue) {
  const type = String(discountType || 'percentage').trim().toLowerCase();
  const val = Number(discountValue || 0);
  if (type === 'fixed_eur') return `€${val.toFixed(2)} off`;
  return `${Math.round(val)}% off`;
}

export function formatExpiresLabel(expiresAt) {
  if (!expiresAt) return 'No expiry date';
  try {
    return new Date(expiresAt).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch (_e) {
    return String(expiresAt);
  }
}

/** Human-readable upgrade bullets for email — { bold, rest } pairs. */
export function getPlanUpgradeHighlights(sourcePlan, targetPlan) {
  const src = resolvePlanKey(sourcePlan || 'free');
  const tgt = resolvePlanKey(targetPlan || 'pro');
  if (src === tgt) return [];

  const highlights = [];
  const srcCredits = Number(PLAN_CREDITS[src] || 0);
  const tgtCredits = Number(PLAN_CREDITS[tgt] || 0);
  if (tgtCredits > srcCredits) {
    highlights.push({
      bold: `${tgtCredits} videos per month`,
      rest: ` — up from ${srcCredits} on ${formatPlanLabel(src)}`,
    });
  }

  const srcPerms = PLAN_PERMISSIONS[src] || {};
  const tgtPerms = PLAN_PERMISSIONS[tgt] || {};
  for (const [key, label] of Object.entries(FEATURE_LABELS)) {
    if (!srcPerms[key] && tgtPerms[key]) {
      highlights.push({ bold: label, rest: '' });
    }
  }

  if (!highlights.length) {
    highlights.push({
      bold: `${formatPlanLabel(tgt)} plan access`,
      rest: ` — more credits and premium tools than ${formatPlanLabel(src)}`,
    });
  }

  return highlights;
}

export function buildOfferCheckoutUrl({ plan, coupon, source = 'offer_email' }) {
  const normalizedPlan = resolvePlanKey(plan || 'pro');
  if (normalizedPlan === 'free') return `${SITE_URL}/dashboard.html#subscription`;
  const params = new URLSearchParams();
  params.set('dest', 'checkout');
  params.set('plan', normalizedPlan);
  params.set('source', source);
  const code = String(coupon || '').trim();
  if (code) params.set('coupon', code);
  return `${SITE_URL}/go.html?${params.toString()}`;
}

export function inferFirstNameFromEmail(email, fallback = 'there') {
  const local = String(email || '').split('@')[0]?.trim();
  if (!local) return fallback;
  const chunk = local.split(/[._-]+/)[0] || local;
  if (!chunk) return fallback;
  return chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase();
}
