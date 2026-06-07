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

  function formatMonthlyExportsLine(planKey) {
    var n = monthlyVideosForPlan(planKey);
    return n + ' exports/month';
  }

  /** Free: no upgrade needed to start; paid: standard SaaS line. */
  function pricingAccessNote(planKey) {
    var k = String(planKey || '').toLowerCase();
    if (k === 'free') return 'Instant access after login';
    return 'Cancel anytime · Instant access after upgrade';
  }

  function hydratePricingCompareTable() {
    document.querySelectorAll('[data-cutup-plan-exports]').forEach(function (el) {
      var k = el.getAttribute('data-cutup-plan-exports');
      if (!k) return;
      var n = monthlyVideosForPlan(k);
      el.innerHTML = '<span class="pricing-compare__export-num">' + n + '</span><span class="pricing-compare__export-unit">videos/mo</span>';
    });
  }

  window.CutupPlanDisplay = {
    PLAN_MONTHLY_VIDEOS: PLAN_MONTHLY_VIDEOS,
    monthlyVideosForPlan: monthlyVideosForPlan,
    formatMonthlyVideosLine: formatMonthlyVideosLine,
    formatMonthlyExportsLine: formatMonthlyExportsLine,
    pricingAccessNote: pricingAccessNote,
    hydratePricingCompareTable: hydratePricingCompareTable
  };
})();
