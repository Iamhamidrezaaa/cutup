const DASHBOARD_BUILD_ID = 'DASH_PROFILE_2026_01';
if (typeof window !== 'undefined') {
  window.__CUTUP_DASHBOARD_BUILD__ = DASHBOARD_BUILD_ID;
  console.log('[dashboard-runtime] loaded', DASHBOARD_BUILD_ID, window.location?.href || '');
}

const API_BASE_URL =
  typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';
const PAYMENT_RETRY_KEY = 'cutup_payment_retry';
const PENDING_ACTION_LS_KEY = 'pending_action';
const PENDING_ACTION_MAX_MS = 10 * 60 * 1000;

function cutupPendingActionValidForHomeRedirect() {
  try {
    const raw = localStorage.getItem(PENDING_ACTION_LS_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    const ts = p.timestamp || 0;
    if (!ts || Date.now() - ts > PENDING_ACTION_MAX_MS) return false;
    if (p.payload && p.payload.fileFlow) return true;
    const input = (p.payload && p.payload.input != null ? String(p.payload.input) : '').trim();
    return input.length > 0;
  } catch {
    return false;
  }
}

function cutupShouldResumeOnHomepage() {
  if (cutupPendingActionValidForHomeRedirect()) return true;
  try {
    const pendingUrl = localStorage.getItem('cutup_pending_url');
    if (pendingUrl && String(pendingUrl).trim()) return true;
    if (sessionStorage.getItem('cutup_pending_action')) return true;
  } catch {
    /* noop */
  }
  return false;
}
let cutupDashboardPricingViewedSent = false;

function peekPaymentRetryPlanKey() {
  try {
    const t = sessionStorage.getItem(PAYMENT_RETRY_KEY);
    if (!t) return null;
    const o = JSON.parse(t);
    return o?.planKey || null;
  } catch (_e) {
    return null;
  }
}

function emitPaymentSuccessAnalytics() {
  const paidPlan = peekPaymentRetryPlanKey();
  clearPaymentRetryContext();
  try {
    if (typeof window.cutupClearPaywallPaymentFailed === 'function') window.cutupClearPaywallPaymentFailed();
  } catch (_e) {
    /* noop */
  }
  if (typeof sendAnalyticsEvent === 'function') {
    sendAnalyticsEvent('payment_success', { plan: paidPlan, sessionId: currentSession });
  }
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('payment_success', { plan: paidPlan }, 'business');
  }
  if (typeof window.cutupGrowthRecordPaymentSuccess === 'function') {
    window.cutupGrowthRecordPaymentSuccess();
  }
}

function emitPaymentFailedAnalytics() {
  const pk = peekPaymentRetryPlanKey();
  try {
    if (typeof window.cutupMarkPaywallPaymentFailed === 'function') window.cutupMarkPaywallPaymentFailed();
  } catch (_e) {
    /* noop */
  }
  if (typeof sendAnalyticsEvent === 'function') {
    sendAnalyticsEvent('payment_failed', { plan: pk, sessionId: currentSession });
  }
  if (typeof window.trackEvent === 'function') {
    window.trackEvent('payment_failed', { plan: pk }, 'business');
  }
}

let currentSession = null;
let currentUser = null;
let subscriptionInfo = null;
let plansCache = [];
let historyCache = [];
let activityFeedCache = [];
let billingDashboardCache = null;
let billingDashboardLoadState = 'idle';
let billingDashboardLoadError = null;
let offersCache = [];
let offersResolvedState = null;
let dashboardHighlightPlan = null;

/**
 * Legacy deploys sometimes served a static profile <form> inside #cutupDashboardShell.
 * Real onboarding lives in #onboardingOverlay on document.body — only strip forms inside the shell.
 */
function removeGhostInlineProfileFormFromShell() {
  const shell = document.getElementById('cutupDashboardShell');
  if (!shell) return;
  const ghost = shell.querySelector('input[name="first_name"]');
  if (!ghost) return;
  const form = ghost.closest('form');
  if (!form) return;
  console.warn('[onboarding] ghost form detected in shell → removing', form);
  form.remove();
}

[0, 100, 500, 1500].forEach((ms) => setTimeout(removeGhostInlineProfileFormFromShell, ms));
let savedOutputsCache = [];

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function safeText(value, fallback = '—') {
  const str = String(value ?? '').trim();
  return str || fallback;
}

/** Prefer profile first/last; never show raw email local part when we have a real name. */
function dashboardDisplayName(user) {
  if (!user) return 'User';
  const full = [user.first_name, user.last_name]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  if (full) return full;
  const n = String(user.name || '').trim();
  if (n && !n.includes('@')) return n;
  return safeText(user.email, 'User');
}

function dashboardGreetingName(user) {
  if (!user) return 'there';
  const fn = String(user.first_name || '').trim();
  if (fn) return fn;
  return dashboardDisplayName(user);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DASHBOARD_PLAN_RANK = { free: 0, starter: 1, pro: 2, business: 3 };

function dashboardPlanRank(planId) {
  const id = String(planId || '').toLowerCase();
  return DASHBOARD_PLAN_RANK[id] !== undefined ? DASHBOARD_PLAN_RANK[id] : 0;
}

/** Display-only label (Stripe tier `advanced` is shown as Business). */
function displayPlanTitle(planId, nameFallback) {
  const id = String(planId || '').toLowerCase();
  if (id === 'advanced' || id === 'business') return 'Business';
  return safeText(nameFallback, id || 'Free');
}

/** Read credit counters from backend snapshot only (no client-side math). */
function creditsFromSubscription(sub) {
  const snap = sub?.creditsSnapshot || sub?.credits;
  if (snap && Number.isFinite(Number(snap.limit))) {
    return {
      used: Math.max(0, Math.floor(Number(snap.used) || 0)),
      limit: Math.max(0, Math.floor(Number(snap.limit) || 0)),
      remaining: Math.max(0, Math.floor(Number(snap.remaining) || 0))
    };
  }
  return { used: 0, limit: 0, remaining: 0 };
}

function lifetimeFromSubscription(sub) {
  const lt = sub?.lifetime;
  if (lt && typeof lt === 'object') {
    return {
      outputs: Math.max(0, Number(lt.outputs) || 0),
      mp4Exports: Math.max(0, Number(lt.mp4Exports) || 0),
      processingJobs: Math.max(0, Number(lt.processingJobs) || 0)
    };
  }
  return { outputs: 0, mp4Exports: 0, processingJobs: 0 };
}

function subscriptionMonthlyGenLimit(sub) {
  return creditsFromSubscription(sub).limit;
}

function generationsUsedFromSubscription(sub) {
  return creditsFromSubscription(sub).used;
}

function formatMonthlyVideosLineForPlanKey(planKey) {
  const k = String(planKey || 'free').toLowerCase();
  if (window.CutupPlanDisplay?.formatMonthlyVideosLine) {
    return window.CutupPlanDisplay.formatMonthlyVideosLine(k);
  }
  return `${subscriptionMonthlyGenLimit({ plan: k })} videos per month`;
}

function formatRenewalCountdown(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - Date.now();
  if (diff <= 0) return 'Renewal pending';
  const days = Math.ceil(diff / (24 * 3600 * 1000));
  return days === 1 ? 'Renews in 1 day' : `Renews in ${days} days`;
}

function planUpgradeHint(planKey) {
  const k = String(planKey || 'free').toLowerCase();
  if (k === 'free') return 'Upgrade to Pro for MP4 exports';
  if (k === 'starter') return 'Upgrade to Pro for MP4 exports and creator styles';
  if (k === 'pro') return 'Upgrade to Business for team usage and priority support';
  return null;
}

function formatSubscriptionStatus(sub) {
  const plan = String(sub?.plan || 'free').toLowerCase();
  const status = String(sub?.subscription?.status || 'active').toLowerCase();
  if (plan === 'free') return 'Free tier — no paid subscription';
  if (status === 'past_due') return 'Past due — update your payment method';
  if (status === 'canceled' || status === 'cancelled') return 'Canceled';
  if (status === 'trialing') return 'Trial active';
  return 'Active subscription';
}

function dashboardCheckoutForPlan(planId) {
  const targetPlan = String(planId || '').toLowerCase();
  if (!targetPlan || !currentSession) return;
  if (typeof sendAnalyticsEvent === 'function') {
    sendAnalyticsEvent('upgrade_clicked', { plan: targetPlan, sessionId: currentSession });
  }
  try {
    if (typeof getHotDiscountCodeForCheckout === 'function' && getHotDiscountCodeForCheckout({ subscriptionInfo })) {
      if (typeof window.cutupPaywallOfferClicked === 'function') window.cutupPaywallOfferClicked();
    }
  } catch (_e) {
    /* noop */
  }
  const selected = offersResolvedState?.selectedOffer || null;
  const selectedTarget = String(window.CutupOffersResolver?.inferTargetPlan?.(selected) || '').toLowerCase();
  const coupon = selected && selectedTarget === targetPlan ? String(selected.code || '').toUpperCase() : '';
  window.location.href = coupon
    ? `/checkout.html?plan=${encodeURIComponent(targetPlan)}&coupon=${encodeURIComponent(coupon)}`
    : `/checkout.html?plan=${encodeURIComponent(targetPlan)}`;
}

function openDashboardPricingMatrix(highlightPlan) {
  if (!window.CutupPricingMatrix?.openModal) return;
  const planKey = String(subscriptionInfo?.plan || 'free').toLowerCase();
  window.CutupPricingMatrix.openModal({
    currentPlan: planKey,
    onUpgrade: (plan) => {
      window.CutupPricingMatrix.closeModal();
      dashboardCheckoutForPlan(plan);
    }
  });
  if (highlightPlan) {
    requestAnimationFrame(() => {
      const modal = document.getElementById('cutupPricingMatrixModal');
      const cell = modal?.querySelector(`[data-cutup-plan="${CSS.escape(highlightPlan)}"]`)?.closest('td')
        || modal?.querySelector(`[data-cutup-plan-exports="${CSS.escape(highlightPlan)}"]`);
      cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }
  if (typeof sendAnalyticsEvent === 'function' && !cutupDashboardPricingViewedSent) {
    cutupDashboardPricingViewedSent = true;
    sendAnalyticsEvent('pricing_viewed', { plan: planKey, sessionId: currentSession });
  }
}

function nextCalendarResetLabelFromUsage(usage) {
  const m = usage?.monthly;
  if (!m || m.year == null || m.month == null) return null;
  const y = Number(m.year);
  const monthIdx = Number(m.month);
  if (!Number.isFinite(y) || !Number.isFinite(monthIdx)) return null;
  const next = new Date(y, monthIdx + 1, 1);
  return next.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function shouldShowDailyUsageMeter(usage) {
  const d = Number(usage?.dailyLimit);
  return Number.isFinite(d) && d > 0 && d < 50000;
}

function showDashboardBanner(message, variant = 'info', opts = {}) {
  let el = document.getElementById('dashboardBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dashboardBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.insertBefore(el, document.body.firstChild);
  }
  if (opts.spinner) {
    el.innerHTML = `<span class="dashboard-payment-spinner" aria-hidden="true"></span> ${escapeHtml(message)}`;
  } else {
    el.textContent = message;
  }
  el.className = `dashboard-banner dashboard-banner--${variant}${opts.spinner ? ' dashboard-banner--with-spinner' : ''}`;
  el.hidden = false;
  clearTimeout(el._hideT);
  if (!opts.persistent) {
    el._hideT = setTimeout(() => {
      el.hidden = true;
    }, 9000);
  }
}

function inferPaymentProvider() {
  if (typeof window !== 'undefined' && window.CUTUP_PAYMENT_PROVIDER) {
    return window.CUTUP_PAYMENT_PROVIDER === 'yekpay' ? 'yekpay' : 'yekpay';
  }
  try {
    const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
    if (lang.startsWith('fa')) return 'yekpay';
  } catch (_e) {
    /* noop */
  }
  return 'yekpay';
}

function rememberPaymentRetryContext(planKey, provider) {
  try {
    sessionStorage.setItem(PAYMENT_RETRY_KEY, JSON.stringify({ planKey, provider }));
  } catch (_e) {
    /* noop */
  }
}

function clearPaymentRetryContext() {
  try {
    sessionStorage.removeItem(PAYMENT_RETRY_KEY);
  } catch (_e) {
    /* noop */
  }
}

function getPaywallFailureMessage() {
  try {
    const seg = typeof getUserSegment === 'function' ? getUserSegment({ subscriptionInfo }) : 'cold';
    if (seg === 'hot') return 'Still want access? Try again with discount.';
  } catch (_e) {
    /* noop */
  }
  return 'Payment failed or canceled.';
}

function showPaymentFailedWithRetry(message, variant = 'error') {
  let el = document.getElementById('dashboardBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dashboardBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.innerHTML = `<div class="dashboard-banner-retry-row"><span class="dashboard-banner-msg">${escapeHtml(message)}</span><button type="button" class="dashboard-payment-retry-btn" id="dashboardPaymentRetryBtn">Try again</button></div>`;
  el.className = `dashboard-banner dashboard-banner--${variant} dashboard-banner--with-retry`;
  el.hidden = false;
  clearTimeout(el._hideT);
  const btn = document.getElementById('dashboardPaymentRetryBtn');
  btn?.addEventListener('click', () => {
    try {
      const raw = sessionStorage.getItem(PAYMENT_RETRY_KEY);
      const ctx = raw ? JSON.parse(raw) : null;
      if (ctx?.planKey && ctx?.provider) {
        console.log('[payment] retry started', ctx.planKey, ctx.provider);
        startPaymentCheckout(ctx.planKey, ctx.provider);
      } else {
        document.querySelector('.nav-item[data-section="subscription"]')?.click();
        showDashboardBanner('Choose a plan below and start checkout again.', 'neutral');
      }
    } catch (_e) {
      document.querySelector('.nav-item[data-section="subscription"]')?.click();
      showDashboardBanner('Choose a plan below and start checkout again.', 'neutral');
    }
  });
}

function showDashboardLevelError(message) {
  const welcomeMessage = document.getElementById('welcomeMessage');
  if (welcomeMessage) {
    welcomeMessage.innerHTML = `<p class="dashboard-empty-note">${message}</p>`;
    welcomeMessage.classList.add('dashboard-error-surface');
  }
}

function generateAvatar(text) {
  const name = safeText(text, 'User');
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=128&background=6366f1&color=fff&bold=true`;
}

async function apiGet(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentSession && headers['X-Session-Id'] == null) headers['X-Session-Id'] = currentSession;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function apiPost(url, payload, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (currentSession && headers['X-Session-Id'] == null) headers['X-Session-Id'] = currentSession;
  const response = await fetch(url, {
    method: 'POST',
    ...options,
    headers,
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function setupDashboardMobileNav() {
  const toggle = document.getElementById('dashboardNavToggle');
  const sidebar = document.getElementById('cutupDashboardSidebar');
  const backdrop = document.getElementById('dashboardSidebarBackdrop');
  if (!toggle || !sidebar || !backdrop) return;

  const mq = window.matchMedia('(max-width: 1024px)');

  const close = () => {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-visible');
    backdrop.setAttribute('hidden', '');
    document.body.classList.remove('dashboard-nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    sidebar.classList.add('is-open');
    backdrop.removeAttribute('hidden');
    document.body.classList.add('dashboard-nav-open');
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => backdrop.classList.add('is-visible'));
  };

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) close();
    else open();
  });

  backdrop.addEventListener('click', close);

  document.querySelectorAll('.dashboard-sidebar .nav-item').forEach((link) => {
    link.addEventListener('click', () => {
      if (mq.matches) close();
    });
  });

  mq.addEventListener('change', (e) => {
    if (!e.matches) close();
  });
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.dashboard-section');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.dataset.section;
      navItems.forEach((n) => n.classList.remove('active'));
      sections.forEach((s) => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`${target}-section`)?.classList.add('active');
      if (target === 'profile') {
        void renderProfileSection();
      }
      if (target === 'financial') {
        void ensureBillingSectionReady();
      }
      if (target === 'notifications') {
        window.CutupDashboardNotifications?.mountPage?.();
      }
      if (target === 'help') {
        window.CutupDashboardHelp?.goHome?.();
      }
      if (target === 'support') {
        const route = window.CutupDashboardSupport?.parseSupportHash?.(window.location.hash);
        window.CutupDashboardSupport?.mount?.(route?.ticket || null);
      }
      if (target === 'saved') {
        renderSavedOutputs();
      }
    });
  });

  document.querySelector('.dashboard-content')?.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link || link.classList.contains('nav-item')) return;
    const raw = String(link.getAttribute('href') || '').replace(/^#/, '').trim();
    if (!raw) return;
    const base = raw.split('/')[0];
    if (!document.querySelector(`.nav-item[data-section="${base}"]`)) return;
    e.preventDefault();
    navigateDashboardSection(raw);
  });

  document.getElementById('userProfileLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigateDashboardSection('profile');
  });

  setupDashboardMobileNav();
}

function setupEventListeners() {
  document.getElementById('logoutBtnHeader')?.addEventListener('click', async () => {
    if (currentSession) {
      try {
        await fetch(`${API_BASE_URL}/api/auth?action=logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': currentSession
          },
          body: JSON.stringify({ session: currentSession })
        });
      } catch (_e) {
        // noop
      }
    }
    localStorage.removeItem('cutup_session');
    window.location.href = '/';
  });
}

