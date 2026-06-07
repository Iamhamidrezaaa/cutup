/**
 * Browser mirror of api/plans/permissions.js — keep in sync.
 * Runtime truth comes from GET /api/subscription?action=info → permissions.
 */
(function () {
  'use strict';

  var PLAN_ORDER = ['free', 'starter', 'pro', 'business'];

  var PLAN_CREDITS = { free: 3, starter: 15, pro: 35, business: 100 };

  /** Keep in sync with api/plans/permissions.js PLAN_LABELS + api/plans-config.js priceEur */
  var PLAN_LABELS = {
    free: { name: 'Free', tagline: 'For trying CutUp' },
    starter: { name: 'Starter', tagline: 'Caption & Transcript Plan' },
    pro: { name: 'Pro', tagline: 'Video Creator Plan' },
    business: { name: 'Business', tagline: 'Teams & Agencies' }
  };

  var PLAN_PRICES = {
    free: { display: '€0', monthly: 0 },
    starter: { display: '€7.99/mo', monthly: 7.99 },
    pro: { display: '€19.99/mo', monthly: 19.99 },
    business: { display: '€49.99/mo', monthly: 49.99 }
  };

  /** Pricing matrix rows — permission keys drive ✅/❌ cells */
  var MATRIX_FEATURES = [
    { id: 'credits', label: 'Monthly video processing credits', type: 'credits', highlight: true },
    { id: 'canUseAiCaptions', label: 'AI captions' },
    { id: 'canUseSummary', label: 'Summary generation' },
    { id: 'canUseBasicTranscript', label: 'Basic transcript' },
    { id: 'canTranslate', label: 'Translation' },
    { id: 'canExportTxt', label: 'TXT export' },
    { id: 'canExportDocx', label: 'DOCX export' },
    { id: 'canViewProjectHistory', label: 'Project history' },
    { id: 'canExportMp4', label: 'MP4 export', upgradeTrigger: true },
    { id: 'canUseCreatorStyles', label: 'Creator styles' },
    { id: 'canUsePremiumStyles', label: 'Premium styles' },
    { id: 'canUseBurnedCaptions', label: 'Burned-in captions' },
    { id: 'canUsePriorityQueue', label: 'Export queue priority' },
    { id: 'canUseTeams', label: 'Team usage' },
    { id: 'canUsePrioritySupport', label: 'Priority support' }
  ];

  var UPGRADE_BENEFIT_LABELS = {
    canTranslate: 'Translation',
    canExportTxt: 'TXT export',
    canExportDocx: 'DOCX export',
    canViewProjectHistory: 'Project history',
    canExportMp4: 'MP4 exports',
    canUseCreatorStyles: 'Creator styles',
    canUsePremiumStyles: 'Premium styles',
    canUseBurnedCaptions: 'Burned-in captions',
    canUsePriorityQueue: 'Priority export queue',
    canUseTeams: 'Team usage',
    canUsePrioritySupport: 'Priority support'
  };

  var PLAN_PERMISSIONS = {
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

  var UPGRADE_MESSAGES = {
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
    canUsePrioritySupport: 'Priority support is available on the Business plan.'
  };

  function resolvePlanKey(planKey) {
    var k = String(planKey || 'free').toLowerCase();
    if (k === 'advanced') return 'business';
    return PLAN_ORDER.indexOf(k) >= 0 ? k : 'free';
  }

  function getPermissions(planKey) {
    return Object.assign({}, PLAN_PERMISSIONS[resolvePlanKey(planKey)]);
  }

  function hasPermission(planKey, permission) {
    return Boolean(getPermissions(planKey)[permission]);
  }

  function getUpgradeMessage(permission) {
    return UPGRADE_MESSAGES[permission] || 'This feature is not available on your current plan.';
  }

  function getCreditsLimit(planKey) {
    return PLAN_CREDITS[resolvePlanKey(planKey)] || PLAN_CREDITS.free;
  }

  function planRank(planKey) {
    return PLAN_ORDER.indexOf(resolvePlanKey(planKey));
  }

  function getNextPlanKey(planKey) {
    var r = planRank(planKey);
    if (r < 0 || r >= PLAN_ORDER.length - 1) return null;
    return PLAN_ORDER[r + 1];
  }

  function getUpgradeBenefits(planKey) {
    var next = getNextPlanKey(planKey);
    if (!next) return [];
    var cur = getPermissions(planKey);
    var nxt = getPermissions(next);
    return MATRIX_FEATURES.filter(function (row) {
      if (row.type === 'credits' || !row.id || row.id === 'credits') return false;
      return !cur[row.id] && nxt[row.id];
    }).map(function (row) {
      return UPGRADE_BENEFIT_LABELS[row.id] || row.label;
    });
  }

  function displayPlanName(planKey) {
    var k = resolvePlanKey(planKey);
    return (PLAN_LABELS[k] && PLAN_LABELS[k].name) || k;
  }

  window.CutupPlanPermissions = {
    PLAN_ORDER: PLAN_ORDER,
    PLAN_CREDITS: PLAN_CREDITS,
    PLAN_LABELS: PLAN_LABELS,
    PLAN_PRICES: PLAN_PRICES,
    PLAN_PERMISSIONS: PLAN_PERMISSIONS,
    MATRIX_FEATURES: MATRIX_FEATURES,
    UPGRADE_BENEFIT_LABELS: UPGRADE_BENEFIT_LABELS,
    resolvePlanKey: resolvePlanKey,
    getPermissions: getPermissions,
    hasPermission: hasPermission,
    getUpgradeMessage: getUpgradeMessage,
    getCreditsLimit: getCreditsLimit,
    planRank: planRank,
    getNextPlanKey: getNextPlanKey,
    getUpgradeBenefits: getUpgradeBenefits,
    displayPlanName: displayPlanName
  };
})();
