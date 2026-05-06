/**
 * Users hub — inline accordion + URL routing (?section=users&view=admins|customers).
 * Same architecture as Content Studio (admin-cms-nav.js).
 */
window.CutupUsersNav = (function () {
  const USERS_SECTION = 'users';
  const VIEWS = new Set(['admins', 'customers']);

  const ICON_USERS =
    '<svg class="cms-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  const SB = () => window.CutupAdminSidebar;

  let current = { view: null };
  let refreshSectionFn = null;
  let runEditorLeaveGuardFn = null;

  function parseRoute() {
    const q = new URLSearchParams(window.location.search);
    const section = (q.get('section') || '').trim().toLowerCase();
    const view = (q.get('view') || '').trim().toLowerCase();
    if (section !== USERS_SECTION) return { section: null, view: null };
    if (!VIEWS.has(view)) return { section: USERS_SECTION, view: 'customers' };
    return { section: USERS_SECTION, view };
  }

  function setRoute(view, { replace = true } = {}) {
    const url = new URL(window.location.href);
    [...url.searchParams.keys()].forEach((k) => url.searchParams.delete(k));
    if (view && VIEWS.has(view)) {
      url.searchParams.set('section', USERS_SECTION);
      url.searchParams.set('view', view);
    }
    const state = { users: { view: view || null } };
    const href = url.pathname + (url.search ? url.search : '');
    if (replace) history.replaceState(state, '', href);
    else history.pushState(state, '', href);
  }

  function panelSectionForView(view) {
    return view === 'admins' ? 'administrators' : 'users';
  }

  function applySidebarState() {
    const s = SB()?.getState?.() || {};
    const hub = document.getElementById('navUsersHub');
    const hubTrigger = document.getElementById('navUsersHubTrigger');
    const hubPanel = document.getElementById('navUsersHubPanel');

    hub?.classList.toggle('cms-hub--open', Boolean(s.usersOpen));
    hubTrigger?.setAttribute('aria-expanded', s.usersOpen ? 'true' : 'false');
    if (hubPanel) hubPanel.setAttribute('aria-hidden', s.usersOpen ? 'false' : 'true');
  }

  function toggleUsersHub() {
    SB()?.toggleUsersRoot?.();
  }

  function expandUsersHub() {
    SB()?.openUsersRoot?.();
  }

  function collapseUsersHub() {
    SB()?.closeUsersRoot?.();
  }

  function syncActiveNav() {
    const hub = document.getElementById('navUsersHub');
    hub?.classList.remove('cms-hub--child-active');
    document.querySelectorAll('#navUsersHub .cms-nav-item').forEach((btn) => {
      const view = btn.dataset.usersView;
      const on = view === current.view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function activatePanel(view) {
    document.querySelectorAll('.nav-btn[data-section]').forEach((n) => {
      if (!n.closest('#navContentHub') && !n.closest('#navUsersHub')) n.classList.remove('active');
    });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    const panelId = view === 'admins' ? 'section-administrators' : 'section-users';
    document.getElementById(panelId)?.classList.add('active');
    syncActiveNav();
  }

  async function runLeaveGuard() {
    if (runEditorLeaveGuardFn) return runEditorLeaveGuardFn();
    if (!window.CutupContentEditor?.isActive?.()) return true;
    const leave = await window.CutupContentEditor.requestLeave();
    if (leave !== 'leave') return false;
    if (window.CutupContentEditor.destroyCurrentEditor) {
      window.CutupContentEditor.destroyCurrentEditor();
    } else {
      window.CutupContentEditor.destroy();
    }
    return true;
  }

  function isUsersRoute() {
    return VIEWS.has(current.view);
  }

  async function navigate(view, opts = {}) {
    const v = VIEWS.has(view) ? view : 'customers';
    if (!opts.skipGuard) {
      const ok = await runLeaveGuard();
      if (!ok) {
        if (current.view) setRoute(current.view, { replace: true });
        return;
      }
    } else if (window.CutupContentEditor?.isActive?.()) {
      window.CutupContentEditor.destroy?.();
    }

    window.CutupAdminAuditLog?.destroy?.();
    window.CutupContentStudio?.destroyAll?.();
    current = { view: v };
    setRoute(v, { replace: opts.replace !== false });
    expandUsersHub();
    activatePanel(v);
    if (typeof window.cutupAdminMobileNavClose === 'function') window.cutupAdminMobileNavClose();

    const panelSection = panelSectionForView(v);
    try {
      if (refreshSectionFn) await refreshSectionFn(panelSection);
    } catch (e) {
      const msg = e?.message || 'Could not load data.';
      if (typeof window.showBanner === 'function') window.showBanner(msg);
    }
    syncActiveNav();
  }

  function buildHub() {
    const hub = document.createElement('div');
    hub.className = 'cms-hub nav-group users-hub';
    hub.id = 'navUsersHub';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'nav-btn nav-group-head cms-hub-trigger';
    trigger.id = 'navUsersHubTrigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'navUsersHubPanel');
    trigger.innerHTML = `
      <span class="cms-hub-trigger-icon">${ICON_USERS}</span>
      <span class="nav-group-head-label">Users</span>
      <span class="cms-hub-chevron nav-flyout-chevron" aria-hidden="true"></span>`;

    const panel = document.createElement('div');
    panel.className = 'cms-hub-panel';
    panel.id = 'navUsersHubPanel';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Users');

    const list = document.createElement('div');
    list.className = 'cms-subgroup-items cms-users-items';

    [
      { view: 'admins', label: 'Administrators', ariaLabel: 'Administrators' },
      { view: 'customers', label: 'Customers', ariaLabel: 'Customers' }
    ].forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cms-nav-item';
      btn.dataset.usersView = item.view;
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-label', item.ariaLabel);
      btn.textContent = item.label;
      list.append(btn);
    });

    panel.append(list);
    hub.append(trigger, panel);

    trigger.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleUsersHub();
    });

    trigger.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggleUsersHub();
      }
    });

    list.querySelectorAll('.cms-nav-item').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const view = btn.dataset.usersView;
        await navigate(view, { replace: false });
      });
    });

    return hub;
  }

  function init(opts = {}) {
    refreshSectionFn = opts.refreshSection || null;
    runEditorLeaveGuardFn = opts.runEditorLeaveGuard || null;

    const mountEl = document.getElementById('navUsersHubMount');
    if (!mountEl) return;

    SB()?.initOnce?.();
    SB()?.registerApply?.('users', applySidebarState);

    mountEl.innerHTML = '';
    mountEl.append(buildHub());
    applySidebarState();

    window.addEventListener('popstate', async () => {
      const cmsRoute = window.CutupCmsNav?.parseRoute?.();
      if (cmsRoute?.section) return;

      const route = parseRoute();
      if (route.section === USERS_SECTION) {
        const ok = await runLeaveGuard();
        if (!ok) {
          if (current.view) setRoute(current.view, { replace: true });
          return;
        }
        await navigate(route.view, { replace: true, skipGuard: true });
        return;
      }
      current = { view: null };
    });

    const route = parseRoute();
    if (route.section === USERS_SECTION) {
      navigate(route.view, { replace: true, skipGuard: true });
    }
  }

  return {
    init,
    navigate,
    parseRoute,
    isUsersRoute,
    collapseUsersHub,
    expandUsersHub,
    getCurrent: () => ({ ...current }),
    getSidebarState: () => SB()?.getState?.() || {}
  };
})();

window.usersSidebarState = window.CutupAdminSidebar?.getState?.() || window.CutupUsersNav.getSidebarState();
