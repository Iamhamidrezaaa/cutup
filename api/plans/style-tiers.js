/**
 * Subtitle preset tiers — keep pricing, export API, and UI aligned.
 */
import { resolvePlanKey } from '../plans-config.js';

export const BASIC_PRESET_IDS = new Set([
  'clean-srt',
  'cleansrt',
  'ali-abdaal',
  'aliabdaal',
  'podcast',
]);

export const PREMIUM_PRESET_IDS = new Set(['tiktok-neon', 'tiktokneon', 'luxury-minimal', 'luxuryminimal']);

/** Normalize kebab/camel/server ids to comparison keys. */
export function normalizePresetKey(presetId) {
  return String(presetId || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');
}

export function getStyleTier(presetId) {
  const key = normalizePresetKey(presetId);
  if (PREMIUM_PRESET_IDS.has(key)) return 'premium';
  if (BASIC_PRESET_IDS.has(key)) return 'basic';
  return 'creator';
}

export function canUsePresetForPlan(presetId, planKey) {
  const tier = getStyleTier(presetId);
  const plan = resolvePlanKey(planKey);
  if (tier === 'basic') {
    return plan === 'free' || plan === 'starter' || plan === 'pro' || plan === 'business';
  }
  if (tier === 'creator' || tier === 'premium') {
    return plan === 'pro' || plan === 'business';
  }
  return false;
}

export function permissionKeyForStyleTier(tier) {
  if (tier === 'premium') return 'canUsePremiumStyles';
  if (tier === 'creator') return 'canUseCreatorStyles';
  return 'canUseBasicStyles';
}
