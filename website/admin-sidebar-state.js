/**
 * Shared root accordion state for admin sidebar (Users + Content Studio).
 */
window.CutupAdminSidebar = (function () {
  const STORAGE_KEY = 'cutup_admin_sidebar';

  const state = {
    usersOpen: false,
    contentStudioOpen: false,
    pagesOpen: false,
    blogOpen: false
  };

  let persistEnabled = false;
  let restored = false;
  const applyHandlers = { cms: null, users: null };

  function syncGlobals() {
    window.adminSidebarState = { ...state };
    window.cmsSidebarState = {
      contentStudioOpen: state.contentStudioOpen,
      pagesOpen: state.pagesOpen,
      blogOpen: state.blogOpen
    };
    window.usersSidebarState = { usersOpen: state.usersOpen };
  }

  function enforceRootMutex() {
    if (state.usersOpen && state.contentStudioOpen) {
      state.usersOpen = false;
    }
    if (state.usersOpen) {
      state.contentStudioOpen = false;
      state.pagesOpen = false;
      state.blogOpen = false;
    } else if (state.contentStudioOpen) {
      state.usersOpen = false;
    } else {
      state.pagesOpen = false;
      state.blogOpen = false;
    }
  }

  function applyAll() {
    enforceRootMutex();
    syncGlobals();
    applyHandlers.cms?.();
    applyHandlers.users?.();
  }

  const DEFAULT_STATE = {
    usersOpen: false,
    contentStudioOpen: false,
    pagesOpen: false,
    blogOpen: false
  };

  function resetToDefaults() {
    state.usersOpen = DEFAULT_STATE.usersOpen;
    state.contentStudioOpen = DEFAULT_STATE.contentStudioOpen;
    state.pagesOpen = DEFAULT_STATE.pagesOpen;
    state.blogOpen = DEFAULT_STATE.blogOpen;
  }

  function persist() {
    if (!persistEnabled) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state }));
    } catch (err) {
      console.error('[Sidebar Persist]', err);
    }
  }

  function commit(opts = {}) {
    const shouldPersist = opts.persist !== false;
    if (shouldPersist) persistEnabled = true;

    try {
      applyAll();
    } catch (err) {
      console.error('[Sidebar Commit]', err);
    }

    try {
      persist();
    } catch (err) {
      console.error('[Sidebar Persist]', err);
    }
  }

  function restore() {
    if (restored) return;
    restored = true;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') {
        resetToDefaults();
        return;
      }
      if (typeof saved.usersOpen === 'boolean') state.usersOpen = saved.usersOpen;
      if (typeof saved.contentStudioOpen === 'boolean') {
        state.contentStudioOpen = saved.contentStudioOpen;
      }
      if (typeof saved.pagesOpen === 'boolean') state.pagesOpen = saved.pagesOpen;
      if (typeof saved.blogOpen === 'boolean') state.blogOpen = saved.blogOpen;
      enforceRootMutex();
    } catch (err) {
      console.error('[Sidebar Restore]', err);
      resetToDefaults();
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  function registerApply(key, fn) {
    applyHandlers[key] = fn;
  }

  function toggleUsersRoot() {
    if (state.usersOpen) {
      state.usersOpen = false;
    } else {
      state.usersOpen = true;
      state.contentStudioOpen = false;
      state.pagesOpen = false;
      state.blogOpen = false;
    }
    commit();
  }

  function openUsersRoot() {
    state.usersOpen = true;
    state.contentStudioOpen = false;
    state.pagesOpen = false;
    state.blogOpen = false;
    commit();
  }

  function closeUsersRoot() {
    state.usersOpen = false;
    commit();
  }

  function toggleContentStudioRoot() {
    if (state.contentStudioOpen) {
      state.contentStudioOpen = false;
      state.pagesOpen = false;
      state.blogOpen = false;
    } else {
      state.contentStudioOpen = true;
      state.usersOpen = false;
    }
    commit();
  }

  function openContentStudioRoot() {
    state.contentStudioOpen = true;
    state.usersOpen = false;
    commit();
  }

  function collapseContentStudio() {
    state.contentStudioOpen = false;
    state.pagesOpen = false;
    state.blogOpen = false;
    commit();
  }

  function togglePagesSubgroup() {
    const next = !state.pagesOpen;
    state.pagesOpen = next;
    state.blogOpen = false;
    if (next) {
      state.contentStudioOpen = true;
      state.usersOpen = false;
    }
    commit();
  }

  function toggleBlogSubgroup() {
    const next = !state.blogOpen;
    state.blogOpen = next;
    state.pagesOpen = false;
    if (next) {
      state.contentStudioOpen = true;
      state.usersOpen = false;
    }
    commit();
  }

  function expandCmsSubgroup(section) {
    state.contentStudioOpen = true;
    state.usersOpen = false;
    state.pagesOpen = section === 'pages';
    state.blogOpen = section === 'blog';
    commit();
  }

  function collapseAllRoots() {
    state.usersOpen = false;
    state.contentStudioOpen = false;
    state.pagesOpen = false;
    state.blogOpen = false;
    commit();
  }

  function initOnce() {
    restore();
    syncGlobals();
  }

  return {
    initOnce,
    registerApply,
    getState: () => ({ ...state }),
    toggleUsersRoot,
    openUsersRoot,
    closeUsersRoot,
    toggleContentStudioRoot,
    openContentStudioRoot,
    collapseContentStudio,
    togglePagesSubgroup,
    toggleBlogSubgroup,
    expandCmsSubgroup,
    collapseAllRoots,
    applyAll,
    commit
  };
})();

window.adminSidebarState = window.CutupAdminSidebar.getState();
