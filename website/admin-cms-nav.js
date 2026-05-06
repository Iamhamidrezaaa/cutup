/**
 * Content Studio — sidebar accordion + URL routing (?section=pages&view=all).
 */
window.CutupCmsNav = (function () {
  const CMS_SECTIONS = new Set(['pages', 'blog']);

  const ICON_PAGE =
    '<svg class="cms-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  const ICON_POST =
    '<svg class="cms-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const ICON_HUB =
    '<svg class="cms-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';

  const SB = () => window.CutupAdminSidebar;

  let mountEl = null;
  let current = { section: null, view: null };

  function parseRoute() {
    const q = new URLSearchParams(window.location.search);
    let section = (q.get('section') || '').trim().toLowerCase();
    const view = (q.get('view') || 'all').trim().toLowerCase() || 'all';
    if (section === 'content-pages') section = 'pages';
    if (section === 'content-blog') section = 'blog';
    if (!CMS_SECTIONS.has(section)) return { section: null, view: null };
    return { section, view };
  }

  function setRoute(section, view, opts = {}) {
    const replace = opts.replace !== false;
    const id = opts.id != null ? opts.id : null;
    const url = new URL(window.location.href);
    [...url.searchParams.keys()].forEach((k) => url.searchParams.delete(k));
    if (section && CMS_SECTIONS.has(section)) {
      url.searchParams.set('section', section);
      url.searchParams.set('view', view || 'all');
      if (id) url.searchParams.set('id', String(id));
    }
    const state = { cms: { section, view } };
    const href = url.pathname + (url.search ? url.search : '');
    if (replace) history.replaceState(state, '', href);
    else history.pushState(state, '', href);
  }

  function escAttr(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function applySidebarState() {
    const s = SB()?.getState?.() || {};
    const hub = document.getElementById('navContentHub');
    const hubTrigger = document.getElementById('navContentHubTrigger');
    const hubPanel = document.getElementById('navContentHubPanel');

    hub?.classList.toggle('cms-hub--open', Boolean(s.contentStudioOpen));
    hubTrigger?.setAttribute('aria-expanded', s.contentStudioOpen ? 'true' : 'false');
    if (hubPanel) hubPanel.setAttribute('aria-hidden', s.contentStudioOpen ? 'false' : 'true');

    ['pages', 'blog'].forEach((id) => {
      const open = id === 'pages' ? s.pagesOpen : s.blogOpen;
      const group = document.getElementById(`navCmsGroup_${id}`);
      const trigger = document.getElementById(`navCmsTrigger_${id}`);
      const panel = document.getElementById(`navCmsSub_${id}`);
      group?.classList.toggle('cms-subgroup--open', Boolean(open));
      trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (panel) panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
  }

  function toggleContentStudio() {
    SB()?.toggleContentStudioRoot?.();
  }

  function togglePagesSubgroup() {
    SB()?.togglePagesSubgroup?.();
  }

  function toggleBlogSubgroup() {
    SB()?.toggleBlogSubgroup?.();
  }

  function expandSubgroupForNav(section) {
    SB()?.expandCmsSubgroup?.(section);
  }

  function collapseContentStudio() {
    SB()?.collapseContentStudio?.();
  }

  function createSidebarGroup(config) {
    const groupId = config.id;
    const panelId = `navCmsSub_${groupId}`;
    const triggerId = `navCmsTrigger_${groupId}`;
    const icon = config.icon || '';

    const wrap = document.createElement('div');
    wrap.className = 'cms-subgroup';
    wrap.id = `navCmsGroup_${groupId}`;
    wrap.dataset.cmsGroup = groupId;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cms-subgroup-head';
    trigger.id = triggerId;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', panelId);
    trigger.innerHTML = `
      <span class="cms-subgroup-head-icon">${icon}</span>
      <span class="cms-subgroup-head-label">${escAttr(config.label)}</span>
      <span class="cms-subgroup-chevron" aria-hidden="true"></span>`;

    const panel = document.createElement('div');
    panel.className = 'cms-subgroup-panel';
    panel.id = panelId;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `${config.label} submenu`);
    panel.setAttribute('aria-hidden', 'true');

    const list = document.createElement('div');
    list.className = 'cms-subgroup-items';

    (config.items || []).forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cms-nav-item';
      btn.dataset.cmsSection = groupId;
      btn.dataset.cmsView = item.view;
      btn.setAttribute('role', 'menuitem');
      if (item.ariaLabel) btn.setAttribute('aria-label', item.ariaLabel);
      btn.textContent = item.label;
      list.append(btn);
    });

    panel.append(list);
    wrap.append(trigger, panel);

    trigger.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (groupId === 'pages') togglePagesSubgroup();
      else toggleBlogSubgroup();
    });

    return wrap;
  }

  function syncActiveNav() {
    document.querySelectorAll('.cms-nav-item').forEach((btn) => {
      const sec = btn.dataset.cmsSection;
      const view = btn.dataset.cmsView;
      const on = sec === current.section && view === current.view;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function activatePanel(section) {
    document.querySelectorAll('.nav-btn[data-section]').forEach((n) => {
      if (!n.closest('#navContentHub')) n.classList.remove('active');
    });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    if (CMS_SECTIONS.has(section)) {
      document.getElementById(`section-${section}`)?.classList.add('active');
    }
    syncActiveNav();
  }

  async function loadWorkspace(section, view) {
    if (section === 'pages' && window.CutupContentPages?.loadView) {
      return window.CutupContentPages.loadView(view || 'all');
    }
    if (section === 'blog' && window.CutupContentBlog?.loadView) {
      return window.CutupContentBlog.loadView(view || 'all');
    }
    return window.CutupContentStudio?.loadWorkspace?.(section, view);
  }

  async function runEditorLeaveGuard() {
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

  async function navigate(section, view, opts = {}) {
    const v = view || 'all';
    if (!CMS_SECTIONS.has(section)) return;

    if (!opts.skipGuard) {
      const ok = await runEditorLeaveGuard();
      if (!ok) {
        if (current.section) setRoute(current.section, current.view, { replace: true });
        return;
      }
    } else if (window.CutupContentEditor?.isActive?.()) {
      window.CutupContentEditor.destroy();
    }

    window.CutupAdminAuditLog?.destroy?.();
    if (window.CutupContentStudio?.destroyInactive) window.CutupContentStudio.destroyInactive(section);

    current = { section, view: v };
    setRoute(section, v, { replace: opts.replace !== false });

    expandSubgroupForNav(section);
    activatePanel(section);
    if (typeof window.cutupAdminMobileNavClose === 'function') window.cutupAdminMobileNavClose();

    try {
      await loadWorkspace(section, v);
    } catch (e) {
      const notify = window.CutupContentStudio?.notify;
      const msg = window.CutupContentStudio?.humanizeError?.(e) || e?.message || 'Could not load workspace.';
      if (notify) notify(msg, 'error');
      else if (typeof window.showBanner === 'function') window.showBanner(msg);
    }
    syncActiveNav();
  }

  async function navigateToList(section, view = 'all') {
    if (!CMS_SECTIONS.has(section)) return;
    const v = view || 'all';

    window.CutupAdminAuditLog?.destroy?.();

    if (window.CutupContentEditor?.destroyCurrentEditor) {
      window.CutupContentEditor.destroyCurrentEditor();
    } else {
      window.CutupContentEditor?.destroy?.();
    }

    if (section === 'pages') {
      window.CutupContentBlog?.destroy?.();
    } else {
      window.CutupContentPages?.destroy?.();
    }

    current = { section, view: v };
    setRoute(section, v, { replace: false });
    expandSubgroupForNav(section);
    activatePanel(section);
    if (typeof window.cutupAdminMobileNavClose === 'function') window.cutupAdminMobileNavClose();

    try {
      await loadWorkspace(section, v);
    } catch (e) {
      window.CutupContentStudio?.notify?.(window.CutupContentStudio.humanizeError(e), 'error');
    }
    syncActiveNav();
  }

  function buildHub() {
    const hub = document.createElement('div');
    hub.className = 'cms-hub nav-group';
    hub.id = 'navContentHub';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'nav-btn nav-group-head cms-hub-trigger';
    trigger.id = 'navContentHubTrigger';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'navContentHubPanel');
    trigger.innerHTML = `
      <span class="cms-hub-trigger-icon">${ICON_HUB}</span>
      <span class="nav-group-head-label">Content Studio</span>
      <span class="cms-hub-chevron nav-flyout-chevron" aria-hidden="true"></span>`;

    const panel = document.createElement('div');
    panel.className = 'cms-hub-panel';
    panel.id = 'navContentHubPanel';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Content Studio');

    const pagesGroup = createSidebarGroup({
      id: 'pages',
      label: 'Pages',
      icon: ICON_PAGE,
      items: [
        { view: 'all', label: 'All Pages', ariaLabel: 'All pages' },
        { view: 'add', label: 'Add Page', ariaLabel: 'Add new page' },
        { view: 'categories', label: 'Categories', ariaLabel: 'Page categories' },
        { view: 'tags', label: 'Tags', ariaLabel: 'Page tags' }
      ]
    });

    const blogGroup = createSidebarGroup({
      id: 'blog',
      label: 'Blog',
      icon: ICON_POST,
      items: [
        { view: 'all', label: 'All Posts', ariaLabel: 'All blog posts' },
        { view: 'add', label: 'Add Post', ariaLabel: 'Add new post' },
        { view: 'categories', label: 'Categories', ariaLabel: 'Post categories' },
        { view: 'tags', label: 'Tags', ariaLabel: 'Post tags' }
      ]
    });

    panel.append(pagesGroup, blogGroup);
    hub.append(trigger, panel);

    trigger.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleContentStudio();
    });

    trigger.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggleContentStudio();
      }
    });

    panel.querySelectorAll('.cms-nav-item').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const section = btn.dataset.cmsSection;
        const view = btn.dataset.cmsView;
        expandSubgroupForNav(section);
        await navigate(section, view, { replace: false });
      });
    });

    return hub;
  }

  function init() {
    mountEl = document.getElementById('navContentHubMount');
    if (!mountEl) return;

    SB()?.initOnce?.();
    SB()?.registerApply?.('cms', applySidebarState);

    mountEl.innerHTML = '';
    mountEl.append(buildHub());
    applySidebarState();

    window.addEventListener('popstate', async () => {
      const usersRoute = window.CutupUsersNav?.parseRoute?.();
      if (usersRoute?.section === 'users') return;

      const route = parseRoute();
      const ok = await runEditorLeaveGuard();
      if (!ok) {
        if (current.section) setRoute(current.section, current.view, { replace: true });
        return;
      }
      if (route.section) {
        await navigate(route.section, route.view, { replace: true, skipGuard: true });
      } else {
        current = { section: null, view: null };
      }
    });

    const route = parseRoute();
    if (route.section) {
      navigate(route.section, route.view, { replace: true, skipGuard: true });
    }
  }

  function isCmsSection(section) {
    return CMS_SECTIONS.has(String(section || '').toLowerCase());
  }

  return {
    init,
    navigate,
    navigateToList,
    parseRoute,
    isCmsSection,
    collapseContentStudio,
    createSidebarGroup,
    getCurrent: () => ({ ...current }),
    getSidebarState: () => SB()?.getState?.() || {},
    runEditorLeaveGuard
  };
})();

window.cmsSidebarState = window.CutupAdminSidebar?.getState?.() || window.CutupCmsNav.getSidebarState();
