/**
 * Pricing → auth → checkout routing (single source of truth).
 */
(function (global) {
  const VALID_PLANS = new Set(['starter', 'pro', 'business']);
  const PENDING_PLAN_KEY = 'cutup_pending_plan_after_auth';
  const PENDING_SOURCE_KEY = 'cutup_pending_checkout_source';

  function apiBase() {
    return typeof global.CUTUP_API_BASE !== 'undefined' ? global.CUTUP_API_BASE : '';
  }

  function normalizePlanKey(planKey) {
    const k = String(planKey || '').trim().toLowerCase();
    return VALID_PLANS.has(k) ? k : null;
  }

  function isLoggedIn() {
    return Boolean(global.localStorage?.getItem('cutup_session'));
  }

  /** Same gate as dashboard onboarding modal (not postal-only). */
  function isProfileGateIncomplete(profile) {
    if (!profile) return true;
    return (
      !String(profile.first_name || '').trim() ||
      !String(profile.last_name || '').trim() ||
      !String(profile.phone || '').trim() ||
      !String(profile.country || '').trim() ||
      !String(profile.address || '').trim()
    );
  }

  function buildCheckoutUrl(planKey, extra = {}) {
    const plan = normalizePlanKey(planKey);
    if (!plan) return '/checkout.html';
    const sp = new URLSearchParams();
    sp.set('plan', plan);
    const source = String(extra.source || 'pricing').trim();
    if (source) sp.set('source', source);
    const coupon = String(extra.coupon || '').trim();
    if (coupon) sp.set('coupon', coupon);
    return `/checkout.html?${sp.toString()}`;
  }

  /** Fallback only — pricing CTAs must not use this. */
  function buildLoginUrl(planKey) {
    const plan = normalizePlanKey(planKey);
    if (!plan) return '/login.html?redirect=checkout';
    return `/login.html?redirect=checkout&plan=${encodeURIComponent(plan)}`;
  }

  function stashPendingPlanAfterAuth(planKey, source = 'pricing') {
    const plan = normalizePlanKey(planKey);
    if (!plan) return;
    try {
      global.sessionStorage.setItem(PENDING_PLAN_KEY, plan);
      global.sessionStorage.setItem(PENDING_SOURCE_KEY, String(source || 'pricing'));
      console.log('[pending-checkout-plan]', { plan, source: source || 'pricing' });
    } catch (_e) {
      /* noop */
    }
  }

  function consumePendingPlanAfterAuth() {
    try {
      const raw = global.sessionStorage.getItem(PENDING_PLAN_KEY);
      global.sessionStorage.removeItem(PENDING_PLAN_KEY);
      global.sessionStorage.removeItem(PENDING_SOURCE_KEY);
      return normalizePlanKey(raw);
    } catch (_e) {
      return null;
    }
  }

  /**
   * Start Google OAuth immediately (no login.html). Plan is restored after callback.
   */
  async function startGoogleOAuthCheckout(planKey, options = {}) {
    const plan = normalizePlanKey(planKey);
    const source = options.source || 'pricing';
    if (!plan) {
      console.warn('[oauth-direct-start] invalid plan', planKey);
      return { ok: false, reason: 'invalid_plan' };
    }
    if (isLoggedIn()) {
      const checkoutUrl = buildCheckoutUrl(plan, { source, coupon: options.coupon });
      console.log('[checkout-route]', { checkoutUrl, reason: 'already_logged_in' });
      global.location.href = checkoutUrl;
      return { ok: true, route: 'checkout', url: checkoutUrl };
    }

    stashPendingPlanAfterAuth(plan, source);
    console.log('[oauth-direct-start]', { plan, source });

    try {
      const response = await fetch(`${apiBase()}/api/oauth/google/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectAccount: Boolean(options.selectAccount) })
      });
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();
      if (!data?.authUrl) {
        throw new Error('No authUrl returned from server');
      }
      global.location.href = data.authUrl;
      return { ok: true, route: 'oauth', url: data.authUrl };
    } catch (err) {
      console.error('[oauth-direct-start] failed', err);
      try {
        global.sessionStorage.removeItem(PENDING_PLAN_KEY);
        global.sessionStorage.removeItem(PENDING_SOURCE_KEY);
      } catch (_e) {
        /* noop */
      }
      throw err;
    }
  }

  function handlePlanSelection(planKey, options = {}) {
    const plan = normalizePlanKey(planKey);
    const source = options.source || 'pricing';
    console.log('[pricing-click]', { plan, source, raw: planKey });

    if (!plan) {
      console.warn('[checkout-route] invalid plan', planKey);
      return Promise.resolve({ ok: false, reason: 'invalid_plan' });
    }

    const loggedIn = isLoggedIn();
    console.log('[auth-state]', { loggedIn });

    if (!loggedIn) {
      return startGoogleOAuthCheckout(plan, { source, coupon: options.coupon });
    }

    const checkoutUrl = buildCheckoutUrl(plan, { source, coupon: options.coupon });
    console.log('[checkout-route]', { checkoutUrl, reason: 'logged_in' });
    global.location.href = checkoutUrl;
    return Promise.resolve({ ok: true, route: 'checkout', url: checkoutUrl });
  }

  /** After OAuth: checkout URL if a plan was pending, else null. */
  function resolvePostLoginRedirect() {
    const pending = consumePendingPlanAfterAuth();
    if (pending) {
      const url = buildCheckoutUrl(pending, { source: 'checkout' });
      console.log('[oauth-return]', { plan: pending });
      console.log('[checkout-after-oauth]', { url });
      return url;
    }
    try {
      const params = new URLSearchParams(global.location.search);
      if (params.get('redirect') === 'checkout') {
        const p = normalizePlanKey(params.get('plan'));
        if (p) {
          const url = buildCheckoutUrl(p, { source: 'checkout' });
          console.log('[oauth-return]', { plan: p, reason: 'query_params' });
          console.log('[checkout-after-oauth]', { url });
          return url;
        }
      }
    } catch (_e) {
      /* noop */
    }
    return null;
  }

  global.CutupPlanCheckout = {
    VALID_PLANS,
    PENDING_PLAN_KEY,
    PENDING_SOURCE_KEY,
    normalizePlanKey,
    isLoggedIn,
    isProfileGateIncomplete,
    buildCheckoutUrl,
    buildLoginUrl,
    stashPendingPlanAfterAuth,
    consumePendingPlanAfterAuth,
    startGoogleOAuthCheckout,
    handlePlanSelection,
    resolvePostLoginRedirect
  };
})(typeof window !== 'undefined' ? window : globalThis);