let dashboardCountriesPromise = null;

const ONBOARDING_OVERLAY_ID = 'onboardingOverlay';
const VALID_CHECKOUT_PLAN_KEYS = new Set(['starter', 'pro', 'business']);
const ONBOARDING_SOURCE = {
  CHECKOUT: 'checkout',
  DASHBOARD: 'dashboard',
  REQUIRED: 'required'
};
const PROFILE_PREFS_LS_KEY = 'cutup_profile_prefs_v1';
const PROFILE_ONBOARDING_SESSION_KEY = 'cutup_profile_modal_shown_session';

let dashboardProfileSnapshot = null;

function readCheckoutPlanFromUrl() {
  const raw = (new URLSearchParams(window.location.search).get('checkoutPlan') || '').trim().toLowerCase();
  return VALID_CHECKOUT_PLAN_KEYS.has(raw) ? raw : '';
}

function isTopTierPlanKey(key) {
  const k = String(key || '').toLowerCase();
  return k === 'advanced' || k === 'business';
}

/** Cached GET /api/user/profile result for this page load (single fetch). */
let dashboardUserProfileCache = null;

/** While true, section renders are deferred until onboarding modal closes (avoids double paint with modal). */
let pendingDashboardSectionRender = false;

async function fetchDashboardUserProfileOnce() {
  if (dashboardUserProfileCache) return dashboardUserProfileCache;
  if (!currentSession) throw new Error('auth_failed');
  const { response, data } = await apiGet(`${API_BASE_URL}/api/user/profile`);
  dashboardUserProfileCache = { response, data, profile: data?.profile };
  return dashboardUserProfileCache;
}

function invalidateDashboardUserProfileCache() {
  dashboardUserProfileCache = null;
}

/** Gate forced onboarding modal only (not postal_code). */
function isUserProfileIncomplete(profile) {
  if (!profile) return true;
  return (
    !String(profile.first_name || '').trim() ||
    !String(profile.last_name || '').trim() ||
    !String(profile.phone || '').trim() ||
    !String(profile.country || '').trim() ||
    !String(profile.address || '').trim()
  );
}

function readOnboardingContextFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  const sourceRaw = String(sp.get('source') || '').trim().toLowerCase();
  const source =
    sourceRaw === 'checkout'
      ? ONBOARDING_SOURCE.CHECKOUT
      : sourceRaw === 'dashboard'
        ? ONBOARDING_SOURCE.DASHBOARD
        : null;
  const returnUrl = String(sp.get('returnUrl') || '').trim();
  return {
    source,
    returnUrl: returnUrl.startsWith('/') ? returnUrl : '',
    checkoutPlan: readCheckoutPlanFromUrl()
  };
}

/** Ensures Profile nav + section exist even if stale dashboard.html is served from CDN/nginx. */
function ensureDashboardRuntimeMarkup() {
  const nav = document.querySelector('#cutupDashboardSidebar .sidebar-nav');
  if (nav) {
    if (nav.querySelector('[data-section="profile"]')) {
      console.log('[profile-sidebar] mounted', 'html');
    } else {
      const billing = nav.querySelector('[data-section="financial"]');
      const link = document.createElement('a');
      link.href = '#profile';
      link.className = 'nav-item';
      link.dataset.section = 'profile';
      link.innerHTML = '<span class="nav-icon">👤</span><span class="nav-text">Profile</span>';
      if (billing) nav.insertBefore(link, billing);
      else nav.appendChild(link);
      console.log('[profile-sidebar] mounted', 'injected');
    }
  } else {
    console.warn('[profile-sidebar] nav missing');
  }

  if (!document.getElementById('profile-section')) {
    const billingSec = document.getElementById('financial-section');
    const content = document.querySelector('.dashboard-content');
    if (content) {
      const sec = document.createElement('section');
      sec.className = 'dashboard-section';
      sec.id = 'profile-section';
      sec.innerHTML =
        '<h1 class="section-title">Profile &amp; settings</h1>' +
        '<p class="dashboard-section-lead">Manage your account details and preferences.</p>' +
        '<div id="profileSettingsRoot" class="profile-settings-root"></div>';
      if (billingSec) content.insertBefore(sec, billingSec);
      else content.appendChild(sec);
      console.log('[profile-section] mounted', 'injected');
    }
  }
}

function cleanDashboardProfileQueryParams() {
  const u = new URL(window.location.href);
  let dirty = false;
  for (const key of ['editProfile', 'returnUrl', 'source', 'v']) {
    if (u.searchParams.has(key)) {
      u.searchParams.delete(key);
      dirty = true;
    }
  }
  if (dirty) {
    window.history.replaceState({}, document.title, `${u.pathname}${u.search}${u.hash}`);
  }
}

