/**
 * Pricing A/B (A/B) + funnel analytics. Fire-and-forget; never blocks UX.
 * Variant: localStorage cutup_pricing_variant + window.CUTUP_PRICING_VARIANT
 */
(function cutupAnalyticsBootstrap() {
  const VARIANTS = ['A', 'B'];
  const STORAGE_KEY = 'cutup_pricing_variant';
  const GUEST_KEY = 'cutup_guest_id';

  function getApiBase() {
    try {
      if (typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined') {
        return window.CUTUP_API_BASE;
      }
      const o =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : '';
      if (o && (o.indexOf('localhost') !== -1 || o.indexOf('127.0.0.1') !== -1)) {
        return 'http://localhost:3001';
      }
      return '';
    } catch (_e) {
      /* noop */
    }
    return '';
  }

  function isDebug() {
    try {
      const h = typeof window !== 'undefined' && window.location && window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1';
    } catch (_e) {
      return false;
    }
  }

  function initPricingVariant() {
    try {
      let v = localStorage.getItem(STORAGE_KEY);
      if (v !== 'A' && v !== 'B') {
        v = Math.random() < 0.5 ? 'A' : 'B';
        localStorage.setItem(STORAGE_KEY, v);
      }
      if (typeof window !== 'undefined') window.CUTUP_PRICING_VARIANT = v;
      return v;
    } catch (_e) {
      if (typeof window !== 'undefined') window.CUTUP_PRICING_VARIANT = 'A';
      return 'A';
    }
  }

  function getPricingVariant() {
    try {
      const w = typeof window !== 'undefined' && window.CUTUP_PRICING_VARIANT;
      if (w === 'A' || w === 'B') return w;
      const s = localStorage.getItem(STORAGE_KEY);
      if (s === 'A' || s === 'B') return s;
    } catch (_e) {
      /* noop */
    }
    return 'A';
  }

  function getOrCreateGuestId() {
    try {
      let g = localStorage.getItem(GUEST_KEY);
      if (g && String(g).length >= 8) return g;
      g =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'g_' + String(Date.now()) + '_' + String(Math.random()).slice(2, 10);
      localStorage.setItem(GUEST_KEY, g);
      return g;
    } catch (_e) {
      return 'guest_fallback';
    }
  }

  function getCutupSessionId() {
    try {
      return localStorage.getItem('cutup_session');
    } catch (_e) {
      return null;
    }
  }

  /**
   * @param {string} event
   * @param {{ plan?: string | null, referrer?: string | null, sessionId?: string | null }} [data]
   */
  function sendAnalyticsEvent(event, data) {
    const variant = getPricingVariant();
    const payload = {
      event: String(event || ''),
      variant,
      plan: data && data.plan !== undefined ? data.plan : null,
      referrer: data && data.referrer !== undefined ? data.referrer : null,
      ts: Date.now(),
      guest_id: getOrCreateGuestId()
    };
    const url = getApiBase() + '/api/analytics';
    const headers = { 'Content-Type': 'application/json' };
    const sid = (data && data.sessionId) || getCutupSessionId();
    if (sid) headers['X-Session-Id'] = sid;

    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    };
    if (typeof Request !== 'undefined' && 'keepalive' in Request.prototype) {
      opts.keepalive = true;
    }

    fetch(url, opts).catch(function () {});

    if (isDebug() && typeof console !== 'undefined' && console.debug) {
      console.debug('[analytics]', event, variant, payload.plan);
    }
  }

  function applyVariantBPricingCTAs() {
    if (getPricingVariant() !== 'B') return;
    var labels = {
      starter: 'Start Starter plan',
      pro: 'Start Pro plan',
      advanced: 'Start Business plan',
    };
    document.querySelectorAll('a.pricing-dashboard-cta').forEach(function (a) {
      var p = (a.getAttribute('data-cutup-plan') || '').trim();
      if (p === 'starter' || p === 'pro' || p === 'advanced') {
        if (labels[p]) a.textContent = labels[p];
      } else if (a.id === 'monetizationUpgradeBtn') {
        a.textContent = 'Start Pro plan';
      }
    });
  }

  function setupLandingPricingAnalytics() {
    var pricingEl = document.getElementById('pricing');
    if (!pricingEl) return;

    var viewed = false;
    try {
      var obs = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (viewed || !entry.isIntersecting) return;
            viewed = true;
            sendAnalyticsEvent('pricing_viewed', { plan: null });
            obs.disconnect();
          });
        },
        { threshold: 0.2, rootMargin: '0px' }
      );
      obs.observe(pricingEl);
    } catch (_e) {
      /* noop */
    }

    var grid = document.querySelector('.pricing-plans-grid');
    if (grid) {
      grid.addEventListener(
        'click',
        function (e) {
          var a = e.target && e.target.closest && e.target.closest('a.pricing-dashboard-cta');
          if (!a) return;
          var raw = a.getAttribute('data-cutup-plan');
          var plan = raw && String(raw).trim() !== '' ? String(raw).trim() : null;
          sendAnalyticsEvent('upgrade_clicked', { plan: plan });
        },
        true
      );
    }
  }

  function onDomReadyForPricingUi() {
    applyVariantBPricingCTAs();
    setupLandingPricingAnalytics();
  }

  if (typeof window !== 'undefined') {
    window.CUTUP_PRICING_VARIANTS = VARIANTS;
    window.initPricingVariant = initPricingVariant;
    window.getPricingVariant = getPricingVariant;
    window.sendAnalyticsEvent = sendAnalyticsEvent;
    initPricingVariant();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDomReadyForPricingUi);
    } else {
      onDomReadyForPricingUi();
    }
  }
})();

