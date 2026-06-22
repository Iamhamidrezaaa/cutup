/**
 * CutUp plan permissions — single source of truth for product access.
 * Keep pricing table, plans-config.js, and enforcement aligned with this file.
 */

export const PLAN_ORDER = ['free', 'starter', 'pro', 'business'];

export const PLAN_LABELS = {
  free: { name: 'Free', tagline: 'Try CutUp with real exports' },
  starter: { name: 'Starter', tagline: 'Perfect for occasional creators' },
  pro: { name: 'Pro', tagline: 'Everything needed to create viral-ready videos' },
  business: { name: 'Business', tagline: 'For agencies and content teams' }
};

export const PLAN_CREDITS = {
  free: 3,
  starter: 15,
  pro: 35,
  business: 100
};

/** MP4 export tier labels for the pricing comparison table. */
export const PLAN_MP4_EXPORT_TIERS = {
  free: 'Limited',
  starter: 'Basic',
  pro: 'Full',
  business: 'Full'
};

/** Monthly MP4 export allowance shown in pricing (separate from video credits). */
export const PLAN_MP4_EXPORT_LIMITS = {
  free: 1,
  starter: 5,
  pro: 35,
  business: 100
};

/** Per-plan bullet lists for mobile pricing cards. */
export const PLAN_PRICING_FEATURES = {
  free: [
    '3 monthly video credits',
    '1 MP4 export',
    'Watermark',
    'Basic styles',
    'AI captions',
    'Transcript',
    'Summary'
  ],
  starter: [
    '15 monthly video credits',
    '5 MP4 exports',
    'No watermark',
    'Translation',
    'TXT export',
    'DOCX export'
  ],
  pro: [
    '35 monthly video credits',
    '35 MP4 exports',
    'Translation',
    'Premium caption styles',
    'Priority processing',
    'Advanced exports'
  ],
  business: [
    '100 monthly video credits',
    '100 MP4 exports',
    'Translation',
    'Premium caption styles',
    'Priority processing',
    'Priority support',
    'Agency features'
  ]
};

/** @typedef {keyof typeof PLAN_PERMISSIONS.free} PermissionKey */

export const PLAN_PERMISSIONS = {
  free: {
    canUseAiCaptions: true,
    canUseSummary: true,
    canUseBasicTranscript: true,
    canTranslate: false,
    canExportTxt: false,
    canExportDocx: false,
    canDownloadSrt: false,
    canViewProjectHistory: false,
    canExportMp4: true,
    canUseCreatorStyles: false,
    canUsePremiumStyles: false,
    canUseBurnedCaptions: false,
    canUsePriorityQueue: false,
    canUseTeams: false,
    canUsePrioritySupport: false,
    hasWatermark: true,
    canWatermarkFreeExport: false,
    canUseBasicStyles: true,
    canUseAdvancedExports: false,
    canUseAgencyFeatures: false
  },
  starter: {
    canUseAiCaptions: true,
    canUseSummary: true,
    canUseBasicTranscript: true,
    canTranslate: true,
    canExportTxt: true,
    canExportDocx: true,
    canDownloadSrt: true,
    canViewProjectHistory: true,
    canExportMp4: true,
    canUseCreatorStyles: false,
    canUsePremiumStyles: false,
    canUseBurnedCaptions: false,
    canUsePriorityQueue: false,
    canUseTeams: false,
    canUsePrioritySupport: false,
    hasWatermark: false,
    canWatermarkFreeExport: true,
    canUseBasicStyles: true,
    canUseAdvancedExports: false,
    canUseAgencyFeatures: false
  },
  pro: {
    canUseAiCaptions: true,
    canUseSummary: true,
    canUseBasicTranscript: true,
    canTranslate: true,
    canExportTxt: true,
    canExportDocx: true,
    canDownloadSrt: true,
    canViewProjectHistory: true,
    canExportMp4: true,
    canUseCreatorStyles: true,
    canUsePremiumStyles: true,
    canUseBurnedCaptions: true,
    canUsePriorityQueue: true,
    canUseTeams: false,
    canUsePrioritySupport: false,
    hasWatermark: false,
    canWatermarkFreeExport: true,
    canUseBasicStyles: false,
    canUseAdvancedExports: true,
    canUseAgencyFeatures: false
  },
  business: {
    canUseAiCaptions: true,
    canUseSummary: true,
    canUseBasicTranscript: true,
    canTranslate: true,
    canExportTxt: true,
    canExportDocx: true,
    canDownloadSrt: true,
    canViewProjectHistory: true,
    canExportMp4: true,
    canUseCreatorStyles: true,
    canUsePremiumStyles: true,
    canUseBurnedCaptions: true,
    canUsePriorityQueue: true,
    canUseTeams: false,
    canUsePrioritySupport: true,
    hasWatermark: false,
    canWatermarkFreeExport: true,
    canUseBasicStyles: false,
    canUseAdvancedExports: true,
    canUseAgencyFeatures: true
  }
};