function readProfilePrefs() {
  try {
    const raw = localStorage.getItem(PROFILE_PREFS_LS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return {
      newsletter: Boolean(o.newsletter),
      productUpdates: Boolean(o.productUpdates)
    };
  } catch {
    return { newsletter: false, productUpdates: false };
  }
}

function writeProfilePrefs(prefs) {
  try {
    localStorage.setItem(
      PROFILE_PREFS_LS_KEY,
      JSON.stringify({
        newsletter: Boolean(prefs?.newsletter),
        productUpdates: Boolean(prefs?.productUpdates)
      })
    );
  } catch {
    /* noop */
  }
}

function navigateDashboardSection(sectionId) {
  const raw = String(sectionId || '').trim();
  const base = raw.split('/')[0];
  const item = document.querySelector(`.nav-item[data-section="${base}"]`);
  if (item) {
    if (base === 'support' && raw.includes('/')) {
      window.location.hash = raw.startsWith('support') ? raw : `support/${raw.split('/').slice(1).join('/')}`;
    } else if (base === 'help' && raw.includes('/')) {
      window.location.hash = raw.startsWith('help') ? raw : `help/${raw.split('/').slice(1).join('/')}`;
    } else if (base !== raw && (raw.startsWith('support/') || raw.startsWith('help/'))) {
      window.location.hash = raw;
    }
    item.click();
    return;
  }
  cutupActivateDashboardSection(raw);
  if (base === 'notifications') {
    window.CutupDashboardNotifications?.mountPage?.();
  }
  if (base === 'support') {
    const route = window.CutupDashboardSupport?.parseSupportHash?.(window.location.hash);
    window.CutupDashboardSupport?.mount?.(route?.ticket || null);
  }
  if (base === 'help') {
    const route = window.CutupDashboardHelp?.parseHelpHash?.(window.location.hash);
    window.CutupDashboardHelp?.mount?.(route?.slug || null);
  }
}

async function refreshDashboardProfileUi({ profile: profileIn } = {}) {
  let profile = profileIn;
  if (!profile) {
    invalidateDashboardUserProfileCache();
    const bundle = await fetchDashboardUserProfileOnce();
    if (!bundle.response.ok || !bundle.profile) return null;
    profile = bundle.profile;
  }
  dashboardProfileSnapshot = profile;
  applyProfileToDashboardUi(profile);
  renderProfileSection();
  return profile;
}

function resolveProfileAvatarSrc(profile, disp) {
  const custom = String(profile?.avatar_url || currentUser?.avatar_url || '').trim();
  if (custom) return custom;
  return currentUser?.picture || generateAvatar(disp);
}

function applyProfileToDashboardUi(profile) {
  if (!profile) return;
  if (currentUser) {
    currentUser.first_name = profile.first_name || currentUser.first_name;
    currentUser.last_name = profile.last_name || currentUser.last_name;
    currentUser.phone = profile.phone || currentUser.phone;
    currentUser.country = profile.country || currentUser.country;
    currentUser.address = profile.address || currentUser.address;
    currentUser.postal_code = profile.postal_code || currentUser.postal_code;
    if (profile.avatar_url) {
      currentUser.avatar_url = profile.avatar_url;
      currentUser.picture = profile.avatar_url;
    }
  }
  const disp = dashboardDisplayName({ ...currentUser, ...profile, email: profile.email || currentUser?.email });
  const greet = dashboardGreetingName({ ...currentUser, ...profile });
  const avatarSrc = resolveProfileAvatarSrc(profile, disp);
  const avatar = document.getElementById('userAvatarHeader');
  if (avatar) {
    avatar.src = avatarSrc;
  }
  const nameEl = document.getElementById('userNameHeader');
  const emailEl = document.getElementById('userEmailHeader');
  if (nameEl) nameEl.textContent = disp;
  if (emailEl) emailEl.textContent = safeText(profile.email || currentUser?.email, '');
  const wm = document.getElementById('welcomeMessage');
  if (wm && !window.__ONBOARDING_ACTIVE__) {
    wm.textContent = `Welcome back, ${greet}.`;
  }
  const identityStrip = document.getElementById('identityStrip');
  if (identityStrip) {
    identityStrip.innerHTML = `
      <div><strong>Name:</strong> ${escapeHtml(disp)}</div>
      <div><strong>Email:</strong> ${escapeHtml(safeText(profile.email || currentUser?.email))}</div>
      <div><strong>Phone:</strong> ${escapeHtml(safeText(profile.phone))}</div>
      <div><strong>Country:</strong> ${escapeHtml(safeText(profile.country))}</div>
    `;
  }
  renderSidebarProfileCard(profile, disp);
}

function renderSidebarProfileCard(profile, displayName) {
  const host = document.getElementById('dashboardSidebarProfile');
  if (!host) return;
  const incomplete = isUserProfileIncomplete(profile);
  host.hidden = false;
  host.innerHTML = `
    <div class="dashboard-sidebar-profile-inner">
      <img class="dashboard-sidebar-profile-avatar" src="${escapeHtml(
        resolveProfileAvatarSrc(profile, displayName)
      )}" alt="" width="40" height="40" />
      <div class="dashboard-sidebar-profile-meta">
        <strong class="dashboard-sidebar-profile-name">${escapeHtml(displayName)}</strong>
        <span class="dashboard-sidebar-profile-email">${escapeHtml(safeText(profile.email))}</span>
        ${
          incomplete
            ? '<span class="dashboard-sidebar-profile-badge">Profile incomplete</span>'
            : '<span class="dashboard-sidebar-profile-badge dashboard-sidebar-profile-badge--ok">Profile complete</span>'
        }
      </div>
    </div>
  `;
  host.onclick = () => navigateDashboardSection('profile');
  host.style.cursor = 'pointer';
}

let profileCountriesCache = null;

async function ensureProfileCountries() {
  if (!profileCountriesCache) {
    profileCountriesCache = await loadDashboardCountries().catch(() => []);
  }
  return profileCountriesCache;
}

function collectProfileFormPayload(root) {
  const q = (sel) => root.querySelector(sel);
  return {
    first_name: String(q('[data-prof-first]')?.value || '').trim(),
    last_name: String(q('[data-prof-last]')?.value || '').trim(),
    email: String(q('[data-prof-email]')?.value || '').trim(),
    phone: String(q('[data-prof-phone]')?.value || '').trim(),
    country: String(q('[data-prof-country]')?.value || '').trim().toUpperCase().slice(0, 2),
    address: String(q('[data-prof-address]')?.value || '').trim(),
    postal_code: String(q('[data-prof-postal]')?.value || '').trim()
  };
}

function validateProfileGateFields(payload) {
  return (
    !!payload.first_name &&
    !!payload.last_name &&
    !!payload.phone &&
    !!payload.country &&
    !!payload.address
  );
}

async function saveProfilePayload(payload, { showToast = true } = {}) {
  const { response, data } = await apiPost(`${API_BASE_URL}/api/user/profile`, payload);
  if (!response.ok) {
    const msg =
      data.error === 'email_mismatch'
        ? 'Email must match your signed-in account.'
        : data.error === 'profile_error'
          ? 'Could not save profile right now.'
          : data.message || data.error || 'Could not save profile.';
    if (showToast) showDashboardBanner(msg, 'error');
    return { ok: false, error: msg };
  }
  invalidateDashboardUserProfileCache();
  const profile = data.profile || payload;
  await refreshDashboardProfileUi({ profile });
  if (showToast) showDashboardBanner('Profile updated.', 'success');
  return { ok: true, profile };
}

function profileSectionFailedHtml(sectionLabel) {
  return `<section class="profile-settings-card profile-settings-card--error" data-profile-section-failed="${escapeHtml(sectionLabel)}">
    <p class="profile-settings-error">Could not load this section. Other settings are still available below.</p>
  </section>`;
}

function renderProfileSectionSafe(sectionName, renderFn) {
  try {
    const html = renderFn();
    console.log('[profile-section-ok]', sectionName);
    return html;
  } catch (err) {
    console.error('[profile-section-failed]', sectionName, err);
    return profileSectionFailedHtml(sectionName);
  }
}

function renderPersonalSectionHtml(ctx) {
  const { profile, disp, incomplete, avatarSrc } = ctx;
  const hasCustomAvatar = Boolean(String(profile.avatar_url || '').trim());
  return `
        <section class="profile-settings-card profile-settings-card--span-full" data-profile-section="personal">
          <header class="profile-settings-card-head">
            <h2 class="profile-settings-card-title">Personal information</h2>
            <p class="profile-settings-card-desc">Your name and contact details for billing and support.</p>
          </header>
          <motion class="profile-settings-avatar-row">
            <div class="profile-settings-avatar-stack" data-prof-avatar-root>
              <div class="profile-settings-avatar-stage">
                <img class="profile-settings-avatar" data-prof-avatar-img src="${escapeHtml(avatarSrc)}" alt="" width="112" height="112" />
                <button type="button" class="profile-settings-avatar-edit" data-prof-avatar-pick aria-label="Edit profile photo">
                  <svg class="profile-settings-avatar-edit-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4h2l1.2 2.2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.8L9 4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                    <circle cx="12" cy="13" r="3.5" stroke="currentColor" stroke-width="1.8"/>
                  </svg>
                  <span class="profile-settings-avatar-edit-label">Edit</span>
                </button>
                <input type="file" data-prof-avatar-input accept="image/jpeg,image/png,image/webp" hidden />
              </div>
              <p class="profile-settings-avatar-name">${escapeHtml(disp)}</p>
              <p class="profile-settings-avatar-hint" data-prof-avatar-hint>${
                hasCustomAvatar ? 'Profile photo' : 'Add a profile photo'
              }</p>
              ${incomplete ? '<span class="profile-settings-pill profile-settings-pill--warn">Incomplete</span>' : '<span class="profile-settings-pill profile-settings-pill--ok">Complete</span>'}
            </div>
          </motion>
          <div class="profile-settings-fields">
            <label class="profile-settings-field"><span>First name</span><input data-prof-first type="text" maxlength="255" autocomplete="given-name" value="${escapeHtml(profile.first_name || '')}" /></label>
            <label class="profile-settings-field"><span>Last name</span><input data-prof-last type="text" maxlength="255" autocomplete="family-name" value="${escapeHtml(profile.last_name || '')}" /></label>
            <label class="profile-settings-field profile-settings-field--wide"><span>Email</span><input data-prof-email type="email" readonly value="${escapeHtml(profile.email || currentUser?.email || '')}" /></label>
            <label class="profile-settings-field"><span>Phone</span><input data-prof-phone type="tel" maxlength="64" autocomplete="tel" value="${escapeHtml(profile.phone || '')}" /></label>
          </div>
        </section>`;
}

function renderLocationSectionHtml(ctx) {
  const { profile, countryOpts } = ctx;
  return `
        <section class="profile-settings-card" data-profile-section="location">
          <header class="profile-settings-card-head">
            <h2 class="profile-settings-card-title">Location</h2>
            <p class="profile-settings-card-desc">Used for invoices and regional compliance.</p>
          </header>
          <div class="profile-settings-fields profile-settings-fields--stack">
            <label class="profile-settings-field profile-settings-field--wide"><span>Country</span><select data-prof-country autocomplete="country"><option value="">Select country</option>${countryOpts}</select></label>
            <label class="profile-settings-field profile-settings-field--wide"><span>Address</span><textarea data-prof-address rows="3" maxlength="2000" autocomplete="street-address">${escapeHtml(profile.address || '')}</textarea></label>
            <label class="profile-settings-field"><span>Postal code</span><input data-prof-postal type="text" maxlength="32" autocomplete="postal-code" value="${escapeHtml(profile.postal_code || '')}" /></label>
          </div>
        </section>`;
}

function renderPreferencesSectionHtml(ctx) {
  const { prefs } = ctx;
  return `
        <section class="profile-settings-card" data-profile-section="preferences">
          <header class="profile-settings-card-head">
            <h2 class="profile-settings-card-title">Preferences</h2>
            <p class="profile-settings-card-desc">Choose what we send to your inbox.</p>
          </header>
          <div class="profile-settings-toggles">
            <label class="profile-settings-toggle">
              <input type="checkbox" data-prof-newsletter ${prefs.newsletter ? 'checked' : ''} />
              <span class="profile-settings-toggle-ui" aria-hidden="true"></span>
              <span class="profile-settings-toggle-copy"><strong>Newsletter</strong><small>Tips, guides, and product news</small></span>
            </label>
            <label class="profile-settings-toggle">
              <input type="checkbox" data-prof-product ${prefs.productUpdates ? 'checked' : ''} />
              <span class="profile-settings-toggle-ui" aria-hidden="true"></span>
              <span class="profile-settings-toggle-copy"><strong>Product updates</strong><small>Release notes and feature announcements</small></span>
            </label>
          </div>
        </section>`;
}

function renderSecuritySectionHtml() {
  return `
        <section class="profile-settings-card" data-profile-section="security">
          <header class="profile-settings-card-head">
            <h2 class="profile-settings-card-title">Security</h2>
            <p class="profile-settings-card-desc">You sign in with Google — no password to manage here.</p>
          </header>
          <div class="profile-settings-actions-row">
            <button type="button" class="profile-settings-btn profile-settings-btn--ghost" data-prof-logout-all>Log out all sessions</button>
          </div>
        </section>`;
}

function renderDangerZoneSectionHtml() {
  return `
        <section class="profile-settings-card profile-settings-card--danger profile-settings-card--span-full" data-profile-section="danger">
          <header class="profile-settings-card-head">
            <h2 class="profile-settings-card-title">Danger zone</h2>
            <p class="profile-settings-card-desc">Permanently remove your account and data.</p>
          </header>
          <div class="profile-settings-danger-row">
            <p class="profile-settings-muted">We’ll email you a secure confirmation link. Nothing is deleted until you confirm from that email.</p>
            <button type="button" class="profile-settings-btn profile-settings-btn--danger" data-prof-delete-account>Delete account</button>
          </div>
        </section>`;
}

function renderProfileSaveBarHtml(incomplete) {
  return `
      <div class="profile-settings-save-bar" role="region" aria-label="Save profile">
        ${incomplete ? '<p class="profile-settings-alert">Complete name, phone, country, and address for checkout and billing.</p>' : ''}
        <p class="profile-settings-status" data-prof-status hidden role="status"></p>
        <div class="profile-settings-save-row">
          <button type="button" class="profile-settings-btn profile-settings-btn--primary" data-prof-save>Save changes</button>
        </div>
      </div>`;
}

function fixProfileSectionMotionTags(html) {
  return String(html || '')
    .replace(/<motion(\s|>)/g, '<div$1')
    .replace(/<\/motion>/g, '</div>');
}

function bindProfileSecurityActionsSafe(root) {
  try {
    const ui = globalThis.CutupAccountSecurityUi;
    if (ui?.bindProfileSecurityActions) {
      ui.bindProfileSecurityActions(root);
      console.log('[profile-section-ok]', 'security-bind');
    }
  } catch (err) {
    console.error('[profile-section-failed]', 'security-bind', err);
  }
}

async function renderProfileSection() {
  console.log('[profile-render-start]');
  console.log('[profile-view-init]', {
    onboarding: window.__ONBOARDING_ACTIVE__ === true,
    hasRoot: Boolean(document.getElementById('profileSettingsRoot'))
  });
  if (window.__ONBOARDING_ACTIVE__) {
    console.log('[profile-view-init] skipped — onboarding modal active');
    return;
  }
  const root = document.getElementById('profileSettingsRoot');
  if (!root) {
    console.warn('[profile-view-init] #profileSettingsRoot not found');
    return;
  }

  root.setAttribute('aria-busy', 'true');
  root.innerHTML = '<p class="profile-settings-loading">Loading profile settings…</p>';

  try {
    const profile = dashboardProfileSnapshot || {};
    const prefs = readProfilePrefs();
    console.log('[profile-data-loaded]', {
      email: Boolean(profile.email || currentUser?.email),
      incomplete: isUserProfileIncomplete(profile)
    });

    const countries = await ensureProfileCountries();
    const countryOpts = Array.isArray(countries)
      ? countries
          .map(
            ({ code, name }) =>
              `<option value="${escapeHtml(code)}"${String(profile.country || '').toUpperCase() === code ? ' selected' : ''}>${escapeHtml(name)} (${escapeHtml(code)})</option>`
          )
          .join('')
      : '';
    const disp = dashboardDisplayName({ ...currentUser, ...profile });
    const incomplete = isUserProfileIncomplete(profile);
    const avatarSrc = resolveProfileAvatarSrc(profile, disp);

    const ctx = { profile, prefs, countryOpts, disp, incomplete, avatarSrc };
    const sectionHtml = [
      renderProfileSectionSafe('personal', () => renderPersonalSectionHtml(ctx)),
      renderProfileSectionSafe('location', () => renderLocationSectionHtml(ctx)),
      renderProfileSectionSafe('preferences', () => renderPreferencesSectionHtml(ctx)),
      renderProfileSectionSafe('security', () => renderSecuritySectionHtml()),
      renderProfileSectionSafe('danger', () => renderDangerZoneSectionHtml())
    ].join('');
    const saveBarHtml = renderProfileSectionSafe('save-bar', () => renderProfileSaveBarHtml(incomplete));

    root.innerHTML = fixProfileSectionMotionTags(`
    <div class="profile-settings-layout">
      <div class="profile-settings-grid">
        ${sectionHtml}
      </div>
      ${saveBarHtml}
    </div>
    `);

    const saveBtn = root.querySelector('[data-prof-save]');
    saveBtn?.addEventListener('click', async () => {
      const status = root.querySelector('[data-prof-status]');
      const btn = root.querySelector('[data-prof-save]');
      const payload = collectProfileFormPayload(root);
      if (!validateProfileGateFields(payload)) {
        if (status) {
          status.hidden = false;
          status.textContent = 'Please fill in first name, last name, phone, country, and address.';
          status.className = 'profile-settings-status profile-settings-status--error';
        }
        return;
      }
      if (status) status.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      writeProfilePrefs({
        newsletter: root.querySelector('[data-prof-newsletter]')?.checked,
        productUpdates: root.querySelector('[data-prof-product]')?.checked
      });
      const out = await saveProfilePayload(payload, { showToast: true });
      btn.disabled = false;
      btn.textContent = 'Save changes';
      if (out.ok) {
        if (status) {
          status.hidden = false;
          status.textContent = 'Saved successfully.';
          status.className = 'profile-settings-status profile-settings-status--ok';
        }
      } else if (status) {
        status.hidden = false;
        status.textContent = out.error || 'Save failed';
        status.className = 'profile-settings-status profile-settings-status--error';
      }
    });

    bindProfileSecurityActionsSafe(root);
    bindProfileAvatarPicker(root);

    console.log('[profile-render-complete]', {
      sections: root.querySelectorAll('.profile-settings-card').length,
      htmlLength: root.innerHTML.length
    });
  } catch (err) {
    console.error('[profile-render-complete] failed', err);
    root.innerHTML =
      '<p class="profile-settings-error">Could not load profile settings. Please refresh the page.</p>';
  } finally {
    root.removeAttribute('aria-busy');
  }
}

function bindProfileAvatarPicker(root) {
  const section = root.querySelector('[data-prof-avatar-root]');
  if (!section || !window.CutupProfileAvatar?.bindPicker) return;
  window.CutupProfileAvatar.bindPicker(section, {
    onUpdated: async (data) => {
      const url = data?.avatar_url || data?.profile?.avatar_url;
      if (url && currentUser) {
        currentUser.avatar_url = url;
        currentUser.picture = url;
      }
      if (data?.profile) {
        dashboardProfileSnapshot = { ...dashboardProfileSnapshot, ...data.profile };
        invalidateDashboardUserProfileCache();
        applyProfileToDashboardUi(data.profile);
      } else if (url) {
        const img = section.querySelector('[data-prof-avatar-img]');
        if (img) img.src = url;
        document.querySelectorAll('.dashboard-sidebar-profile-avatar, #userAvatarHeader').forEach((el) => {
          el.src = url;
        });
      }
      const hint = section.querySelector('[data-prof-avatar-hint]');
      if (hint) hint.textContent = 'Profile photo';
      showDashboardBanner('Profile photo updated.', 'success');
    },
    onError: (msg) => {
      showDashboardBanner(msg || 'Could not update profile photo', 'error');
    }
  });
}

function hideInitialLoader() {
  const el = document.getElementById('initialLoader');
  if (!el) return;
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 230);
}

