/**
 * Browser mirror of api/plans/permissions.js — keep in sync.
 * Runtime truth comes from GET /api/subscription?action=info → permissions.
 */
(function () {
  'use strict';

  var PLAN_ORDER = ['free', 'starter', 'pro', 'business'];

  var PLAN_CREDITS = { free: 3, starter: 15, pro: 35, business: 100 };

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

  window.CutupPlanPermissions = {
    PLAN_ORDER: PLAN_ORDER,
    PLAN_CREDITS: PLAN_CREDITS,
    PLAN_PERMISSIONS: PLAN_PERMISSIONS,
    resolvePlanKey: resolvePlanKey,
    getPermissions: getPermissions,
    hasPermission: hasPermission,
    getUpgradeMessage: getUpgradeMessage,
    getCreditsLimit: getCreditsLimit
  };
})();
