/**
 * Plan definitions (limits + features). Source of truth for enforcement logic.
 * `publicOffer: false` — kept in DB / legacy paths only; hidden from GET /api/subscription?action=plans.
 * Customer-facing amounts in `priceEur` are in euros (EUR); numerics unchanged from former USD display.
 */
/**
 * Quota model: `monthlyLimit` + `minutes_used` track **completed generations** (1 per successful transcript run).
 * `monthlyGenerationLimit` mirrors that for messaging; keep in sync with website/plan-display.js.
 * `maxJobMinutes`: single-run cap for abuse (precheck only).
 */
export const PLANS = {
  free: {
    name: 'Free',
    nameEn: 'Free',
    monthlyGenerationLimit: 3,
    maxJobMinutes: 180,
    dailyLimit: 100000,
    monthlyLimit: 3,
    downloadAudioLimit: 3,
    downloadVideoLimit: 3,
    features: {
      transcription: true,
      summarization: true,
      srt: false,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: '480p'
    },
    price: { monthly: 0, quarterly: 0, semiannual: 0, annual: 0 },
    priceEur: { monthly: 0 }
  },
  starter: {
    name: 'Starter',
    nameEn: 'Starter',
    monthlyGenerationLimit: 15,
    maxJobMinutes: 240,
    dailyLimit: 100000,
    monthlyLimit: 15,
    downloadAudioLimit: 20,
    downloadVideoLimit: 20,
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: { monthly: 360000, quarterly: 972000, semiannual: 1836000, annual: 3240000 },
    priceEur: { monthly: 9 }
  },
  pro: {
    name: 'Pro',
    nameEn: 'Pro',
    monthlyGenerationLimit: 35,
    maxJobMinutes: 300,
    dailyLimit: 100000,
    monthlyLimit: 35,
    downloadAudioLimit: 100,
    downloadVideoLimit: 100,
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: { monthly: 900000, quarterly: 2430000, semiannual: 4590000, annual: 8100000 },
    priceEur: { monthly: 19 }
  },
  business: {
    name: 'Business',
    nameEn: 'Business',
    monthlyGenerationLimit: 100,
    maxJobMinutes: 480,
    dailyLimit: 100000,
    monthlyLimit: 100,
    downloadAudioLimit: 200,
    downloadVideoLimit: 200,
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: { monthly: 1800000, quarterly: 4860000, semiannual: 9180000, annual: 16200000 },
    priceEur: { monthly: 49 }
  }
};

/** Legacy DB / Stripe metadata key maps to Business entitlements. */
export function resolvePlanKey(planKey) {
  const k = String(planKey || '').trim().toLowerCase();
  if (k === 'advanced') return 'business';
  return k;
}

export function getPlanDef(planKey) {
  const k = resolvePlanKey(planKey);
  return PLANS[k] || null;
}