function flushPendingDashboardRenders() {
  if (!pendingDashboardSectionRender) return;
  pendingDashboardSectionRender = false;
  if (!subscriptionInfo) return;
  renderOverview();
  renderUsageSection();
  renderSavedOutputs();
  renderPlansSection();
  renderProfileSection();
  renderBillingSection();
}

function loadDashboardCountries() {
  if (!dashboardCountriesPromise) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    dashboardCountriesPromise = fetch(`${origin}/country-list.json`).then((r) => (r.ok ? r.json() : []));
  }
  return dashboardCountriesPromise;
}

/** ipapi.co — if blocked or error, return '' (country left empty). */
async function fetchGeoCountryCode() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return '';
    const j = await r.json();
    if (j && (j.error || j.reason)) return '';
    return String(j.country_code || '').toUpperCase().slice(0, 2);
  } catch {
    return '';
  }
}

function teardownOnboardingModal(overlayNode) {
  const el = overlayNode || document.getElementById(ONBOARDING_OVERLAY_ID);
  const esc = el?._cutupOnboardingEscBlocker;
  if (typeof esc === 'function') {
    window.removeEventListener('keydown', esc, true);
  }
  el?.remove();
  document.body.style.overflow = '';
  const shell = document.getElementById('cutupDashboardShell');
  shell?.classList.remove('cutup-onboarding-locked');
  shell?.removeAttribute('inert');
  shell?.removeAttribute('aria-hidden');
  window.__ONBOARDING_ACTIVE__ = false;
  flushPendingDashboardRenders();
}

/**
 * Single source: build overlay + modal, append to document.body only.
 * @param {object} profile - prefill fields
 * @param {{ source?: string, returnUrl?: string, checkoutPlan?: string }} [options]
 */
async function renderOnboardingModalIntoBody(profile, options = {}) {
  if (document.getElementById(ONBOARDING_OVERLAY_ID)) {
    console.log('[onboarding] skip mount — overlay already present');
    return;
  }

  window.__ONBOARDING_ACTIVE__ = true;

  document.body.style.overflow = 'hidden';
  const shell = document.getElementById('cutupDashboardShell');
  shell?.classList.add('cutup-onboarding-locked');
  shell?.setAttribute('inert', '');
  shell?.setAttribute('aria-hidden', 'true');

  const escBlock = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', escBlock, true);

  const onboardingSource =
    options.source === ONBOARDING_SOURCE.CHECKOUT
      ? ONBOARDING_SOURCE.CHECKOUT
      : options.source === ONBOARDING_SOURCE.DASHBOARD
        ? ONBOARDING_SOURCE.DASHBOARD
        : ONBOARDING_SOURCE.REQUIRED;

  const overlay = document.createElement('div');
  overlay.id = ONBOARDING_OVERLAY_ID;
  overlay.dataset.onboardingSource = onboardingSource;
  overlay.dataset.checkoutReturnUrl = options.returnUrl || '';
  overlay.dataset.checkoutPlan = options.checkoutPlan || '';
  overlay.setAttribute('role', 'presentation');
  overlay._cutupOnboardingEscBlocker = escBlock;

  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.minHeight = '100dvh';
  overlay.style.zIndex = '999999999';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'flex-start';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '20px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.background = 'rgba(0,0,0,0.45)';
  overlay.style.backdropFilter = 'blur(20px)';
  try {
    overlay.style.setProperty('-webkit-backdrop-filter', 'blur(20px)');
  } catch (_e) {
    /* noop */
  }
  overlay.style.visibility = 'visible';
  overlay.classList.add('onboardingOverlay', 'onboardingOverlay--anim');

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      e.stopPropagation();
    }
  };

  const modal = document.createElement('div');
  modal.className = 'onboardingModal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'onboardingModalTitle');
  modal.addEventListener('click', (e) => e.stopPropagation());

  modal.innerHTML = `
    <div class="onboardingModalHeader">
      <div class="onboardingModalIcon" aria-hidden="true">👤</div>
      <h2 id="onboardingModalTitle" class="onboardingModalTitle">Complete your profile</h2>
      <p class="onboardingModalLead">This helps us personalize your experience</p>
    </div>
    <p class="onboardingModalError" data-onb-error role="alert" hidden></p>
    <div class="onboardingModalSuccess" data-onb-success hidden aria-live="polite">
      <span class="onboardingModalSuccessIcon" aria-hidden="true">✓</span>
      <span>Profile saved</span>
    </div>
    <form class="onboardingForm" data-onb-form novalidate>
      <div class="onboardingFormScroll">
        <div class="onboardingFormGrid">
          <label class="onboardingField">
            <span class="onboardingFieldLabel">First name <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <input data-onb-first name="first_name" type="text" autocomplete="given-name" maxlength="255">
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField">
            <span class="onboardingFieldLabel">Last name <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <input data-onb-last name="last_name" type="text" autocomplete="family-name" maxlength="255">
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField onboardingField--wide">
            <span class="onboardingFieldLabel">Email <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <input data-onb-email name="email" type="email" autocomplete="email" maxlength="255">
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField">
            <span class="onboardingFieldLabel">Phone <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <input data-onb-phone name="phone" type="tel" autocomplete="tel" maxlength="64">
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField">
            <span class="onboardingFieldLabel">Country <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <select data-onb-country name="country"></select>
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField onboardingField--wide">
            <span class="onboardingFieldLabel">Address <abbr class="onboardingFieldReq" title="Required">*</abbr></span>
            <textarea data-onb-address name="address" autocomplete="street-address" maxlength="2000" rows="3"></textarea>
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
          <label class="onboardingField onboardingField--postal">
            <span class="onboardingFieldLabel">Postal code</span>
            <input data-onb-postal name="postal_code" type="text" autocomplete="postal-code" maxlength="32">
            <span class="onboardingFieldError" hidden>Required</span>
          </label>
        </div>
      </div>
      <button type="submit" class="onboardingSubmit" data-onb-submit>Save and continue</button>
    </form>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.style.display = 'flex';
  overlay.style.visibility = 'visible';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  });

  console.log('[onboarding] modal mounted');

  const errEl = modal.querySelector('[data-onb-error]');
  const successEl = modal.querySelector('[data-onb-success]');
  const form = modal.querySelector('[data-onb-form]');
  const submitBtn = modal.querySelector('[data-onb-submit]');
  const submitDefaultLabel =
    onboardingSource === ONBOARDING_SOURCE.CHECKOUT ? 'Save and continue to checkout' : 'Save profile';
  const sel = modal.querySelector('[data-onb-country]');
  const fnEl = modal.querySelector('[data-onb-first]');
  const lnEl = modal.querySelector('[data-onb-last]');

  const countries = await loadDashboardCountries().catch(() => []);
  sel.innerHTML =
    '<option value="">Select country</option>' +
    (Array.isArray(countries)
      ? countries
          .map(
            ({ code, name }) =>
              `<option value="${escapeHtml(code)}">${escapeHtml(name)} (${escapeHtml(code)})</option>`
          )
          .join('')
      : '');

  const geo = await fetchGeoCountryCode();
  const prefCountry =
    (profile.country && String(profile.country).trim().toUpperCase().slice(0, 2)) || geo || '';
  if (prefCountry) {
    const hasOpt = Array.from(sel.options).some((o) => o.value === prefCountry);
    if (hasOpt) sel.value = prefCountry;
  }

  fnEl.value =
    String(profile.first_name || currentUser?.first_name || '').trim() ||
    (currentUser?.name && !String(currentUser.name).includes('@')
      ? String(currentUser.name).split(/\s+/)[0] || ''
      : '');
  let ln = String(profile.last_name || currentUser?.last_name || '').trim();
  if (!ln && currentUser?.name && !String(currentUser.name).includes('@')) {
    const parts = String(currentUser.name).trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) ln = parts.slice(1).join(' ');
  }
  lnEl.value = ln;
  modal.querySelector('[data-onb-email]').value = String(profile.email || currentUser?.email || '').trim();
  modal.querySelector('[data-onb-phone]').value = String(profile.phone || '').trim();
  modal.querySelector('[data-onb-postal]').value = String(profile.postal_code || '').trim();
  modal.querySelector('[data-onb-address]').value = String(profile.address || '').trim();

  errEl.hidden = true;
  errEl.textContent = '';

  function clearOnboardingFieldErrors() {
    modal.querySelectorAll('.onboardingFieldError').forEach((node) => {
      node.hidden = true;
    });
    modal.querySelectorAll('.onboardingField--invalid').forEach((node) => node.classList.remove('onboardingField--invalid'));
  }

  function showOnboardingFieldError(labelEl) {
    if (!labelEl) return;
    labelEl.classList.add('onboardingField--invalid');
    const line = labelEl.querySelector('.onboardingFieldError');
    if (line) line.hidden = false;
  }

  form.querySelectorAll('input, select, textarea').forEach((el) => {
    const clear = () => {
      const label = el.closest('.onboardingField');
      if (label) {
        label.classList.remove('onboardingField--invalid');
        const line = label.querySelector('.onboardingFieldError');
        if (line) line.hidden = true;
      }
    };
    el.addEventListener('input', clear);
    el.addEventListener('change', clear);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearOnboardingFieldErrors();
    errEl.hidden = true;
    errEl.textContent = '';
    const payload = {
      first_name: String(fnEl.value || '').trim(),
      last_name: String(lnEl.value || '').trim(),
      email: String(modal.querySelector('[data-onb-email]')?.value || '').trim(),
      phone: String(modal.querySelector('[data-onb-phone]')?.value || '').trim(),
      country: String(sel.value || '').trim().toUpperCase().slice(0, 2),
      address: String(modal.querySelector('[data-onb-address]')?.value || '').trim(),
      postal_code: String(modal.querySelector('[data-onb-postal]')?.value || '').trim()
    };
    const checks = [
      { ok: !!payload.first_name, input: fnEl },
      { ok: !!payload.last_name, input: lnEl },
      { ok: !!payload.email, input: modal.querySelector('[data-onb-email]') },
      { ok: !!payload.phone, input: modal.querySelector('[data-onb-phone]') },
      { ok: !!payload.country, input: sel },
      { ok: !!payload.address, input: modal.querySelector('[data-onb-address]') }
    ];
    let firstBad = null;
    for (const c of checks) {
      if (c.ok) continue;
      showOnboardingFieldError(c.input?.closest('.onboardingField'));
      if (c.input && !firstBad) firstBad = c.input;
    }
    if (firstBad) {
      errEl.textContent = 'Please fix the highlighted fields.';
      errEl.hidden = false;
      requestAnimationFrame(() => {
        try {
          firstBad.focus({ preventScroll: false });
          firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } catch (_e) {
          /* noop */
        }
      });
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    try {
      const { response, data } = await apiPost(`${API_BASE_URL}/api/user/profile`, payload);
      if (!response.ok) {
        const msg =
          data.error === 'profile_error'
            ? 'Could not save your profile (server error). Please try again.'
            : data.error === 'email_mismatch'
              ? 'Email must match your signed-in account.'
              : data.error === 'email_required'
                ? 'Email is required.'
                : data.message || data.error || 'Could not save profile.';
        errEl.textContent = msg;
        errEl.hidden = false;
        return;
      }
      invalidateDashboardUserProfileCache();
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('onboarding_completed', { source: 'dashboard_modal' }, 'product');
      }
      form.classList.add('is-hidden');
      successEl.hidden = false;
      await new Promise((resolve) => setTimeout(resolve, 720));
      const source = overlay.dataset.onboardingSource || ONBOARDING_SOURCE.REQUIRED;
      const returnUrl = overlay.dataset.checkoutReturnUrl || '';
      const checkoutPlan = overlay.dataset.checkoutPlan || '';
      cleanDashboardProfileQueryParams();
      if (source === ONBOARDING_SOURCE.CHECKOUT) {
        teardownOnboardingModal(overlay);
        await refreshDashboardProfileUi({ profile: data.profile || payload });
        navigateDashboardSection('profile');
        return;
      }
      teardownOnboardingModal(overlay);
      await refreshDashboardProfileUi({ profile: data.profile || payload });
      if (source === ONBOARDING_SOURCE.DASHBOARD) {
        navigateDashboardSection('profile');
      } else {
        renderOverview();
      }
    } catch (ex) {
      console.error('[onboarding] submit', ex);
      errEl.textContent = 'Network error. Please try again.';
      errEl.hidden = false;
    } finally {
      if (document.getElementById(ONBOARDING_OVERLAY_ID)) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitDefaultLabel;
      }
    }
  });

  requestAnimationFrame(() => fnEl?.focus());
}

/**
 * @param {object} [prefillProfile] - if provided, skip API and open with this data (e.g. testOnboarding).
 */
async function showOnboardingModal(prefillProfile, options = {}) {
  console.log('[onboarding] showOnboardingModal()');
  let profile;
  if (prefillProfile != null && typeof prefillProfile === 'object') {
    profile = prefillProfile;
    console.log('[onboarding] using prefill profile (no fetch)');
  } else {
    if (!currentSession) {
      console.warn('[onboarding] no session — cannot open modal');
      return;
    }
    try {
      const bundle = await fetchDashboardUserProfileOnce();
      if (!bundle.response.ok) {
        console.error('[onboarding] showOnboardingModal API failed', bundle.response.status, bundle.data);
        showDashboardBanner(
          bundle.data?.error === 'profile_error'
            ? 'Profile service error. Please try again.'
            : 'Could not load profile.',
          'error',
          { persistent: true }
        );
        return;
      }
      profile = bundle.profile || {};
      console.log('[onboarding] profile:', profile);
    } catch (e) {
      console.error('[onboarding] showOnboardingModal', e);
      showDashboardBanner('Could not open profile form.', 'error', { persistent: true });
      return;
    }
  }
  await renderOnboardingModalIntoBody(profile, {
    source: options.source || ONBOARDING_SOURCE.DASHBOARD,
    returnUrl: options.returnUrl || '',
    checkoutPlan: options.checkoutPlan || ''
  });
}

if (typeof window !== 'undefined') {
  window.showOnboardingModal = showOnboardingModal;
  window.testOnboarding = () => {
    showOnboardingModal({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      country: '',
      address: '',
      postal_code: ''
    });
  };
}

function cutupRepairSessionInHash() {
  const hash = window.location.hash || '';
  const match = hash.match(/^#([^?]+)\?session=([^&#]+)/);
  if (!match) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.get('session')) params.set('session', match[2]);
  const qs = params.toString();
  window.history.replaceState(
    {},
    document.title,
    `${window.location.pathname}${qs ? `?${qs}` : ''}#${match[1]}`,
  );
}

