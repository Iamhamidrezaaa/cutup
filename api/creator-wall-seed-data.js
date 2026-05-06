/**
 * Curated Creator Wall entries (Phase 1) — shown when DB has no approved posts.
 */
export const CURATED_CREATOR_WALL_POSTS = [
  {
    id: 'seed-hormozi-1',
    stylePreset: 'hormozi',
    presetLabel: 'Alex Hormozi Style',
    platform: 'tiktok',
    language: 'en',
    countryCode: 'US',
    feedback: 'The Hormozi preset is insane.',
    captionLines: [['THIS', 'CHANGED'], ['MY', 'RETENTION']],
    creatorName: 'Maya R.',
    socialHandle: '@mayacuts',
    statsJson: { views: '1.2M', processingSec: 38 },
    cardSize: 'tall',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-mrbeast-1',
    stylePreset: 'mrbeast',
    presetLabel: 'MrBeast Style',
    platform: 'youtube',
    language: 'en',
    countryCode: 'GB',
    feedback: 'My Shorts retention improved instantly.',
    creatorName: 'James K.',
    socialHandle: '@jamesedits',
    statsJson: { views: '840K', processingSec: 52 },
    cardSize: 'standard',
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-ali-1',
    stylePreset: 'ali-abdaal',
    presetLabel: 'Ali Abdaal Style',
    platform: 'youtube',
    language: 'en',
    countryCode: 'CA',
    feedback: 'Finally subtitles that look professional.',
    creatorName: 'Priya S.',
    socialHandle: '@priyaproduces',
    statsJson: { views: '210K', processingSec: 44 },
    cardSize: 'wide',
    createdAt: new Date(Date.now() - 14 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-neon-1',
    stylePreset: 'tiktok-neon',
    presetLabel: 'TikTok Neon',
    platform: 'tiktok',
    language: 'en',
    countryCode: 'US',
    feedback: 'Way cleaner than CapCut subtitles.',
    creatorName: 'Alex T.',
    socialHandle: '@alextok',
    statsJson: { views: '2.1M', processingSec: 31 },
    cardSize: 'standard',
    createdAt: new Date(Date.now() - 22 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-luxury-1',
    stylePreset: 'luxury-minimal',
    presetLabel: 'Luxury Minimal',
    platform: 'instagram',
    language: 'en',
    countryCode: 'FR',
    feedback: 'This instantly made my clips look pro.',
    creatorName: 'Camille D.',
    socialHandle: '@camille.reels',
    statsJson: { views: '96K', processingSec: 41 },
    cardSize: 'tall',
    createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-podcast-1',
    stylePreset: 'podcast',
    presetLabel: 'Podcast Clean',
    platform: 'podcast',
    language: 'en',
    countryCode: 'AU',
    feedback: 'This saved me 2 hours per clip.',
    creatorName: 'Dan W.',
    socialHandle: '@danpodcuts',
    statsJson: { views: '45K', processingSec: 58 },
    cardSize: 'standard',
    createdAt: new Date(Date.now() - 48 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-hormozi-2',
    stylePreset: 'hormozi',
    presetLabel: 'Alex Hormozi Style',
    platform: 'instagram',
    language: 'es',
    countryCode: 'MX',
    feedback: 'Creators in my niche are asking what I use now.',
    creatorName: 'Sofia L.',
    socialHandle: '@sofia.crea',
    statsJson: { views: '320K', processingSec: 36 },
    cardSize: 'wide',
    createdAt: new Date(Date.now() - 67 * 60 * 1000).toISOString()
  },
  {
    id: 'seed-mrbeast-2',
    stylePreset: 'mrbeast',
    presetLabel: 'MrBeast Style',
    platform: 'tiktok',
    language: 'en',
    countryCode: 'DE',
    feedback: 'Export + burn-in in one click — unreal.',
    creatorName: 'Lukas H.',
    socialHandle: '@lukashooks',
    statsJson: { views: '1.5M', processingSec: 47 },
    cardSize: 'tall',
    createdAt: new Date(Date.now() - 95 * 60 * 1000).toISOString()
  }
];

export function getCuratedPublicStats() {
  return {
    videosThisWeek: 12_584,
    subtitlesGenerated: 284_921,
    creatorsOnboarded: 18_432,
    exportMinutesRendered: 92_418,
    source: 'hybrid',
    phase: 1,
    serverTime: Date.now(),
    incrementRates: {
      exportsPerSec: 0.42,
      subtitlesPerSec: 2.8,
      creatorsPerSec: 0.06,
      highlightsPerSec: 0.95
    }
  };
}
