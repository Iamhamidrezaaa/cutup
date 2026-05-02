/**
 * Behavioral pricing paywall (inline only). Does not change billed amounts — checkout carries marketing metadata only.
 */
(function () {
  const USAGE_STATS_KEY = 'cutup_usage_stats';
  const OFFER_EXPIRY_KEY = 'cutup_offer_expiry';
  const PAYMENT_FAILED_KEY = 'cutup_payment_failed_at';
  const AVG_VIDEO_MINUTES = 7;
  const OFFER_MIN_MS = 10 * 60 * 1000;
  const OFFER_SPAN_MS = 5 * 60 * 1000;

  let dashboardPaywallTimer = null;
  let indexPaywallTimer = null;

  function readUsageStats() {
    try {
      const raw = localStorage.getItem(USAGE_STATS_KEY);
      if (!raw) return { totalUses: 0, useTimestamps: [] };
      const o = JSON.parse(raw);
      return {
        totalUses: Number(o.totalUses) || 0,
        useTimestamps: Array.isArray(o.useTimestamps) ? o.useTimestamps.map(Number).filter(Boolean) : [],
      };
    } catch (_e) {
      return { totalUses: 0, useTimestamps: [] };
    }
  }

  function retentionUsesLast24h(stats) {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return (stats.useTimestamps || []).filter((t) => t > dayAgo).length;
  }

  function isRecentPaymentFailed() {
    try {
      const t = Number(localStorage.getItem(PAYMENT_FAILED_KEY));
      if (!t || Number.isNaN(t)) return false;
      return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
    } catch (_e) {
      return false;
    }
  }

  function effectiveTotalUses(subscriptionInfo) {
    let n = readUsageStats().totalUses || 0;
    if (subscriptionInfo && subscriptionInfo.usage && subscriptionInfo.usage.monthly) {
      const mm = Number(subscriptionInfo.usage.monthly.minutes) || 0;
      const est = Math.ceil(mm / AVG_VIDEO_MINUTES);
      n = Math.max(n, est);
    }
    return n;
  }

  function isNearLimit(subscriptionInfo) {
    if (!subscriptionInfo || !subscriptionInfo.usage) return false;
    const mm = Number(subscriptionInfo.usage.monthly?.minutes) || 0;
    const ml = Number(subscriptionInfo.monthlyLimit) || 0;
    if (ml > 0 && mm / ml >= 0.72) return true;
    const dm = Number(subscriptionInfo.usage.daily?.minutes) || 0;
    const dl = subscriptionInfo.dailyLimit;
    if (dl != null && Number(dl) > 0 && dm / Number(dl) >= 0.85) return true;
    return false;
  }

  function getUserSegment(ctx) {
    try {
      const subscriptionInfo = ctx && ctx.subscriptionInfo ? ctx.subscriptionInfo : null;
      const totalUses = effectiveTotalUses(subscriptionInfo);
      const stats = readUsageStats();
      const u24 = retentionUsesLast24h(stats);
      const retentionHot = u24 >= 4 || (totalUses >= 4 && u24 >= 2);
      if (
        isRecentPaymentFailed() ||
        totalUses >= 5 ||
        isNearLimit(subscriptionInfo) ||
        retentionHot
      ) {
        return 'hot';
      }
      if (totalUses >= 2) return 'warm';
      return 'cold';
    } catch (_e) {
      return 'cold';
    }
  }

  function ensureOfferExpiryIfHot(segment) {
    if (segment !== 'hot') return;
    try {
      let exp = Number(localStorage.getItem(OFFER_EXPIRY_KEY));
      if (!exp || Number.isNaN(exp)) {
        const dur = OFFER_MIN_MS + Math.floor(Math.random() * OFFER_SPAN_MS);
        exp = Date.now() + dur;
        localStorage.setItem(OFFER_EXPIRY_KEY, String(exp));
      }
    } catch (_e) {
      /* noop */
    }
  }

  function getOfferExpiresAt() {
    try {
      const exp = Number(localStorage.getItem(OFFER_EXPIRY_KEY));
      return !Number.isNaN(exp) ? exp : 0;
    } catch (_e) {
      return 0;
    }
  }

  function formatCountdownMs(ms) {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  function getHotDiscountCode(ctx) {
    if (getUserSegment(ctx) !== 'hot') return null;
    const exp = getOfferExpiresAt();
    if (!exp || Date.now() > exp) return null;
    return 'hot20';
  }

  function maybeTrackOfferShown() {
    try {
      if (typeof sendAnalyticsEvent !== 'function') return;
      if (sessionStorage.getItem('cutup_offer_shown') === '1') return;
      sessionStorage.setItem('cutup_offer_shown', '1');
      sendAnalyticsEvent('offer_shown', { plan: null });
    } catch (_e) {
      /* noop */
    }
  }

  function maybeTrackOfferClicked() {
    try {
      if (typeof sendAnalyticsEvent !== 'function') return;
      sendAnalyticsEvent('offer_clicked', { plan: null });
    } catch (_e) {
      /* noop */
    }
  }

  function maybeTrackDiscountUsed(planKey) {
    try {
      if (typeof sendAnalyticsEvent !== 'function') return;
      sendAnalyticsEvent('discount_used', { plan: planKey || null });
    } catch (_e) {
      /* noop */
    }
  }

  function buildPaywallHtml(segment, ctx) {
    const lines = [];
    if (segment === 'warm') {
      lines.push(
        '<p class="cutup-paywall-line cutup-paywall-warm">Most users upgrade after 3 uses.</p>'
      );
    } else if (segment === 'hot') {
      lines.push(
        '<p class="cutup-paywall-line cutup-paywall-hot">You\'re close to your limit.</p>'
      );
      ensureOfferExpiryIfHot('hot');
      const exp = getOfferExpiresAt();
      const discActive = exp && Date.now() <= exp;
      if (discActive) {
        lines.push(
          '<p class="cutup-paywall-line cutup-paywall-offer"><strong>Limited offer: 20% off today</strong> <span class="cutup-paywall-sub">(shown at checkout — same list price on file)</span></p>'
        );
        lines.push(
          '<p class="cutup-paywall-countdown" id="cutupPaywallCountdown" aria-live="polite">Offer expires in <span class="cutup-paywall-time"></span></p>'
        );
        maybeTrackOfferShown();
      } else {
        lines.push(
          '<p class="cutup-paywall-urgency">Offer expires soon — upgrade to keep going.</p>'
        );
      }
    }
    return lines.join('');
  }

  function updateCountdownEl(root) {
    const wrap = root && root.querySelector ? root.querySelector('.cutup-paywall-time') : null;
    if (!wrap) return;
    const exp = getOfferExpiresAt();
    const left = exp - Date.now();
    wrap.textContent = left > 0 ? formatCountdownMs(left) : '0:00';
  }

  function mountIndexPaywall() {
    const host = document.getElementById('cutupPricingPaywall');
    const pricing = document.getElementById('pricing');
    if (pricing && !pricing.dataset.cutupOfferClickBound) {
      pricing.dataset.cutupOfferClickBound = '1';
      pricing.addEventListener(
        'click',
        function (e) {
          const a = e.target && e.target.closest && e.target.closest('a.pricing-dashboard-cta');
          if (!a) return;
          if (getHotDiscountCode({}) && typeof window.cutupPaywallOfferClicked === 'function') {
            window.cutupPaywallOfferClicked();
          }
        },
        true
      );
    }
    if (!host) return;
    if (indexPaywallTimer) {
      clearInterval(indexPaywallTimer);
      indexPaywallTimer = null;
    }
    let segment = getUserSegment({});
    try {
      const g =
        typeof window !== 'undefined' && window.cutupGrowthMonetizationOverride
          ? String(window.cutupGrowthMonetizationOverride)
          : '';
      const forceDisc =
        typeof window !== 'undefined' && window.cutupGrowthForceDiscount === true;
      if (g === 'HARD') {
        if (forceDisc) {
          segment = 'hot';
          ensureOfferExpiryIfHot('hot');
        } else {
          segment = 'warm';
        }
      } else if (g === 'SOFT' && segment === 'cold') {
        segment = 'warm';
      }
    } catch (_e) {
      /* noop */
    }
    if (segment === 'cold') {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = buildPaywallHtml(segment, {});
    updateCountdownEl(host);
    if (segment === 'hot' && getOfferExpiresAt() > Date.now()) {
      indexPaywallTimer = setInterval(function () {
        updateCountdownEl(host);
      }, 1000);
    }
  }

  function renderDashboardPaywall(subscriptionInfo) {
    const host = document.getElementById('cutupDashboardPricingPaywall');
    if (!host) return;
    if (dashboardPaywallTimer) {
      clearInterval(dashboardPaywallTimer);
      dashboardPaywallTimer = null;
    }
    const ctx = { subscriptionInfo: subscriptionInfo || null };
    const segment = getUserSegment(ctx);
    if (segment === 'cold') {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = buildPaywallHtml(segment, ctx);
    updateCountdownEl(host);
    if (segment === 'hot' && getOfferExpiresAt() > Date.now()) {
      dashboardPaywallTimer = setInterval(function () {
        updateCountdownEl(host);
      }, 1000);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountIndexPaywall);
    } else {
      mountIndexPaywall();
    }
  }

  if (typeof window !== 'undefined') {
    window.getUserSegment = getUserSegment;
    window.getHotDiscountCodeForCheckout = getHotDiscountCode;
    window.cutupMountIndexPricingPaywall = mountIndexPaywall;
    window.cutupMarkPaywallPaymentFailed = function () {
      try {
        localStorage.setItem(PAYMENT_FAILED_KEY, String(Date.now()));
      } catch (_e) {
        /* noop */
      }
    };
    window.cutupClearPaywallPaymentFailed = function () {
      try {
        localStorage.removeItem(PAYMENT_FAILED_KEY);
      } catch (_e) {
        /* noop */
      }
    };
    window.renderDashboardPaywall = renderDashboardPaywall;
    window.cutupPaywallOfferClicked = maybeTrackOfferClicked;
    window.cutupPaywallDiscountUsed = maybeTrackDiscountUsed;
  }
})();