function cutupBuildDashboardUrl({ session, hash } = {}) {
  const path = '/dashboard.html';
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  const fragment = hash ? `#${String(hash).replace(/^#/, '')}` : '';
  return `${path}${query}${fragment}`;
}

function cutupActivateDashboardSection(sectionId) {
  const raw = String(sectionId || '').trim();
  const base = raw.split('/')[0];
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.querySelectorAll('.dashboard-section').forEach((s) => s.classList.remove('active'));
  document.querySelector(`.nav-item[data-section="${base}"]`)?.classList.add('active');
  document.getElementById(`${base}-section`)?.classList.add('active');
  if (raw.includes('/')) {
    window.location.hash = raw.startsWith(`${base}/`) ? raw : `${base}/${raw.split('/').slice(1).join('/')}`;
  } else if (raw) {
    window.location.hash = raw;
  }
}

function getSessionFromLocation() {
  cutupRepairSessionInHash();
  const params = new URLSearchParams(window.location.search);
  const authSuccess = params.get('auth');
  const sessionId = params.get('session');
  const paymentResult = params.get('payment');
  const paymentId = params.get('payment_id');
  const checkoutSessionId = params.get('checkout_session_id');
  const authority = params.get('authority');

  const paymentReturn = {
    result: paymentResult,
    paymentId,
    checkoutSessionId,
    authority
  };

  if (authSuccess === 'success' && sessionId) {
    localStorage.setItem('cutup_session', sessionId);
    if (cutupShouldResumeOnHomepage()) {
      window.location.replace(`${window.location.origin}/?resume=1`);
      return { activeSession: sessionId, paymentReturn, bouncingHome: true };
    }
    const checkoutAfterAuth = window.CutupPlanCheckout?.resolvePostLoginRedirect?.();
    if (checkoutAfterAuth) {
      console.log('[checkout-after-oauth]', { url: checkoutAfterAuth, from: 'dashboard_callback' });
      window.location.replace(checkoutAfterAuth);
      return { activeSession: sessionId, paymentReturn, bouncingCheckout: true };
    }
  }

  const activeSession = sessionId || localStorage.getItem('cutup_session');
  if (paymentResult || authSuccess === 'success') {
    const qp = new URLSearchParams();
    if (activeSession) qp.set('session', activeSession);
    const cp = params.get('checkoutPlan');
    if (cp) qp.set('checkoutPlan', cp);
    const src = params.get('source');
    if (src === 'checkout' || src === 'dashboard') qp.set('source', src);
    const ru = params.get('returnUrl');
    if (ru) qp.set('returnUrl', ru);
    const qs = qp.toString();
    const hash = window.location.hash || '';
    window.history.replaceState({}, document.title, `${window.location.pathname}${qs ? `?${qs}` : ''}${hash}`);
  }
  return { activeSession, paymentReturn };
}

window.cutupActivateDashboardSection = cutupActivateDashboardSection;
window.cutupBuildDashboardUrl = cutupBuildDashboardUrl;

async function loadUserProfile() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/auth?action=me&session=${currentSession}`);
  if (!response.ok || !data.user) {
    throw new Error('auth_failed');
  }
  if (window.CutupRoleGuard?.handleAuthMePayload?.(data)) {
    window.CutupRoleGuard.renderDashboardAdminNotice?.();
    throw new Error('admin_workspace_only');
  }
  currentUser = data.user;
}

async function loadSubscriptionInfo() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=info&session=${currentSession}`, {
    headers: { 'X-Session-Id': currentSession }
  });
  if (!response.ok) {
    throw new Error('subscription_failed');
  }
  subscriptionInfo = data;
}

async function loadUsageHistory() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=history&session=${currentSession}&limit=60`, {
    headers: { 'X-Session-Id': currentSession }
  });
  historyCache = response.ok ? (data.history || []) : [];
}

async function loadActivityFeed() {
  const { response, data } = await apiGet(
    `${API_BASE_URL}/api/subscription?action=activity&session=${currentSession}&limit=30&filter=all`,
    { headers: { 'X-Session-Id': currentSession } }
  );
  activityFeedCache = response.ok ? (data.events || []) : [];
}

async function loadPlans() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=plans`);
  plansCache = response.ok ? (data.plans || []) : [];
}

function buildBillingFallbackFromSubscriptionInfo(sub) {
  if (!sub) return null;
  const planKey = String(sub.plan || 'free').toLowerCase();
  const credits = creditsFromSubscription(sub);
  const PP = window.CutupPlanPermissions;
  const monthly = Number(PP?.PLAN_PRICES?.[planKey]?.monthly ?? 0);
  const priceDisplay = monthly > 0 ? `€${monthly.toFixed(2)} / month` : '€0';
  return {
    ok: false,
    error: 'billing_api_unavailable',
    subscription: {
      plan: planKey,
      planName: PP?.displayPlanName?.(planKey) || displayPlanTitle(sub.plan, sub.planName),
      planTagline: sub.planTagline || null,
      price: { amount: monthly, currency: 'EUR', display: priceDisplay, periodLabel: monthly > 0 ? 'month' : null },
      billingPeriod: sub.subscription?.billingPeriod || 'monthly',
      status: sub.subscription?.status || (planKey === 'free' ? 'free' : 'active'),
      nextRenewalDate: sub.subscription?.endDate || null,
      currentPeriodStart: sub.subscription?.startDate || null,
      currentPeriodEnd: sub.subscription?.endDate || null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      stripeCustomerId: sub.subscription?.stripeCustomerId || null,
      stripeSubscriptionId: sub.subscription?.stripeSubscriptionId || null
    },
    creditsSnapshot: {
      used: credits.used,
      remaining: credits.remaining,
      limit: credits.limit,
      cycleStart: sub.subscription?.startDate || null,
      cycleEnd: sub.subscription?.endDate || null
    },
    lifetime: sub.lifetime || { outputs: 0, mp4Exports: 0, processingJobs: 0 },
    usage: {
      monthlyCredits: credits.limit,
      usedCredits: credits.used,
      remainingCredits: credits.remaining,
      cycleStart: sub.creditsSnapshot?.cycleStart || sub.subscription?.startDate || null,
      cycleEnd: sub.creditsSnapshot?.cycleEnd || sub.subscription?.endDate || null
    },
    paymentMethod: null,
    billingHistory: [],
    upcomingCharge: null,
    paymentFailure: null,
    actions: { canOpenPortal: false, canRetryPayment: false, canUpgrade: planKey !== 'business' }
  };
}

async function loadBillingDashboard() {
  billingDashboardLoadState = 'loading';
  billingDashboardLoadError = null;
  let result = null;
  if (window.CutupBillingDashboard?.load) {
    result = await window.CutupBillingDashboard.load({
      session: currentSession,
      apiBase: API_BASE_URL
    });
  } else {
    const { response, data } = await apiGet(
      `${API_BASE_URL}/api/subscription?action=billing&session=${currentSession}`,
      { headers: { 'X-Session-Id': currentSession } }
    );
    result = {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : (data?.error || `HTTP ${response.status}`),
      data: response.ok ? data : (data?.subscription ? data : null)
    };
    console.log('[billing] fetch', { status: response.status, ok: response.ok, body: data });
  }

  if (result?.ok && result.data) {
    billingDashboardCache = result.data;
    billingDashboardLoadState = 'ready';
    return;
  }

  billingDashboardLoadError = result?.error || 'billing_load_failed';
  billingDashboardCache = result?.data || buildBillingFallbackFromSubscriptionInfo(subscriptionInfo);
  billingDashboardLoadState = billingDashboardCache ? 'ready' : 'error';
  console.warn('[billing] load failed', { error: billingDashboardLoadError, status: result?.status, fallback: Boolean(billingDashboardCache) });
}

async function ensureBillingSectionReady({ forceReload = false } = {}) {
  if (forceReload || billingDashboardLoadState === 'idle' || billingDashboardLoadState === 'error') {
    await loadBillingDashboard();
  }
  renderBillingSection();
}

