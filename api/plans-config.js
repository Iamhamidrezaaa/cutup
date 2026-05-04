/**
 * Plan definitions (limits + features). Source of truth for enforcement logic.
 * `publicOffer: false` — kept in DB / legacy paths only; hidden from GET /api/subscription?action=plans.
 * Customer-facing amounts in `priceEur` are in euros (EUR); numerics unchanged from former USD display.
 */
export const PLANS = {
  free: {
    name: 'Free',
    nameEn: 'Free',
    dailyLimit: 5,
    monthlyLimit: 15,
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
    monthlyLimit: 120,
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
    priceEur: { monthly: 9.99 }
  },
  pro: {
    name: 'Pro',
    nameEn: 'Pro',
    monthlyLimit: 300,
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
    priceEur: { monthly: 19.99 }
  },
  advanced: {
    name: 'Advanced',
    nameEn: 'Advanced',
    monthlyLimit: 2000,
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
    price: { monthly: 0, quarterly: 0, semiannual: 0, annual: 0 },
    priceEur: { monthly: 39.99 }
  },
  business: {
    publicOffer: false,
    name: 'Business',
    nameEn: 'Business',
    monthlyLimit: 600,
    downloadAudioLimit: null,
    downloadVideoLimit: null,
    features: {
      transcription: true,
      summarization: true,
      srt: true,
      downloadAudio: true,
      downloadVideo: true,
      maxVideoQuality: 'unlimited'
    },
    price: { monthly: 1800000, quarterly: 4860000, semiannual: 9180000, annual: 16200000 },
    priceEur: { monthly: 0 }
  }
};