/** API / product feature keys → permission + credit behavior */
export const API_FEATURE_MAP = {
  transcription: { permission: 'canUseAiCaptions', consumesCredit: true },
  summarization: { permission: 'canUseSummary', consumesCredit: false },
  translate: { permission: 'canTranslate', consumesCredit: true },
  subtitles: { permission: 'canTranslate', consumesCredit: true },
  exportTxt: { permission: 'canExportTxt', consumesCredit: false },
  exportDocx: { permission: 'canExportDocx', consumesCredit: false },
  srt: { permission: 'canDownloadSrt', consumesCredit: true },
  subtitles_download: { permission: 'canDownloadSrt', consumesCredit: true },
  mp4Export: { permission: 'canExportMp4', consumesCredit: false },
  creatorStyles: { permission: 'canUseCreatorStyles', consumesCredit: false },
  premiumStyles: { permission: 'canUsePremiumStyles', consumesCredit: false },
  burnedCaptions: { permission: 'canUseBurnedCaptions', consumesCredit: false },
  projectHistory: { permission: 'canViewProjectHistory', consumesCredit: false },
  teams: { permission: 'canUseTeams', consumesCredit: false },
  prioritySupport: { permission: 'canUsePrioritySupport', consumesCredit: false },
  downloadAudio: { permission: null, legacyDownload: 'audio' },
  downloadVideo: { permission: null, legacyDownload: 'video' }
};

export const UPGRADE_MESSAGES = {
  canTranslate: 'This feature requires Starter or higher.',
  canExportTxt: 'TXT export is available on Starter and above.',
  canExportDocx: 'DOCX export is available on Starter and above.',
  canDownloadSrt: 'SRT download is available on Starter and above.',
  canViewProjectHistory: 'Project history is available on Starter and above.',
  canExportMp4: 'Upgrade your plan for more MP4 export capacity.',
  canWatermarkFreeExport: 'Watermark-free export is available on Starter and above.',
  canUseCreatorStyles: 'Creator styles are available on Pro and Business plans.',
  canUsePremiumStyles: 'Premium styles are available on Pro and Business plans.',
  canUseBurnedCaptions: 'Burned-in captions are available on Pro and Business plans.',
  canUsePriorityQueue: 'Priority export queue is available on Pro and Business plans.',
  canUseTeams: 'Business plan required.',
  canUsePrioritySupport: 'Priority support is available on the Business plan.',
  canUseAiCaptions: 'Sign in to use AI captions.',
  canUseSummary: 'Summary generation is included on all plans.',
  canUseAgencyFeatures: 'Agency features are available on the Business plan.',
  canUseAdvancedExports: 'Advanced exports are available on Pro and Business plans.',
  canUseBasicStyles: 'Basic styles are included on Free and Starter plans.',
  canUseBasicTranscript: 'Transcript preview is included on all plans.'
};

export function resolvePlanKey(planKey) {
  const k = String(planKey || 'free').trim().toLowerCase();
  if (k === 'advanced') return 'business';
  return PLAN_ORDER.includes(k) ? k : 'free';
}

export function getPlanPermissions(planKey) {
  const k = resolvePlanKey(planKey);
  return { ...PLAN_PERMISSIONS[k] };
}

export function hasPermission(planKey, permission) {
  const perms = getPlanPermissions(planKey);
  return Boolean(perms[permission]);
}

export function getMinimumPlanForPermission(permission) {
  for (const plan of PLAN_ORDER) {
    if (PLAN_PERMISSIONS[plan][permission]) return plan;
  }
  return null;
}

export function getUpgradeMessage(permission) {
  return UPGRADE_MESSAGES[permission] || 'This feature is not available on your current plan.';
}

export function resolveApiFeature(feature) {
  const key = String(feature || '').trim();
  if (key === 'subtitles') return API_FEATURE_MAP.translate;
  return API_FEATURE_MAP[key] || null;
}

/** Legacy `plan.features` shape for older clients */
export function buildLegacyFeatures(planKey) {
  const p = getPlanPermissions(planKey);
  const k = resolvePlanKey(planKey);
  return {
    transcription: p.canUseAiCaptions,
    summarization: p.canUseSummary,
    srt: p.canDownloadSrt,
    mp4Export: p.canExportMp4,
    translate: p.canTranslate,
    exportTxt: p.canExportTxt,
    exportDocx: p.canExportDocx,
    projectHistory: p.canViewProjectHistory,
    creatorStyles: p.canUseCreatorStyles,
    premiumStyles: p.canUsePremiumStyles,
    burnedCaptions: p.canUseBurnedCaptions,
    priorityQueue: p.canUsePriorityQueue,
    teams: p.canUseTeams,
    prioritySupport: p.canUsePrioritySupport,
    downloadAudio: true,
    downloadVideo: true,
    maxVideoQuality: k === 'free' ? '480p' : 'unlimited'
  };
}

export function getMp4ExportLimit(planKey) {
  const k = resolvePlanKey(planKey);
  return PLAN_MP4_EXPORT_LIMITS[k] ?? 0;
}

export function getComparisonMatrix() {
  return {
    credits: PLAN_CREDITS,
    mp4ExportLimits: PLAN_MP4_EXPORT_LIMITS,
    mp4ExportTiers: PLAN_MP4_EXPORT_TIERS,
    pricingFeatures: PLAN_PRICING_FEATURES,
    permissions: PLAN_PERMISSIONS,
    labels: PLAN_LABELS
  };
}