async function loadSavedOutputs() {
  if (window.CutupSavedOutputsLibrary?.reload) {
    await window.CutupSavedOutputsLibrary.reload(getSavedOutputsLibraryCtx());
    savedOutputsCache = window.CutupSavedOutputsLibrary.getState?.()?.items || [];
    return;
  }
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=savedOutputs&session=${currentSession}&limit=100`, {
    headers: { 'X-Session-Id': currentSession }
  });
  savedOutputsCache = response.ok ? (data.outputs || []) : [];
}

function navigateToContentLibrary() {
  navigateDashboardSection('saved');
}

function getLibraryStatsFromState() {
  const st = window.CutupSavedOutputsLibrary?.getState?.();
  if (st?.stats && (st.stats.dbTotal != null || st.stats.total != null)) {
    return st.stats;
  }
  const lifetime = lifetimeFromSubscription(subscriptionInfo);
  return {
    total: lifetime.outputs + lifetime.mp4Exports,
    dbTotal: lifetime.outputs + lifetime.mp4Exports,
    transcripts: lifetime.outputs,
    translations: 0,
    mp4: lifetime.mp4Exports
  };
}

function getRecentLibraryOutputs(limit = 5) {
  if (window.CutupSavedOutputsLibrary?.getRecent) {
    return window.CutupSavedOutputsLibrary.getRecent(limit);
  }
  return (savedOutputsCache || []).slice(0, limit);
}

function renderLibraryWidgetHtml({ title = 'Content library', limit = 5, showOpen = true } = {}) {
  const recent = getRecentLibraryOutputs(limit);
  const stats = getLibraryStatsFromState();
  const total = stats.dbTotal != null ? stats.dbTotal : stats.total || 0;
  if (!total && !recent.length) {
    return `
      <div class="lib-widget">
        <div class="lib-widget__head">
          <h3 class="lib-widget__title">${escapeHtml(title)}</h3>
          ${showOpen ? '<button type="button" class="lib-widget__link" data-open-library>Open Library</button>' : ''}
        </div>
        <p class="dashboard-muted-loading">No saved outputs yet. Process a video to build your library.</p>
      </div>`;
  }
  const rows = recent.length
    ? recent.map((item) => {
        const t = safeText(item.title, item.displayType || 'Output');
        const when = item.createdAt ? formatDateTime(item.createdAt) : '—';
        const type = safeText(item.displayType || item.type, 'Output');
        return `<li class="lib-widget__item"><strong>${escapeHtml(t)}</strong><span>${escapeHtml(type)} · ${escapeHtml(when)}</span></li>`;
      }).join('')
    : `<li class="lib-widget__item"><strong>${total} outputs</strong><span>In your library</span></li>`;
  return `
    <div class="lib-widget">
      <div class="lib-widget__head">
        <h3 class="lib-widget__title">${escapeHtml(title)}</h3>
        ${showOpen ? '<button type="button" class="lib-widget__link" data-open-library>Open Library</button>' : ''}
      </div>
      <ul class="lib-widget__list">${rows}</ul>
    </div>`;
}

function bindLibraryWidgetLinks(root) {
  root?.querySelectorAll('[data-open-library]').forEach((btn) => {
    btn.addEventListener('click', () => navigateToContentLibrary());
  });
}

function renderOverviewLibraryWidget() {
  const target = document.getElementById('overviewLibraryWidget');
  if (!target) return;
  target.innerHTML = renderLibraryWidgetHtml({ title: 'Recent outputs', limit: 5 });
  bindLibraryWidgetLinks(target);
}

function getSavedOutputsLibraryCtx() {
  return {
    target: document.getElementById('savedOutputs'),
    session: currentSession,
    apiBase: API_BASE_URL,
    apiGet,
    apiPost,
    showBanner: showDashboardBanner,
    openTool: openToolWithUrl,
    onLoaded: (libState) => {
      savedOutputsCache = libState?.items || [];
      renderOverviewLibraryWidget();
    }
  };
}

async function loadOffers() {
  try {
    if (window.CutupOffersResolver && typeof window.CutupOffersResolver.resolveActiveUserOffers === 'function') {
      offersResolvedState = await window.CutupOffersResolver.resolveActiveUserOffers({
        sessionId: currentSession,
        userPlan: String(subscriptionInfo?.plan || '').toLowerCase()
      });
      offersCache = Array.isArray(offersResolvedState?.offers) ? offersResolvedState.offers : [];
      return;
    }
  } catch (_e) {
    /* fallback to direct API */
  }
  const { response, data } = await apiGet(`${API_BASE_URL}/api/offers`, {
    headers: { 'X-Session-Id': currentSession }
  });
  offersCache = response.ok ? (data.offers || []) : [];
  offersResolvedState = null;
}

async function loadDashboardHeavy({ silent = false, skipUserProfile = false } = {}) {
  if (!silent) {
    const wm = document.getElementById('welcomeMessage');
    if (wm) wm.textContent = 'Refreshing your dashboard...';
  }
  const tasks = [];
  if (!skipUserProfile) tasks.push(loadUserProfile());
  tasks.push(
    loadSubscriptionInfo(),
    loadUsageHistory(),
    loadActivityFeed(),
    loadPlans(),
    loadSavedOutputs(),
    loadOffers(),
    loadBillingDashboard()
  );
  await Promise.all(tasks);
  if ((!billingDashboardCache || billingDashboardLoadState === 'error') && subscriptionInfo) {
    const billingFallback = buildBillingFallbackFromSubscriptionInfo(subscriptionInfo);
    if (billingFallback) {
      billingDashboardCache = billingFallback;
      billingDashboardLoadState = 'ready';
      console.warn('[billing] using subscriptionInfo fallback after parallel load');
    }
  }
  if (window.__ONBOARDING_ACTIVE__) {
    pendingDashboardSectionRender = true;
    if (!silent) {
      const wm = document.getElementById('welcomeMessage');
      if (wm) wm.textContent = `Welcome back, ${dashboardGreetingName(currentUser)}.`;
    }
    return;
  }
  pendingDashboardSectionRender = false;
  renderOverview();
  renderUsageSection();
  renderSavedOutputs();
  renderPlansSection();
  await renderProfileSection();
  renderBillingSection();
  if (!silent) {
    const wm = document.getElementById('welcomeMessage');
    if (wm) wm.textContent = `Welcome back, ${dashboardGreetingName(currentUser)}.`;
  }
}

/**
 * First paint: profile API + session user, then onboarding gate, then heavy sections (subscription, etc.).
 * @returns {{ ok: true, paymentReturn: object } | { ok: false }}
 */
async function initDashboard() {
  const legacyCheckoutPlan = readCheckoutPlanFromUrl();
  if (legacyCheckoutPlan) {
    const legacyUrl =
      window.CutupPlanCheckout?.buildCheckoutUrl(legacyCheckoutPlan, { source: 'dashboard' }) ||
      `/checkout.html?plan=${encodeURIComponent(legacyCheckoutPlan)}`;
    console.log('[checkout-route]', { legacyUrl, reason: 'legacy_checkoutPlan_param' });
    window.location.replace(legacyUrl);
    return { ok: false };
  }

  const { activeSession, paymentReturn, bouncingHome, bouncingCheckout } = getSessionFromLocation();
  if (bouncingHome || bouncingCheckout) {
    return { ok: false };
  }
  currentSession = activeSession;
  if (!currentSession) {
    hideInitialLoader();
    try {
      const hash = String(window.location.hash || '').replace(/^#/, '').trim();
      if (hash && /^(support|help|notifications|billing|subscription)/.test(hash)) {
        sessionStorage.setItem('cutup_post_auth_url', `/dashboard.html#${hash}`);
      }
    } catch (_e) { /* noop */ }
    window.location.href = '/?signin=1';
    return { ok: false };
  }
  localStorage.setItem('cutup_session', currentSession);
  ensureDashboardRuntimeMarkup();
  setupNavigation();
  setupEventListeners();
  window.CutupDashboardNotifications?.init?.();

  let profileBundle;
  try {
    const results = await Promise.all([fetchDashboardUserProfileOnce(), loadUserProfile()]);
    profileBundle = results[0];
  } catch (e) {
    hideInitialLoader();
    if (e.message === 'admin_workspace_only') {
      return { ok: false };
    }
    if (e.message === 'auth_failed') {
      localStorage.removeItem('cutup_session');
      window.location.href = '/';
      return { ok: false };
    }
    showDashboardLevelError('Could not load dashboard data right now. Please refresh in a moment.');
    return { ok: false };
  }

  hideInitialLoader();

  const runHeavySafe = () =>
    loadDashboardHeavy({ silent: false, skipUserProfile: true }).catch((err) => {
      if (err.message === 'auth_failed') {
        localStorage.removeItem('cutup_session');
        window.location.href = '/';
        return;
      }
      showDashboardLevelError('Could not load dashboard data right now. Please refresh in a moment.');
    });

  if (profileBundle.response.status === 503) {
    console.warn('[onboarding] service unavailable (503)', profileBundle.data);
    await runHeavySafe();
    return { ok: true, paymentReturn };
  }
  if (!profileBundle.response.ok) {
    showDashboardBanner(
      profileBundle.data?.error === 'profile_error'
        ? 'Profile service is temporarily unavailable. Please try again.'
        : 'Could not load your profile. Please refresh.',
      'error',
      { persistent: true }
    );
    await runHeavySafe();
    return { ok: true, paymentReturn };
  }
  if (profileBundle.data?.ok === false || !profileBundle.profile) {
    showDashboardBanner('Could not load your profile.', 'error', { persistent: true });
    await runHeavySafe();
    return { ok: true, paymentReturn };
  }

  const profile = profileBundle.profile;
  dashboardProfileSnapshot = profile;
  applyProfileToDashboardUi(profile);
  const isIncomplete = isUserProfileIncomplete(profile);
  const urlCtx = readOnboardingContextFromUrl();
  const forceOnb = window.__FORCE_ONBOARDING__ === true;
  const checkoutFlow = urlCtx.source === ONBOARDING_SOURCE.CHECKOUT;
  let alreadyPrompted = false;
  try {
    alreadyPrompted = sessionStorage.getItem(PROFILE_ONBOARDING_SESSION_KEY) === '1';
  } catch (_e) {
    /* noop */
  }
  const shouldOpenModal =
    forceOnb || (isIncomplete && (checkoutFlow || !alreadyPrompted));

  console.log('[profile-modal-check]', {
    build: DASHBOARD_BUILD_ID,
    isIncomplete,
    forceOnb,
    checkoutFlow,
    alreadyPrompted,
    shouldOpenModal,
    urlSource: urlCtx.source,
    returnUrl: urlCtx.returnUrl,
    hasProfileNav: Boolean(document.querySelector('[data-section="profile"]')),
    profile: {
      first_name: Boolean(String(profile.first_name || '').trim()),
      last_name: Boolean(String(profile.last_name || '').trim()),
      phone: Boolean(String(profile.phone || '').trim()),
      country: Boolean(String(profile.country || '').trim()),
      address: Boolean(String(profile.address || '').trim())
    }
  });

  if (shouldOpenModal) {
    window.__ONBOARDING_ACTIVE__ = true;
    void runHeavySafe();
    if (isIncomplete) {
      try {
        sessionStorage.setItem(PROFILE_ONBOARDING_SESSION_KEY, '1');
      } catch (_e) {
        /* noop */
      }
    }
    if (typeof window.trackEvent === 'function') {
      window.trackEvent('onboarding_started', { forced: forceOnb, source: urlCtx.source }, 'product');
    }
    const onboardingSource =
      forceOnb && urlCtx.source === ONBOARDING_SOURCE.DASHBOARD
        ? ONBOARDING_SOURCE.DASHBOARD
        : urlCtx.source === ONBOARDING_SOURCE.CHECKOUT
          ? ONBOARDING_SOURCE.CHECKOUT
          : ONBOARDING_SOURCE.REQUIRED;
    await renderOnboardingModalIntoBody(profile, {
      source: onboardingSource,
      returnUrl: urlCtx.returnUrl,
      checkoutPlan: urlCtx.checkoutPlan
    });
  } else if (isIncomplete) {
    window.__ONBOARDING_ACTIVE__ = false;
    cleanDashboardProfileQueryParams();
    void runHeavySafe();
    showDashboardBanner('Complete your profile in Profile settings (sidebar).', 'info', { persistent: true });
    navigateDashboardSection('profile');
  } else {
    window.__ONBOARDING_ACTIVE__ = false;
    cleanDashboardProfileQueryParams();
    await runHeavySafe();
    const rawHash = window.location.hash.replace(/^#/, '');
    const supportRoute = window.CutupDashboardSupport?.parseSupportHash?.(window.location.hash);
    const helpRoute = window.CutupDashboardHelp?.parseHelpHash?.(window.location.hash);
    const hashSec = supportRoute
      ? 'support'
      : helpRoute
        ? 'help'
        : rawHash === 'billing'
          ? 'financial'
          : rawHash.split('/')[0];
    const urlParams = new URLSearchParams(window.location.search);
    dashboardHighlightPlan = urlParams.get('highlightPlan');
    if (supportRoute) {
      navigateDashboardSection(supportRoute.ticket ? `support/${supportRoute.ticket}` : 'support');
      window.CutupDashboardSupport?.mount?.(supportRoute.ticket || null);
    } else if (helpRoute) {
      navigateDashboardSection(helpRoute.slug ? `help/${helpRoute.slug}` : 'help');
      window.CutupDashboardHelp?.mount?.(helpRoute.slug || null);
    } else if (hashSec && document.querySelector(`.nav-item[data-section="${hashSec}"]`)) {
      navigateDashboardSection(hashSec);
    } else if (dashboardHighlightPlan || hashSec === 'subscription') {
      navigateDashboardSection('subscription');
    }
    if (dashboardHighlightPlan) {
      try {
        const clean = new URL(window.location.href);
        clean.searchParams.delete('highlightPlan');
        window.history.replaceState({}, document.title, `${clean.pathname}${clean.search}${clean.hash}`);
      } catch (_e) {
        /* noop */
      }
    }
  }

  return { ok: true, paymentReturn };
}

function renderOverview() {
  if (window.__ONBOARDING_ACTIVE__) return;
  if (!subscriptionInfo) return;
  const usage = subscriptionInfo.usage || {};
  const credits = creditsFromSubscription(subscriptionInfo);
  const genLimit = credits.limit;
  const genUsed = credits.used;
  const remainingVideos = String(credits.remaining);

  renderInsights();
  renderOverviewActivity();
  renderOverviewLibraryWidget();
  renderOffersUi();
  renderUpgradeWarning();

  const remainingEl = document.getElementById('remainingVideos');
  if (remainingEl) remainingEl.textContent = remainingVideos;
  const statLbl = document.getElementById('statRemainingLabel');
  if (statLbl) {
    statLbl.textContent = `Used ${genUsed} · Remaining ${credits.remaining} · Limit ${genLimit}`;
  }

  const currentPlanCard = document.getElementById('currentPlanCard');
  if (currentPlanCard) {
    const planKey = String(subscriptionInfo.plan || 'free').toLowerCase();
    const showUpgrade = planKey !== 'business';
    currentPlanCard.innerHTML = showUpgrade
      ? `<p class="dashboard-muted-loading">Manage your plan and credits in <a href="#subscription">Plans &amp; upgrades</a>.</p>`
      : `<p class="dashboard-muted-loading">You are on the Business plan with full access.</p>`;
  }
}

function renderOffersUi() {
  const activeOffers = (offersCache || []).filter((o) => o.userOfferStatus === 'active' && (!o.expiresAt || new Date(o.expiresAt) > new Date()));
  const prioritized = offersResolvedState?.selectedOffer || activeOffers[0] || null;
  const bannerHost = document.getElementById('dashboardOfferBannerHost');
  const offersCard = document.getElementById('myOffersCard');
  const nowTs = Date.now();
  const planEur = { starter: 7.99, pro: 19.99, business: 49.99 };
  const fmtCountdown = (expiresAt) => {
    if (!expiresAt) return 'No expiry';
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const d = Math.floor(diff / (24 * 3600 * 1000));
    const h = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  };
  if (bannerHost) {
    const firstOffer = prioritized;
    const dismissKey = firstOffer ? `cutup_offer_banner_hide_until_${String(firstOffer.code || '').toUpperCase()}` : '';
    const hiddenUntil = dismissKey ? Number(localStorage.getItem(dismissKey) || 0) : 0;
    if (!prioritized || hiddenUntil > nowTs) {
      bannerHost.innerHTML = '';
    } else {
      const o = firstOffer;
      const discountLabel = o.discountType === 'percentage' ? `${Number(o.discountValue)}%` : `€${Number(o.discountValue).toFixed(2)}`;
      const expiresText = fmtCountdown(o.expiresAt);
      const targetPlan = o.targetPlan || (Array.isArray(o.applicablePlans) && o.applicablePlans.length ? o.applicablePlans[0] : 'pro');
      const base = Number(planEur[targetPlan] || 0);
      const final = o.discountType === 'percentage'
        ? Math.max(0, base - ((base * Number(o.discountValue || 0)) / 100))
        : Math.max(0, base - Number(o.discountValue || 0));
      bannerHost.innerHTML = `
        <div class="dashboard-offer-banner">
          <p>🎉 ${escapeHtml(o.title || 'Offer available')} · ${escapeHtml(discountLabel)} off · ${escapeHtml(expiresText)} · ${base > 0 ? `Now €${final.toFixed(2)}/mo` : ''}</p>
          <div class="dashboard-offer-banner-actions">
            <button type="button" class="plan-btn" id="useOfferTopBtn">Apply offer</button>
            <button type="button" class="plan-btn plan-btn--ghost" id="dismissOfferTopBtn">Dismiss</button>
          </div>
        </div>
      `;
      document.getElementById('useOfferTopBtn')?.addEventListener('click', () => {
        window.location.href = `/checkout.html?plan=${encodeURIComponent(targetPlan)}&coupon=${encodeURIComponent(o.code)}`;
      });
      document.getElementById('dismissOfferTopBtn')?.addEventListener('click', () => {
        if (dismissKey) localStorage.setItem(dismissKey, String(Date.now() + (24 * 3600 * 1000)));
        bannerHost.innerHTML = '';
      });
      try {
        console.log('[offers]', { dashboardCardRendered: true, selectedOffer: o.code });
      } catch (_e) {}
    }
  }
  if (offersCard) {
    const offersForCards = activeOffers.length ? activeOffers : (prioritized ? [prioritized] : []);
    offersCard.innerHTML = `
      <h2>My offers</h2>
      ${offersForCards.length
        ? offersForCards.map((o) => `
          ${(() => {
            const targetPlan = o.targetPlan || (o.applicablePlans || [])[0] || 'pro';
            const base = Number(({ starter: 7.99, pro: 19.99, business: 49.99 })[targetPlan] || 0);
            const final = o.discountType === 'percentage'
              ? Math.max(0, base - ((base * Number(o.discountValue || 0)) / 100))
              : Math.max(0, base - Number(o.discountValue || 0));
            return `
          <article class="dashboard-offer-card">
            <div class="dashboard-offer-card-head">
              <strong>${escapeHtml(o.title || o.code)}</strong>
              <span class="dashboard-offer-badge">${o.discountType === 'percentage' ? `${Number(o.discountValue)}% OFF` : `€${Number(o.discountValue).toFixed(2)} OFF`}</span>
            </div>
            <p class="dashboard-offer-meta">Plan: ${escapeHtml(targetPlan)} · ${escapeHtml(fmtCountdown(o.expiresAt))} · Code: <code>${escapeHtml(o.code)}</code> ${base > 0 ? `· Now €${final.toFixed(2)}/mo` : ''}</p>
            <button type="button" class="plan-btn plan-btn--ghost" data-use-offer="${escapeHtml(o.code)}">Apply offer</button>
          </article>
        `; })()}
        `).join('')
        : '<p>No active offers.</p>'}
    `;
    offersCard.querySelectorAll('[data-use-offer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-use-offer') || '';
        const targetPlan = offersForCards.find((o) => o.code === code)?.applicablePlans?.[0] || 'pro';
        window.location.href = `/checkout.html?plan=${encodeURIComponent(targetPlan)}&coupon=${encodeURIComponent(code)}`;
      });
    });
  }
  try {
    console.log('[offers-resolver]', {
      dashboardRendered: true,
      activeOffersCount: activeOffers.length,
      prioritizedOffer: prioritized?.code || null,
      bannerHasContent: !!(bannerHost && bannerHost.innerHTML && bannerHost.innerHTML.trim().length > 0)
    });
  } catch (_e) {}
}

