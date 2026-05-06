/**
 * Customer-facing plan copy — keep in sync with api/plans-config.js (monthlyGenerationLimit / monthlyLimit).
 * Used by static pages (e.g. index.html) and can be read by dashboard for labels.
 */
(function () {
  if (typeof window === 'undefined') return;

  var PLAN_MONTHLY_VIDEOS = { free: 3, starter: 15, pro: 35, business: 100 };

  function monthlyVideosForPlan(planKey) {
    var k = String(planKey || 'free').toLowerCase();
    var n = PLAN_MONTHLY_VIDEOS[k];
    return typeof n === 'number' ? n : PLAN_MONTHLY_VIDEOS.free;
  }

  function formatMonthlyVideosLine(planKey) {
    var n = monthlyVideosForPlan(planKey);
    return n + ' videos per month';
  }

  /** Free: no upgrade needed to start; paid: standard SaaS line. */
  function pricingAccessNote(planKey) {
    var k = String(planKey || '').toLowerCase();
    if (k === 'free') return 'Instant access after login';
    return 'Cancel anytime · Instant access after upgrade';
  }

  window.CutupPlanDisplay = {
    PLAN_MONTHLY_VIDEOS: PLAN_MONTHLY_VIDEOS,
    monthlyVideosForPlan: monthlyVideosForPlan,
    formatMonthlyVideosLine: formatMonthlyVideosLine,
    pricingAccessNote: pricingAccessNote
  };
})();
