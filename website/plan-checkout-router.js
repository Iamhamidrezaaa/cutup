/**
 * Pricing → auth → dashboard plans / checkout routing (single source of truth).
 */
(function (global) {
  const VALID_PLANS = new Set(['starter', 'pro', 'business']);
  const PENDING_PLAN_KEY = 'cutup_pending_plan_after_auth';
  const PENDING_SOURCE_KEY = 'cutup_pending_checkout_source';
  const PENDING_REDIRECT_KEY = 'cutup_pending_redirect_after_auth';

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

  function buildDashboardPlansUrl(planKey) {
    const plan = normalizePlanKey(planKey);
    if (plan) {
      return `/dashboard.html?highlightPlan=${encodeURIComponent(plan)}#subscription`;
    }
    return '/dashboard.html#subscription';
  }

  /** Login page URL — after sign-in user lands on dashboard plans (not checkout). */
  function buildLoginUrl(planKey) {
    const plan = normalizePlanKey(planKey);
    if (!plan) return '/login.html?redirect=plans';
    return `/login.html?redirect=plans&plan=${encodeURIComponent(plan)}`;
  }

  /** Explicit checkout intent via login page (logged-in users skip login). */
  function buildLoginCheckoutUrl(planKey) {
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

  function stashPendingRedirectAfterAuth(mode) {
    const m = String(mode || 'plans').trim();
    try {
      global.sessionStorage.setItem(PENDING_REDIRECT_KEY, m === 'checkout' ? 'checkout' : 'plans');
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

  function consumePendingRedirectAfterAuth() {
    try {
      const raw = global.sessionStorage.getItem(PENDING_REDIRECT_KEY);
      global.sessionStorage.removeItem(PENDING_REDIRECT_KEY);
      return raw === 'checkout' ? 'checkout' : raw === 'plans' ? 'plans' : null;
    } catch (_e) {
      return null;
    }
  }

  function peekPendingRedirectAfterAuth() {
    try {
      const raw = global.sessionStorage.getItem(PENDING_REDIRECT_KEY);
      return raw === 'checkout' ? 'checkout' : raw === 'plans' ? 'plans' : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Start Google OAuth (plan restored after callback via sessionStorage).
   */
  async function startGoogleOAuthCheckout(planKey, options = {}) {
    const plan = normalizePlanKey(planKey);
    const source = options.source || 'pricing';
    const redirectMode = options.redirectMode || 'plans';
    if (!plan) {
      console.warn('[oauth-direct-start] invalid plan', planKey);
      return { ok: false, reason: 'invalid_plan' };
    }
    if (isLoggedIn()) {
      if (redirectMode === 'checkout') {
        const checkoutUrl = buildCheckoutUrl(plan, { source, coupon: options.coupon });
        console.log('[checkout-route]', { checkoutUrl, reason: 'already_logged_in' });
        global.location.href = checkoutUrl;
        return { ok: true, route: 'checkout', url: checkoutUrl };
      }
      const dashUrl = buildDashboardPlansUrl(plan);
      console.log('[checkout-route]', { dashUrl, reason: 'already_logged_in_plans' });
      global.location.href = dashUrl;
      return { ok: true, route: 'dashboard_plans', url: dashUrl };
    }

    stashPendingPlanAfterAuth(plan, source);
    stashPendingRedirectAfterAuth(redirectMode);
    console.log('[oauth-direct-start]', { plan, source, redirectMode });

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
        global.sessionStorage.removeItem(PENDING_REDIRECT_KEY);
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
      stashPendingPlanAfterAuth(plan, source);
      stashPendingRedirectAfterAuth('plans');
      const loginUrl = buildLoginUrl(plan);
      console.log('[checkout-route]', { loginUrl, reason: 'guest_to_login_plans' });
      global.location.href = loginUrl;
      return Promise.resolve({ ok: true, route: 'login', url: loginUrl });
    }

    const checkoutUrl = buildCheckoutUrl(plan, { source, coupon: options.coupon });
    console.log('[checkout-route]', { checkoutUrl, reason: 'logged_in' });
    global.location.href = checkoutUrl;
    return Promise.resolve({ ok: true, route: 'checkout', url: checkoutUrl });
  }

  /** After OAuth: dashboard plans or checkout depending on pending redirect / query. */
  function resolvePostLoginRedirect() {
    const pending = consumePendingPlanAfterAuth();
    const redirectMode = consumePendingRedirectAfterAuth() || 'plans';

    if (pending) {
      if (redirectMode === 'checkout') {
        const url = buildCheckoutUrl(pending, { source: 'checkout' });
        console.log('[oauth-return]', { plan: pending, mode: 'checkout' });
        console.log('[checkout-after-oauth]', { url });
        return url;
      }
      const url = buildDashboardPlansUrl(pending);
      console.log('[oauth-return]', { plan: pending, mode: 'plans' });
      console.log('[dashboard-after-oauth]', { url });
      return url;
    }

    try {
      const params = new URLSearchParams(global.location.search);
      if (params.get('redirect') === 'checkout') {
        const p = normalizePlanKey(params.get('plan'));
        if (p) {
          const url = buildCheckoutUrl(p, { source: 'checkout' });
          console.log('[oauth-return]', { plan: p, reason: 'query_params_checkout' });
          console.log('[checkout-after-oauth]', { url });
          return url;
        }
      }
      if (params.get('redirect') === 'plans') {
        const p = normalizePlanKey(params.get('plan'));
        const url = buildDashboardPlansUrl(p);
        console.log('[oauth-return]', { plan: p, reason: 'query_params_plans' });
        console.log('[dashboard-after-oauth]', { url });
        return url;
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
    PENDING_REDIRECT_KEY,
    normalizePlanKey,
    isLoggedIn,
    isProfileGateIncomplete,
    buildCheckoutUrl,
    buildDashboardPlansUrl,
    buildLoginUrl,
    buildLoginCheckoutUrl,
    stashPendingPlanAfterAuth,
    stashPendingRedirectAfterAuth,
    consumePendingPlanAfterAuth,
    consumePendingRedirectAfterAuth,
    peekPendingRedirectAfterAuth,
    startGoogleOAuthCheckout,
    handlePlanSelection,
    resolvePostLoginRedirect
  };
})(typeof window !== 'undefined' ? window : globalThis);
