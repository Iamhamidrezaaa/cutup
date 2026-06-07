/**
 * CutUp plan permissions — single source of truth for product access.
 * Keep pricing table, plans-config.js, and enforcement aligned with this file.
 */

export const PLAN_ORDER = ['free', 'starter', 'pro', 'business'];

export const PLAN_LABELS = {
  free: { name: 'Free', tagline: 'For trying CutUp' },
  starter: { name: 'Starter', tagline: 'Caption & Transcript Plan' },
  pro: { name: 'Pro', tagline: 'Video Creator Plan' },
  business: { name: 'Business', tagline: 'Teams & Agencies' }
};

export const PLAN_CREDITS = {
  free: 3,
  starter: 15,
  pro: 35,
  business: 100
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
    canExportMp4: false,
    canUseCreatorStyles: false,
    canUsePremiumStyles: false,
    canUseBurnedCaptions: false,
    canUsePriorityQueue: false,
    canUseTeams: false,
    canUsePrioritySupport: false
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
    canExportMp4: false,
    canUseCreatorStyles: false,
    canUsePremiumStyles: false,
    canUseBurnedCaptions: false,
    canUsePriorityQueue: false,
    canUseTeams: false,
    canUsePrioritySupport: false
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
    canUsePrioritySupport: false
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
    canUseTeams: true,
    canUsePrioritySupport: true
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
  mp4Export: { permission: 'canExportMp4', consumesCredit: true },
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
  canExportMp4: 'MP4 export is available on Pro and Business plans.',
  canUseCreatorStyles: 'Creator styles are available on Pro and Business plans.',
  canUsePremiumStyles: 'Premium styles are available on Pro and Business plans.',
  canUseBurnedCaptions: 'Burned-in captions are available on Pro and Business plans.',
  canUsePriorityQueue: 'Priority export queue is available on Pro and Business plans.',
  canUseTeams: 'Business plan required.',
  canUsePrioritySupport: 'Priority support is available on the Business plan.',
  canUseAiCaptions: 'Sign in to use AI captions.',
  canUseSummary: 'Summary generation is included on all plans.',
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
    downloadAudio: k !== 'free',
    downloadVideo: k !== 'free',
    maxVideoQuality: k === 'free' ? '480p' : 'unlimited'
  };
}

export function getComparisonMatrix() {
  return {
    credits: PLAN_CREDITS,
    permissions: PLAN_PERMISSIONS,
    labels: PLAN_LABELS
  };
}