function formatHistoryType(type) {
  switch (type) {
    case 'transcription': return 'Transcription';
    case 'summarization': return 'Summarization';
    case 'srt': return 'SRT';
    case 'downloadAudio': return 'Download audio';
    case 'downloadVideo': return 'Download video';
    case 'download': return 'Download';
    default: return type || 'Activity';
  }
}

function activityFeedLabel(item) {
  const type = item?.type;
  const meta = item?.metadata || {};
  if (type === 'mp4_export' || meta.operation === 'mp4_export') return 'MP4 exported';
  if (type === 'summarization') return 'Summary generated';
  if (meta.translationOnly || meta.operation === 'translation') return 'Translation created';
  if (type === 'download' && meta.kind === 'video') return 'MP4 downloaded';
  if (type === 'transcription' || meta.operation === 'transcript') return 'Transcript created';
  if (type === 'srt' || meta.operation === 'subtitle') return 'Subtitle created';
  return formatHistoryType(type === 'download'
    ? (meta.kind === 'audio' ? 'downloadAudio' : meta.kind === 'video' ? 'downloadVideo' : 'download')
    : type);
}

function computeUsageLifetimeStats(history, sub) {
  const h = Array.isArray(history) ? history : [];
  let videos = 0;
  let exports = 0;
  let subtitles = 0;
  h.forEach((item) => {
    const t = item?.type;
    const m = item?.metadata || {};
    if (t === 'transcription' && !m.translationOnly) videos += 1;
    if (t === 'srt') subtitles += 1;
    if (t === 'download' && m.kind === 'video') exports += 1;
  });
  const dlVideo = Number(sub?.usage?.downloads?.video?.count) || 0;
  const dlAudio = Number(sub?.usage?.downloads?.audio?.count) || 0;
  return {
    videos: Math.max(videos, 0),
    exports: Math.max(exports, dlVideo),
    subtitles: Math.max(subtitles, 0),
    downloads: dlAudio + dlVideo
  };
}

function formatSavedOutputTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'transcript' || t === 'transcription') return 'Transcript';
  if (t === 'summary' || t === 'summarization') return 'Summary';
  if (t === 'srt') return 'Translation';
  if (t === 'mp4' || t === 'video') return 'MP4';
  if (t === 'docx') return 'DOCX';
  if (t === 'txt') return 'TXT';
  return formatHistoryType(type);
}

function formatPlatformLabel(platform, sourceUrl = '') {
  const p = String(platform || '').toLowerCase();
  if (p.includes('youtube')) return 'YouTube';
  if (p.includes('instagram')) return 'Instagram';
  if (p.includes('tiktok')) return 'TikTok';
  if (p.includes('upload') || p.includes('audiofile')) return 'Upload';
  if (sourceUrl.includes('youtube')) return 'YouTube';
  if (sourceUrl.includes('instagram')) return 'Instagram';
  if (sourceUrl.includes('tiktok')) return 'TikTok';
  return 'Unknown';
}

function fallbackTitle(platform, sourceUrl = '') {
  const p = formatPlatformLabel(platform, sourceUrl);
  if (p === 'Instagram') return 'Instagram reel';
  if (p === 'TikTok') return 'TikTok video';
  if (p === 'Upload') return 'Uploaded file';
  if (p === 'YouTube') return 'YouTube video';
  return 'Generated output';
}

function normalizeSavedOutputType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'transcript' || t === 'transcription') return 'transcript';
  if (t === 'summary' || t === 'summarization') return 'summary';
  if (t === 'srt') return 'srt';
  return t || 'transcript';
}

function openToolWithUrl(urlValue = '') {
  const url = String(urlValue || '').trim();
  if (url) {
    localStorage.setItem('cutup_pending_url', url);
  } else {
    localStorage.removeItem('cutup_pending_url');
  }
  localStorage.setItem('cutup_pending_platform', 'youtube');
  window.location.href = '/#tool';
}

function isUnlimitedPlan() {
  const planId = String(subscriptionInfo?.plan || '').toLowerCase();
  return planId === 'business' || planId === 'advanced';
}

function getThisMonthActivityCount() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return historyCache.filter((item) => String(item.date || '').slice(0, 7) === ym).length;
}

function getMostUsedFeatureLabel() {
  const counters = historyCache.reduce((acc, item) => {
    const type = item.type === 'download'
      ? (item.metadata?.kind === 'audio' ? 'downloadAudio' : item.metadata?.kind === 'video' ? 'downloadVideo' : 'download')
      : item.type;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(counters).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return 'Start with your first transcript';
  return formatHistoryType(sorted[0][0]);
}

function getLastActivityLabel() {
  const feed = activityFeedCache.length ? activityFeedCache : null;
  const lastIso = feed?.[0]?.createdAt || historyCache[0]?.date;
  if (!lastIso) return 'Start with your first transcript';
  if (window.CutupActivityFeed?.formatRelativeTime) {
    return window.CutupActivityFeed.formatRelativeTime(lastIso);
  }
  const last = new Date(lastIso);
  if (Number.isNaN(last.getTime())) return 'Start with your first transcript';
  const diffMs = Date.now() - last.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return 'Less than 1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} days ago`;
}

function renderOverviewActivity() {
  const target = document.getElementById('overviewActivityFeed');
  if (!target || !window.CutupActivityFeed?.renderTimeline) return;
  window.CutupActivityFeed.renderTimeline(target, activityFeedCache, {
    limit: 10,
    category: 'all',
    emptyMessage: 'Your activity will appear here after your first video or payment.'
  });
}

function renderInsights() {
  const target = document.getElementById('insightsGrid');
  if (!target || !subscriptionInfo) return;
  const usage = subscriptionInfo.usage || {};
  const credits = creditsFromSubscription(subscriptionInfo);
  const lifetime = lifetimeFromSubscription(subscriptionInfo);
  const monthVideos = credits.used;
  const savedCount = lifetime.outputs;
  const monthActivities = getThisMonthActivityCount();
  const mostUsed = getMostUsedFeatureLabel();
  target.innerHTML = `
    <article class="insight-card"><h3>You completed ${monthVideos} videos this month</h3><p>Only successful runs count toward your monthly limit.</p></article>
    <article class="insight-card"><h3>Most used feature</h3><p>${mostUsed}</p></article>
    <article class="insight-card"><h3>You saved ${savedCount} outputs</h3><p>${savedCount ? 'Reuse and export them anytime.' : 'Start with your first transcript.'}</p></article>
    <article class="insight-card"><h3>Last activity</h3><p>${(activityFeedCache.length || historyCache.length) ? `${getLastActivityLabel()} · ${monthActivities} this month` : 'Start with your first transcript.'}</p></article>
  `;
}

function getUpgradeBannerState() {
  if (!currentSession || !subscriptionInfo) return { kind: 'none' };
  if (offersResolvedState?.selectedOffer) return { kind: 'offer_priority' };

  const plan = String(subscriptionInfo.plan || 'free').toLowerCase();
  const credits = creditsFromSubscription(subscriptionInfo);
  const monthlyLimit = credits.limit;
  const monthlyMinutes = credits.used;
  const cycleEnd = subscriptionInfo.creditsSnapshot?.cycleEnd || subscriptionInfo.subscription?.endDate;
  if (!monthlyLimit || monthlyLimit <= 0) return { kind: 'none' };

  if (monthlyMinutes >= monthlyLimit && !isTopTierPlanKey(plan)) {
    return {
      kind: 'quota_exhausted',
      plan,
      limit: monthlyLimit,
      used: monthlyMinutes,
      nextResetLabel: cycleEnd ? formatDateTime(cycleEnd) : 'your next billing date'
    };
  }

  const ratio = monthlyMinutes / monthlyLimit;
  const pct = Math.min(999, Math.max(0, Math.round(ratio * 100)));

  if (ratio < 0.75) {
    return { kind: 'none' };
  }

  const severity = ratio >= 0.9 ? 'strong' : 'soft';
  const nextPlanLabel = plan === 'free' ? 'Starter' : plan === 'starter' ? 'Pro' : plan === 'pro' ? 'Business' : null;
  if (!nextPlanLabel) return { kind: 'none' };

  const messageBySeverity = {
    soft: `You’ve used about ${pct}% of your included videos for this month.`,
    strong: `You’re almost at your monthly video limit (${pct}% used).`
  };
  const ctaByPlan = {
    free: 'View plans',
    starter: 'View plans',
    pro: 'View plans'
  };
  return {
    kind: 'upgrade',
    severity,
    message: `${messageBySeverity[severity]} When you need more, ${ctaByPlan[plan].toLowerCase()} for the next tier.`,
    cta: ctaByPlan[plan]
  };
}

function renderUpgradeWarning() {
  const target = document.getElementById('upgradeWarning');
  if (!target) return;
  const state = getUpgradeBannerState();
  if (state.kind === 'quota_exhausted') {
    const freeWord = state.plan === 'free' ? 'free ' : '';
    target.innerHTML = `
      <div class="cutup-quota-upgrade-hint" role="region" aria-label="Monthly video limit">
        <p class="cutup-quota-upgrade-hint__title">You’ve used all ${state.limit} ${freeWord}videos this month.</p>
        <p class="cutup-quota-upgrade-hint__reset">Your included videos reset on <strong>${escapeHtml(state.nextResetLabel)}</strong>.</p>
        <p class="cutup-quota-upgrade-hint__benefits">Upgrade when you need a higher monthly limit, full exports, and faster turnaround—your workflow stays the same.</p>
        <button type="button" class="plan-btn" id="upgradeWarningBtn">${state.plan === 'free' ? 'See upgrade options' : 'View plans'}</button>
      </div>
    `;
    document.getElementById('upgradeWarningBtn')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-section="subscription"]')?.click();
      setTimeout(() => openDashboardPricingMatrix(), 80);
    });
    return;
  }
  if (state.kind !== 'upgrade') {
    target.innerHTML = '';
    return;
  }
  const cls =
    state.severity === 'soft' ? 'upgrade-warning upgrade-warning--neutral' : 'upgrade-warning upgrade-warning--strong';
  target.innerHTML = `
    <div class="${cls}">
      <div>${escapeHtml(state.message)}</div>
      <button type="button" class="plan-btn" id="upgradeWarningBtn">${escapeHtml(state.cta)}</button>
    </div>
  `;
  document.getElementById('upgradeWarningBtn')?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-section="subscription"]')?.click();
    setTimeout(() => openDashboardPricingMatrix(), 80);
  });
}

function renderUsageSection() {
  if (window.__ONBOARDING_ACTIVE__) return;
  const target = document.getElementById('usageDetails');
  if (!target || !subscriptionInfo) return;
  const credits = creditsFromSubscription(subscriptionInfo);
  const lifetime = lifetimeFromSubscription(subscriptionInfo);
  const pct = credits.limit > 0 ? Math.min(100, Math.round((credits.used / credits.limit) * 100)) : 0;

  target.innerHTML = `
    <div class="dash-usage-analytics">
      <section class="dash-usage-block">
        <h3 class="dash-usage-block__title">This billing cycle</h3>
        <div class="dash-usage-metrics">
          <div class="dash-usage-metric"><strong>${credits.used}</strong><span>Credits used</span></div>
          <div class="dash-usage-metric dash-usage-metric--accent"><strong>${credits.remaining}</strong><span>Credits remaining</span></div>
          <div class="dash-usage-metric"><strong>${credits.limit}</strong><span>Monthly limit</span></div>
        </div>
        <div class="dash-usage-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="dash-usage-progress__fill" style="width:${pct}%"></div>
        </div>
      </section>
      <section class="dash-usage-block">
        <h3 class="dash-usage-block__title">Lifetime</h3>
        <div class="dash-usage-metrics dash-usage-metrics--3">
          <div class="dash-usage-metric"><strong>${lifetime.outputs}</strong><span>Lifetime outputs</span></div>
          <div class="dash-usage-metric"><strong>${lifetime.mp4Exports}</strong><span>Lifetime MP4 exports</span></div>
          <div class="dash-usage-metric"><strong>${lifetime.processingJobs}</strong><span>Processing jobs</span></div>
        </div>
      </section>
      <section class="dash-usage-block">
        <h3 class="dash-usage-block__title">Outputs this cycle</h3>
        <div class="dash-usage-metrics dash-usage-metrics--3">
          <div class="dash-usage-metric"><strong>${credits.used}</strong><span>Generated this cycle</span></div>
          <div class="dash-usage-metric"><strong>${getLibraryStatsFromState().dbTotal ?? getLibraryStatsFromState().total ?? lifetime.outputs}</strong><span>Total in library</span></div>
          <div class="dash-usage-metric"><strong>${getRecentLibraryOutputs(1)[0] ? formatDateTime(getRecentLibraryOutputs(1)[0].createdAt) : '—'}</strong><span>Most recent</span></div>
        </div>
        <p style="margin:12px 0 0"><button type="button" class="lib-widget__link" id="usageOpenLibraryBtn">Open Content Library →</button></p>
      </section>
      <section class="dash-usage-block">
        <h3 class="dash-usage-block__title">Recent Processing Activity</h3>
        <div id="usageActivityFeed" class="af-host"></div>
      </section>
    </div>
  `;
  document.getElementById('usageOpenLibraryBtn')?.addEventListener('click', () => navigateToContentLibrary());
  const usageFeed = document.getElementById('usageActivityFeed');
  if (usageFeed && window.CutupActivityFeed?.renderTimeline) {
    window.CutupActivityFeed.renderTimeline(usageFeed, activityFeedCache, {
      limit: 10,
      category: 'processing',
      emptyMessage: 'Your processing activity will appear here after your first video.'
    });
  }
}

