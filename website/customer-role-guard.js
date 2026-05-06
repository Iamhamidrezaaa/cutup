/**
 * Customer vs platform-admin identity guards (shared homepage + dashboard).
 */
(function () {
  const HOMEPAGE_FALLBACK = 'https://cutup.shop/';
  const ADMIN_CONSOLE_URL = '/adminha.html';

  function homepageUrl() {
    if (typeof window === 'undefined' || !window.location?.origin) return HOMEPAGE_FALLBACK;
    return `${window.location.origin}/`;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isPlatformAdminRole(role) {
    const r = String(role || '').toLowerCase();
    return Boolean(r && r !== 'customer');
  }

  function ensureOverlay() {
    let el = document.getElementById('cutupAdminAccountModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'cutupAdminAccountModal';
    el.className = 'crg-overlay';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = [
      '<div class="crg-card">',
      '  <div class="crg-icon" aria-hidden="true">🛡️</div>',
      '  <h2 id="cutupAdminAccountModalTitle">Administrator account</h2>',
      '  <p id="cutupAdminAccountModalBody"></p>',
      '  <div class="crg-actions">',
      `    <a class="crg-btn crg-btn--primary" id="cutupAdminAccountModalConsole" href="${ADMIN_CONSOLE_URL}">Open Operations Console</a>`,
      '    <button type="button" class="crg-btn crg-btn--ghost" id="cutupAdminAccountModalDismiss">Continue browsing</button>',
      '  </div>',
      '</div>'
    ].join('\n');
    document.body.appendChild(el);
    el.querySelector('#cutupAdminAccountModalDismiss')?.addEventListener('click', () => {
      el.hidden = true;
    });
    el.addEventListener('click', (ev) => {
      if (ev.target === el) el.hidden = true;
    });
    return el;
  }

  function showAdminLoginBlockedModal() {
    const overlay = ensureOverlay();
    const body = document.getElementById('cutupAdminAccountModalBody');
    if (body) {
      body.textContent =
        "You're signing in with an administrator account. Admin accounts can only access the Operations Console. Please use a separate customer account for the product.";
    }
    overlay.hidden = false;
  }

  function clearCustomerSession() {
    try {
      localStorage.removeItem('cutup_session');
    } catch (_e) {}
    if (typeof window.clearCutupSession === 'function') {
      window.clearCutupSession('admin_role_guard');
    }
    if (window.CutupApp) window.CutupApp.authState = 'anonymous';
  }

  function renderDashboardAdminNotice(root) {
    const host = root || document.body;
    const shell = document.getElementById('cutupDashboardShell');
    if (shell) shell.hidden = true;
    const loader = document.getElementById('initialLoader');
    if (loader) loader.hidden = true;

    let page = document.getElementById('cutupAdminDashboardGuard');
    if (!page) {
      page = document.createElement('div');
      page.id = 'cutupAdminDashboardGuard';
      page.className = 'crg-fullpage';
      host.appendChild(page);
    }
    page.innerHTML = `
      <div class="crg-card">
        <div class="crg-icon" aria-hidden="true">🛡️</div>
        <h2>Administrator workspace</h2>
        <p>Administrator accounts use a separate workspace. You'll be redirected to the main website shortly.</p>
        <div class="crg-actions">
          <a class="crg-btn crg-btn--primary" href="${esc(homepageUrl())}">Go to homepage now</a>
          <a class="crg-btn crg-btn--ghost" href="${esc(ADMIN_CONSOLE_URL)}">Operations Console</a>
        </div>
        <p class="crg-countdown" id="cutupAdminRedirectCountdown" aria-live="polite">Redirecting in 4s…</p>
      </div>`;
    let sec = 4;
    const cd = document.getElementById('cutupAdminRedirectCountdown');
    const tick = () => {
      sec -= 1;
      if (cd) cd.textContent = sec > 0 ? `Redirecting in ${sec}s…` : 'Redirecting…';
      if (sec <= 0) {
        window.location.replace(homepageUrl());
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  function handleAuthMePayload(data) {
    if (!data || !isPlatformAdminRole(data.platformRole)) return false;
    clearCustomerSession();
    return true;
  }

  function handleUrlAdminLoginError() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('error') !== 'admin_account') return false;
      params.delete('error');
      params.delete('session');
      const qs = params.toString();
      window.history.replaceState({}, document.title, `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      showAdminLoginBlockedModal();
      return true;
    } catch {
      return false;
    }
  }

  function isAdminUser(platformRole) {
    return isPlatformAdminRole(platformRole);
  }

  function isCustomerUser(platformRole) {
    return !isPlatformAdminRole(platformRole);
  }

  function requiresCustomerRole(platformRole) {
    return isCustomerUser(platformRole);
  }

  function isAdminRoute(pathname) {
    const p = String(pathname || (typeof window !== 'undefined' ? window.location.pathname : '')).toLowerCase();
    return p.includes('adminha') || p.includes('admin-forgot') || p.includes('admin-reset');
  }

  function isCustomerRoute(pathname) {
    const p = String(pathname || (typeof window !== 'undefined' ? window.location.pathname : '')).toLowerCase();
    if (isAdminRoute(p)) return false;
    return p.includes('dashboard') || p.includes('checkout');
  }

  window.CutupRoleGuard = {
    isPlatformAdminRole,
    isAdminUser,
    isCustomerUser,
    requiresCustomerRole,
    isAdminRoute,
    isCustomerRoute,
    showAdminLoginBlockedModal,
    clearCustomerSession,
    renderDashboardAdminNotice,
    handleAuthMePayload,
    handleUrlAdminLoginError,
    homepageUrl
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => handleUrlAdminLoginError());
  } else {
    handleUrlAdminLoginError();
  }
})();
