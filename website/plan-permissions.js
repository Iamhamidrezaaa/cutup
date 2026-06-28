/**
 * Browser mirror of api/plans/permissions.js — keep in sync.
 * Runtime truth comes from GET /api/subscription?action=info → permissions.
 */
(function () {
  'use strict';

  var PLAN_ORDER = ['free', 'starter', 'pro', 'business'];

  var PLAN_CREDITS = { free: 3, starter: 15, pro: 35, business: 100 };

  var PLAN_MP4_EXPORT_LIMITS = { free: 1, starter: 5, pro: 35, business: 100 };

  var PLAN_MP4_EXPORT_TIERS = {
    free: 'Limited',
    starter: 'Basic',
    pro: 'Full',
    business: 'Full'
  };

  var MP4_TIER_RANK = { Limited: 0, Basic: 1, Full: 2 };

  var PLAN_PRICING_FEATURES = {
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

  /** Keep in sync with api/plans/permissions.js PLAN_LABELS + api/plans-config.js priceEur */
  var PLAN_LABELS = {
    free: { name: 'Free', tagline: 'Try CutUp with real exports' },
    starter: { name: 'Starter', tagline: 'Perfect for occasional creators' },
    pro: { name: 'Pro', tagline: 'Everything needed to create viral-ready videos' },
    business: { name: 'Business', tagline: 'For agencies and content teams' }
  };

  var PLAN_PRICES = {
    free: { display: '€0', monthly: 0 },
    starter: { display: '€7.99/mo', monthly: 7.99 },
    pro: { display: '€19.99/mo', monthly: 19.99 },
    business: { display: '€49.99/mo', monthly: 49.99 }
  };

  /** Pricing comparison table rows (desktop table + mobile compare details). */
  var MATRIX_FEATURES = [
    { id: 'credits', label: 'Monthly video credits', type: 'credits', highlight: true },
    { id: 'mp4VideoExport', label: 'MP4 Video Export', type: 'mp4_tier', highlight: true, upgradeTrigger: true },
    { id: 'canWatermarkFreeExport', label: 'Watermark Free Export', upgradeTrigger: true },
    { id: 'canUseBasicStyles', label: 'Basic styles' },
    { id: 'canUseAiCaptions', label: 'AI captions' },
    { id: 'canUseBasicTranscript', label: 'Transcript' },
    { id: 'canUseSummary', label: 'Summary' },
    { id: 'canTranslate', label: 'Translation' },
    { id: 'canExportTxt', label: 'TXT export' },
    { id: 'canExportDocx', label: 'DOCX export' },
    { id: 'canUsePremiumStyles', label: 'Premium Caption Styles', upgradeTrigger: true },
    { id: 'canUsePriorityQueue', label: 'Priority Processing' },
    { id: 'canUseAdvancedExports', label: 'Advanced exports' },
    { id: 'canUsePrioritySupport', label: 'Priority Support' },
    { id: 'canUseAgencyFeatures', label: 'Agency features' }
  ];

  var UPGRADE_BENEFIT_LABELS = {
    canTranslate: 'Translation',
    canExportTxt: 'TXT export',
    canExportDocx: 'DOCX export',
    canWatermarkFreeExport: 'Watermark-free export',
    canUsePremiumStyles: 'Premium Caption Styles',
    canUsePriorityQueue: 'Priority Processing',
    canUseAdvancedExports: 'Advanced exports',
    canUsePrioritySupport: 'Priority Support',
    canUseAgencyFeatures: 'Agency features',
    mp4VideoExport: 'MP4 Video Export'
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
      canUseBasicStyles: true,
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
      canUseBasicStyles: true,
      canUseAdvancedExports: true,
      canUseAgencyFeatures: true
    }
  };

  var UPGRADE_MESSAGES = {
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
    canUseAgencyFeatures: 'Agency features are available on the Business plan.',
    canUseAdvancedExports: 'Advanced exports are available on Pro and Business plans.',
    canUseBasicStyles: 'Basic styles are included on Free and Starter plans.'
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
      if (row.type === 'credits') return false;
      if (row.type === 'mp4_tier') {
        var curTier = PLAN_MP4_EXPORT_TIERS[resolvePlanKey(planKey)] || 'Limited';
        var nextTier = PLAN_MP4_EXPORT_TIERS[next] || 'Limited';
        return (MP4_TIER_RANK[nextTier] || 0) > (MP4_TIER_RANK[curTier] || 0);
      }
      if (!row.id) return false;
      return !cur[row.id] && nxt[row.id];
    }).map(function (row) {
      return UPGRADE_BENEFIT_LABELS[row.id] || row.label;
    });
  }

  function displayPlanName(planKey) {
    var k = resolvePlanKey(planKey);
    return (PLAN_LABELS[k] && PLAN_LABELS[k].name) || k;
  }

  function getMp4ExportTier(planKey) {
    return PLAN_MP4_EXPORT_TIERS[resolvePlanKey(planKey)] || 'Limited';
  }

  function getMp4ExportLimit(planKey) {
    return PLAN_MP4_EXPORT_LIMITS[resolvePlanKey(planKey)] || 0;
  }

  function getPricingFeatures(planKey) {
    return (PLAN_PRICING_FEATURES[resolvePlanKey(planKey)] || []).slice();
  }

  window.CutupPlanPermissions = {
    PLAN_ORDER: PLAN_ORDER,
    PLAN_CREDITS: PLAN_CREDITS,
    PLAN_MP4_EXPORT_LIMITS: PLAN_MP4_EXPORT_LIMITS,
    PLAN_MP4_EXPORT_TIERS: PLAN_MP4_EXPORT_TIERS,
    PLAN_PRICING_FEATURES: PLAN_PRICING_FEATURES,
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
    displayPlanName: displayPlanName,
    getMp4ExportLimit: getMp4ExportLimit,
    getMp4ExportTier: getMp4ExportTier,
    getPricingFeatures: getPricingFeatures
  };
})();
