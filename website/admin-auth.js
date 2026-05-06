/**
 * Admin session guard — inactivity timeout, heartbeat, sensitive state cleanup.
 */
window.CutupAdminAuth = (function () {
  const IDLE_MS = 15 * 60 * 1000;
  const HEARTBEAT_MS = 60 * 1000;
  const SESSION_TAB_KEY = 'cutup_adminha_tab_active';

  let idleTimer = null;
  let heartbeatTimer = null;
  let started = false;
  let expiryModalEl = null;
  let heartbeatFailures = 0;

  function apiBase() {
    const b = typeof window !== 'undefined' && window.CUTUP_API_BASE;
    if (typeof b !== 'string') return '';
    return b.replace(/\/$/, '');
  }

  function apiUrl(path) {
    const p = path.charAt(0) === '/' ? path : `/${path}`;
    const base = apiBase();
    return base ? `${base}${p}` : p;
  }

  function showToast(message) {
    if (typeof window.showBanner === 'function') {
      window.showBanner(message);
      return;
    }
    console.warn('[Admin Auth]', message);
  }

  function hasTabSession() {
    try {
      return Boolean(sessionStorage.getItem(SESSION_TAB_KEY));
    } catch {
      return false;
    }
  }

  function clearTabSession() {
    try {
      sessionStorage.removeItem(SESSION_TAB_KEY);
    } catch {
      /* ignore */
    }
  }

  function clearSensitiveAdminState() {
    clearTabSession();
    try {
      sessionStorage.removeItem('cutup_admin_sidebar');
      sessionStorage.removeItem('cutup_cms_nav_sidebar');
      sessionStorage.removeItem('cutup_users_nav_sidebar');
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('cutup_adminha_signed_in');
    } catch {
      /* ignore */
    }
    window.CutupAdminFilterState?.clearAdminFilterStates?.();
    try {
      window.CutupContentEditor?.destroyCurrentEditor?.();
    } catch {
      /* ignore */
    }
    window.CutupContentStudio?.destroyAll?.();
    window.CutupAdminSidebar?.collapseAllRoots?.();
  }

  function ensureExpiryModal() {
    if (expiryModalEl) return expiryModalEl;
    const el = document.createElement('div');
    el.id = 'adminSessionExpiryModal';
    el.className = 'cms-leave-modal';
    el.hidden = true;
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="cms-leave-modal-backdrop"></div>
      <div class="cms-leave-modal-card">
        <h3>Session expired</h3>
        <p id="adminSessionExpiryMsg">Your admin session expired due to inactivity.</p>
        <div class="cms-leave-modal-actions">
          <button type="button" class="btn" id="adminSessionExpiryOk">Continue to login</button>
        </div>
      </div>`;
    document.body.append(el);
    el.querySelector('#adminSessionExpiryOk')?.addEventListener('click', () => {
      el.hidden = true;
      redirectToLogin('inactivity');
    });
    expiryModalEl = el;
    return el;
  }

  function showExpiryModal(message) {
    const el = ensureExpiryModal();
    const msg = el.querySelector('#adminSessionExpiryMsg');
    if (msg) msg.textContent = message;
    el.hidden = false;
  }

  function redirectToLogin(reason) {
    stop();
    clearSensitiveAdminState();
    if (typeof window.cutupAdminSessionClear === 'function') {
      window.cutupAdminSessionClear();
    }
    const q = reason === 'inactivity' ? '?session_expired=1' : '?signed_out=1';
    const url = `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, 'adminha.html')}${q}`;
    const target = /adminha\.html/i.test(window.location.pathname || '')
      ? window.location.pathname + q
      : '/adminha.html' + q;
    if (window.self !== window.top) window.top.location.replace(target);
    else window.location.replace(target);
  }

  async function forceLogout(opts = {}) {
    const reason = opts.reason || 'inactivity';
    const hadDirty =
      opts.unsaved === true || (window.CutupContentEditor?.isDirty?.() && window.CutupContentEditor?.isActive?.());

    try {
      await fetch(apiUrl('/api/admin/logout'), { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }

    if (hadDirty) {
      showExpiryModal(
        'Your session expired. Unsaved changes could not be saved securely.'
      );
      return;
    }

    if (reason === 'inactivity') {
      showToast('Your admin session expired due to inactivity.');
    }
    redirectToLogin(reason);
  }

  function resetIdleTimer() {
    if (!started) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void forceLogout({ reason: 'inactivity', unsaved: window.CutupContentEditor?.isDirty?.() });
    }, IDLE_MS);
  }

  async function heartbeat() {
    if (!started) return;
    if (!hasTabSession()) return;
    try {
      const r = await fetch(apiUrl('/api/admin/auth/me'), { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        heartbeatFailures += 1;
        if (heartbeatFailures >= 2) {
          showToast('Your admin session is no longer valid.');
          await forceLogout({ reason: 'invalid' });
        }
        return;
      }
      heartbeatFailures = 0;
    } catch {
      heartbeatFailures += 1;
    }
  }

  /** After login or page refresh in the same tab — cookie valid + tab marker present. */
  async function acceptAuthenticatedSession(mePayload) {
    markTabSession();
    if (mePayload && typeof window !== 'undefined') {
      window.__CUTUP_ADMIN_ME__ = mePayload;
    }
    return true;
  }

  /**
   * Bootstrap: refresh keeps session if tab marker exists; new tab without marker logs out.
   */
  async function bootstrapFromCookie() {
    const hadTab = hasTabSession();
    try {
      const r = await fetch(apiUrl('/api/admin/auth/me'), { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        clearTabSession();
        return { ok: false };
      }
      if (!hadTab) {
        try {
          await fetch(apiUrl('/api/admin/logout'), { method: 'POST', credentials: 'include' });
        } catch {
          /* ignore */
        }
        clearTabSession();
        return { ok: false, staleCookie: true };
      }
      markTabSession();
      window.__CUTUP_ADMIN_ME__ = {
        ok: true,
        email: data.email,
        role: data.role,
        adminId: data.adminId
      };
      return { ok: true };
    } catch {
      if (!hadTab) clearTabSession();
      return { ok: false };
    }
  }

  function onActivity() {
    resetIdleTimer();
  }

  function start() {
    if (started) return;
    started = true;
    try {
      sessionStorage.setItem(SESSION_TAB_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    const events = ['click', 'mousemove', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => document.addEventListener(ev, onActivity, { passive: true }));
    resetIdleTimer();
    heartbeat();
    heartbeatTimer = setInterval(() => {
      void heartbeat();
    }, HEARTBEAT_MS);
  }

  function stop() {
    started = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function markTabSession() {
    try {
      sessionStorage.setItem(SESSION_TAB_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  return {
    start,
    stop,
    resetIdleTimer,
    clearSensitiveAdminState,
    clearTabSession,
    forceLogout,
    markTabSession,
    hasTabSession,
    acceptAuthenticatedSession,
    bootstrapFromCookie,
    SESSION_TAB_KEY,
    IDLE_MS,
    HEARTBEAT_MS
  };
})();