function renderSavedOutputs() {
  if (window.__ONBOARDING_ACTIVE__) return;
  const target = document.getElementById('savedOutputs');
  if (window.CutupSavedOutputsLibrary?.render) {
    const st = window.CutupSavedOutputsLibrary.getState?.();
    if (st && st.loaded && !st.loading) {
      window.CutupSavedOutputsLibrary.render(getSavedOutputsLibraryCtx());
      savedOutputsCache = st.items || [];
      return;
    }
    if (target && !st?.loading) {
      target.innerHTML = '<div class="sol-root"><p class="dashboard-muted-loading">Loading your library…</p></div>';
    }
    void window.CutupSavedOutputsLibrary.reload(getSavedOutputsLibraryCtx());
    return;
  }
  if (!target) return;
  target.innerHTML = '<div class="sol-empty"><h3>Content library unavailable</h3><p>Please refresh the page.</p></div>';
}

function renderPlansSection() {
  if (window.__ONBOARDING_ACTIVE__) return;
  const subscriptionInfoEl = document.getElementById('subscriptionInfo');
  if (!subscriptionInfoEl || !subscriptionInfo) return;

  const planKey = String(subscriptionInfo.plan || 'free').toLowerCase();
  const credits = creditsFromSubscription(subscriptionInfo);
  const planName = window.CutupPlanPermissions?.displayPlanName
    ? window.CutupPlanPermissions.displayPlanName(planKey)
    : displayPlanTitle(subscriptionInfo.plan, subscriptionInfo.planName);
  const renewalCountdown = formatRenewalCountdown(subscriptionInfo.subscription?.endDate);
  const cycleEnd = subscriptionInfo.creditsSnapshot?.cycleEnd || subscriptionInfo.subscription?.endDate;
  const renewalLabel = renewalCountdown
    || (cycleEnd ? formatDateTime(cycleEnd) : '—');
  const pct = credits.limit > 0 ? Math.min(100, Math.round((credits.used / credits.limit) * 100)) : 0;
  const libTotal = getLibraryStatsFromState().dbTotal ?? getLibraryStatsFromState().total ?? 0;

  subscriptionInfoEl.innerHTML = `
    <div class="dash-plans">
      <div class="dash-plans-kpi-grid">
        <article class="dash-plans-kpi">
          <span class="dash-plans-kpi__label">Current plan</span>
          <strong class="dash-plans-kpi__value">${escapeHtml(planName)}</strong>
        </article>
        <article class="dash-plans-kpi dash-plans-kpi--accent">
          <span class="dash-plans-kpi__label">Credits remaining</span>
          <strong class="dash-plans-kpi__value">${credits.remaining}</strong>
        </article>
        <article class="dash-plans-kpi">
          <span class="dash-plans-kpi__label">Monthly limit</span>
          <strong class="dash-plans-kpi__value">${credits.limit}</strong>
        </article>
        <article class="dash-plans-kpi">
          <span class="dash-plans-kpi__label">Next renewal</span>
          <strong class="dash-plans-kpi__value dash-plans-kpi__value--sm">${escapeHtml(renewalLabel)}</strong>
        </article>
      </div>

      <section class="dash-plans-usage">
        <div class="dash-plans-usage__head">
          <h2 class="dash-plans-section-title">Usage this cycle</h2>
          <span class="dash-plans-usage__plan">${escapeHtml(planName)}</span>
        </div>
        <div class="dash-plans-usage__stats">
          <span><strong>${credits.remaining}</strong> remaining</span>
          <span><strong>${credits.used}</strong> used</span>
          <span><strong>${credits.limit}</strong> monthly limit</span>
        </div>
        <div class="dash-plans-usage__bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="dash-plans-usage__fill" style="width:${pct}%"></div>
        </div>
        <p style="margin:14px 0 0"><button type="button" class="lib-widget__link" id="plansOpenLibraryBtn">View your content library (${libTotal} outputs) →</button></p>
      </section>

      <section class="dash-plans-matrix">
        <h2 class="dash-plans-section-title">Available plans</h2>
        <div id="dashPlansMatrixRoot"></div>
      </section>
    </div>
  `;

  const paywallEl = document.getElementById('cutupDashboardPricingPaywall');
  if (paywallEl) {
    paywallEl.hidden = true;
    paywallEl.innerHTML = '';
  }

  document.getElementById('plansOpenLibraryBtn')?.addEventListener('click', () => navigateToContentLibrary());

  if (window.CutupPricingMatrix?.mount) {
    window.CutupPricingMatrix.mount('#dashPlansMatrixRoot', {
      context: 'dashboard',
      currentPlan: planKey,
      onUpgrade: (plan) => dashboardCheckoutForPlan(plan)
    });
  }

  if (dashboardHighlightPlan) {
    const hl = dashboardHighlightPlan;
    dashboardHighlightPlan = null;
    requestAnimationFrame(() => {
      const root = document.getElementById('dashPlansMatrixRoot');
      const cell = root?.querySelector(`[data-cutup-plan="${CSS.escape(hl)}"]`)?.closest('td')
        || root?.querySelector(`[data-cutup-plan-exports="${CSS.escape(hl)}"]`);
      cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }
}

function renderBillingSection() {
  if (window.__ONBOARDING_ACTIVE__) return;
  const target = document.getElementById('financialInfo');
  if (!target) return;

  if (window.CutupBillingDashboard?.renderBillingCenter || window.CutupBillingDashboard?.render) {
    const renderFn = window.CutupBillingDashboard.renderBillingCenter || window.CutupBillingDashboard.render;
    renderFn({
      target,
      data: billingDashboardCache,
      loadState: billingDashboardLoadState,
      loadError: billingDashboardLoadError,
      subscriptionInfo,
      activityFeed: activityFeedCache,
      libraryStats: getLibraryStatsFromState(),
      libraryCycleOutputs: creditsFromSubscription(subscriptionInfo).used,
      onOpenLibrary: navigateToContentLibrary,
      session: currentSession,
      apiBase: API_BASE_URL,
      apiPost,
      showBanner: showDashboardBanner,
      onRetryLoad: async () => {
        billingDashboardLoadState = 'loading';
        renderBillingSection();
        await ensureBillingSectionReady({ forceReload: true });
      },
      onUpgrade: (planKey) => {
        if (planKey && typeof dashboardCheckoutForPlan === 'function') {
          dashboardCheckoutForPlan(planKey);
        } else {
          openDashboardPricingMatrix(planKey);
        }
      },
      onRetryPayment: async () => {
        const { response, data } = await apiPost(`${API_BASE_URL}/api/payment/retry`, {}, {
          headers: { 'X-Session-Id': currentSession }
        });
        if (!response.ok || !data?.redirect_url) {
          showDashboardBanner('Please try again in a moment.', 'error');
          return;
        }
        window.location.href = data.redirect_url;
      }
    });
    return;
  }

  const subscriptionEnd = subscriptionInfo?.subscription?.endDate ? formatDateTime(subscriptionInfo.subscription.endDate) : '—';
  const paymentReady = plansCache.some((p) => Number(p?.priceEur?.monthly ?? p?.priceUsd?.monthly) > 0);
  const paymentStatus = subscriptionInfo?.plan === 'free' ? 'No active paid subscription' : 'Active';
  target.innerHTML = `
    <div class="usage-summary">
      <h3>Billing state</h3>
      <p><strong>Plan:</strong> ${displayPlanTitle(subscriptionInfo?.plan, subscriptionInfo?.planName)}</p>
      <p><strong>Billing period:</strong> ${safeText(subscriptionInfo?.subscription?.billingPeriod, 'monthly')}</p>
      <p><strong>Renewal / expiry:</strong> ${subscriptionEnd}</p>
      <p><strong>Payment status:</strong> ${paymentStatus}</p>
      ${paymentReady
        ? '<p class="dashboard-muted-loading">Use the Plans section to change your plan.</p>'
        : '<p class="dashboard-empty-note">Payments are not available yet.</p>'}
    </div>
  `;
}

async function startPaymentCheckout(planKey, provider = 'yekpay') {
  try {
    let discount = null;
    try {
      if (typeof getHotDiscountCodeForCheckout === 'function') {
        discount = getHotDiscountCodeForCheckout({ subscriptionInfo });
      }
    } catch (_e) {
      discount = null;
    }
    const body = { plan: planKey, planKey, provider, ...(discount ? { discount } : {}) };
    const { response, data } = await apiPost(`${API_BASE_URL}/api/payment/create`, body, {
      headers: { 'X-Session-Id': currentSession },
    });
    if (data?.error === 'profile_incomplete') {
      showDashboardBanner('Complete your profile before upgrading.', 'error');
      navigateDashboardSection('profile');
      return;
    }
    if (data?.error === 'Payment provider not configured') {
      showDashboardBanner('Payment provider not configured.', 'error');
      return;
    }
    const redirect = data.redirect_url || data.payment_url || data.url;
    if (response.ok && redirect) {
      if (typeof sendAnalyticsEvent === 'function') {
        sendAnalyticsEvent('payment_started', { plan: planKey, sessionId: currentSession });
      }
      if (typeof window.trackEvent === 'function') {
        window.trackEvent('payment_attempt', { plan: planKey, provider }, 'business');
      }
      if (discount && typeof window.cutupPaywallDiscountUsed === 'function') {
        window.cutupPaywallDiscountUsed(planKey);
      }
      rememberPaymentRetryContext(planKey, provider);
      window.location.href = redirect;
      return;
    }
    showDashboardBanner('Payments are not available yet.', 'neutral');
  } catch (_e) {
    showDashboardBanner('Could not start payment right now. Please try again.', 'error');
  }
}

async function startStripeCheckout(planKey) {
  return startPaymentCheckout(planKey, 'yekpay');
}

async function startYekpayCheckout(planKey) {
  return startPaymentCheckout(planKey, 'yekpay');
}

async function refreshDashboardData({ silent = false } = {}) {
  try {
    invalidateDashboardUserProfileCache();
    await loadDashboardHeavy({ silent });
  } catch (e) {
    if (e.message === 'auth_failed') {
      localStorage.removeItem('cutup_session');
      window.location.href = '/';
      return;
    }
    showDashboardLevelError('Could not load dashboard data right now. Please refresh in a moment.');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  ensureDashboardRuntimeMarkup();
  const init = await initDashboard();
  if (!init.ok) return;
  const { paymentReturn } = init;

  const pr = paymentReturn;
  if (pr.result === 'return') {
    if (pr.paymentId && pr.authority) {
      showDashboardBanner('Verifying your payment...', 'info', { spinner: true, persistent: true });
      try {
        const { response, data } = await apiPost(
          `${API_BASE_URL}/api/payment/verify`,
          {
            payment_id: pr.paymentId,
            provider_reference: pr.authority,
            provider: 'yekpay'
          },
          { headers: { 'X-Session-Id': currentSession } }
        );
        await refreshDashboardData({ silent: true });
        if (response.ok && (data.success === true || data.status === 'success')) {
          emitPaymentSuccessAnalytics();
          showDashboardBanner('Payment successful. Your plan is now active.', 'success');
        } else if (data.status === 'expired') {
          emitPaymentFailedAnalytics();
          showPaymentFailedWithRetry(getPaywallFailureMessage());
        } else {
          emitPaymentFailedAnalytics();
          showPaymentFailedWithRetry(getPaywallFailureMessage());
          console.log('[payment] failed', data);
        }
      } catch (e) {
        await refreshDashboardData({ silent: true });
        emitPaymentFailedAnalytics();
        showPaymentFailedWithRetry(getPaywallFailureMessage());
        console.log('[payment] failed', e);
      }
    } else {
      emitPaymentFailedAnalytics();
      showPaymentFailedWithRetry(getPaywallFailureMessage());
    }
  } else if (pr.result === 'success' && pr.paymentId && pr.checkoutSessionId) {
    showDashboardBanner('Processing payment', 'info');
    try {
      const { response, data } = await apiPost(
        `${API_BASE_URL}/api/payment/verify`,
        { payment_id: pr.paymentId, provider_reference: pr.checkoutSessionId },
        { headers: { 'X-Session-Id': currentSession } }
      );
      await refreshDashboardData({ silent: true });
      if (response.ok && (data.success === true || data.status === 'success')) {
        emitPaymentSuccessAnalytics();
        showDashboardBanner('Payment successful', 'success');
      } else if (data.status === 'pending') {
        showDashboardBanner('Processing payment', 'neutral');
      } else if (data.status === 'expired') {
        emitPaymentFailedAnalytics();
        showPaymentFailedWithRetry(getPaywallFailureMessage());
      } else {
        emitPaymentFailedAnalytics();
        showPaymentFailedWithRetry(getPaywallFailureMessage());
        console.log('[payment] failed', data);
      }
    } catch (e) {
      await refreshDashboardData({ silent: true });
      emitPaymentFailedAnalytics();
      showPaymentFailedWithRetry(getPaywallFailureMessage());
      console.log('[payment] failed', e);
    }
  } else if (pr.result === 'success') {
    clearPaymentRetryContext();
    showDashboardBanner('Payment successful', 'success');
  } else if (pr.result === 'failed') {
    emitPaymentFailedAnalytics();
    showPaymentFailedWithRetry(getPaywallFailureMessage());
  } else if (pr.result === 'cancel') {
    showPaymentFailedWithRetry('Checkout was cancelled. No charge was made.', 'neutral');
  } else if (pr.result === 'pending') {
    showDashboardBanner('Processing payment', 'neutral');
  }

  // Stabilization: dashboard offer messaging is now driven by real offer data.

  setInterval(() => {
    refreshDashboardData({ silent: true });
  }, 30000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDashboardData({ silent: true });
  });
  window.addEventListener('focus', () => {
    refreshDashboardData({ silent: true });
  });
});
