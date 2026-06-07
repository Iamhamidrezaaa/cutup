/**
 * Cutup dashboard — in-app notification center.
 */
(function () {
  'use strict';

  var state = {
    unread: 0,
    dropdownItems: [],
    page: 1,
    totalPages: 1,
    filter: 'all',
    pageItems: [],
    loading: false,
  };

  function apiBase() {
    return typeof API_BASE_URL !== 'undefined' ? String(API_BASE_URL).replace(/\/$/, '') : window.location.origin;
  }

  function sessionHeaders() {
    var sid = typeof currentSession !== 'undefined' ? currentSession : null;
    return sid ? { 'X-Session-Id': sid } : {};
  }

  async function apiGet(path) {
    var r = await fetch(apiBase() + path, { credentials: 'include', headers: sessionHeaders() });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  async function apiPost(path, body) {
    var r = await fetch(apiBase() + path, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'Content-Type': 'application/json' }, sessionHeaders()),
      body: JSON.stringify(body || {}),
    });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    var sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    var m = Math.floor(sec / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function notificationHref(item) {
    var href = item?.metadata?.href || item?.metadata?.downloadUrl || item?.metadata?.ticketUrl;
    if (href) return href;
    if (item?.metadata?.href) return item.metadata.href;
    return '#notifications';
  }

  async function refreshUnreadCount() {
    var res = await apiGet('/api/notifications/unread-count');
    if (!res.ok) return;
    state.unread = res.data.count || 0;
    var badge = document.getElementById('cutupNotifBadge');
    if (badge) {
      badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
      badge.hidden = state.unread <= 0;
    }
  }

  function renderDropdownList() {
    var list = document.getElementById('cutupNotifDropdownList');
    if (!list) return;
    if (!state.dropdownItems.length) {
      list.innerHTML = '<div class="cutup-notif-empty">You&apos;re all caught up.</div>';
      return;
    }
    list.innerHTML = state.dropdownItems
      .map(function (item) {
        var unread = !item.is_read ? ' is-unread' : '';
        var href = notificationHref(item);
        return (
          '<button type="button" class="cutup-notif-item' + unread + '" data-notif-id="' + esc(item.id) + '" data-notif-href="' + esc(href) + '">' +
            '<span class="cutup-notif-item__icon" aria-hidden="true">' + esc(item.icon || '⚙️') + '</span>' +
            '<span class="cutup-notif-item__body">' +
              '<span class="cutup-notif-item__row">' +
                '<p class="cutup-notif-item__title">' + esc(item.title) + '</p>' +
                (!item.is_read ? '<span class="cutup-notif-item__dot" aria-label="Unread"></span>' : '') +
              '</span>' +
              '<p class="cutup-notif-item__msg">' + esc(item.message) + '</p>' +
              '<span class="cutup-notif-item__time">' + esc(relTime(item.created_at)) + '</span>' +
            '</span>' +
          '</button>'
        );
      })
      .join('');

    list.querySelectorAll('[data-notif-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-notif-id'));
        var item = state.dropdownItems.find(function (x) { return x.id === id; });
        void handleNotificationClick(id, item);
      });
    });
  }

  async function handleNotificationClick(id, item) {
    if (id && !item?.is_read) {
      await apiPost('/api/notifications/' + id + '/read', { id: id });
    }
    closeDropdown();
    var href = notificationHref(item);
    if (href.startsWith('#')) {
      if (typeof navigateDashboardSection === 'function') navigateDashboardSection(href.replace('#', ''));
      else window.location.hash = href;
    } else if (href) {
      window.location.href = href;
    } else if (typeof navigateDashboardSection === 'function') {
      navigateDashboardSection('notifications');
    }
    await refreshUnreadCount();
  }

  async function loadDropdown() {
    var res = await apiGet('/api/notifications?limit=10&filter=all');
    if (!res.ok) return;
    state.dropdownItems = res.data.notifications || [];
    renderDropdownList();
  }

  function closeDropdown() {
    var dd = document.getElementById('cutupNotifDropdown');
    var bell = document.getElementById('cutupNotifBell');
    if (dd) dd.hidden = true;
    if (bell) bell.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown() {
    var dd = document.getElementById('cutupNotifDropdown');
    var bell = document.getElementById('cutupNotifBell');
    if (!dd || !bell) return;
    var open = dd.hidden;
    dd.hidden = !open;
    bell.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) void loadDropdown();
  }

  function mountBell() {
    var profile = document.getElementById('userProfileHeader');
    if (!profile || document.getElementById('cutupNotifBell')) return;

    var wrap = document.createElement('div');
    wrap.className = 'cutup-notif-bell-wrap';
    wrap.innerHTML =
      '<button type="button" class="cutup-notif-bell" id="cutupNotifBell" aria-label="Notifications" aria-expanded="false" aria-haspopup="true">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '</button>' +
      '<span class="cutup-notif-badge" id="cutupNotifBadge" hidden>0</span>' +
      '<div class="cutup-notif-dropdown" id="cutupNotifDropdown" hidden role="menu">' +
        '<div class="cutup-notif-dropdown__head"><strong>Notifications</strong><a href="#notifications" id="cutupNotifViewAll" class="cutup-notif-dropdown__link">View all</a></div>' +
        '<div class="cutup-notif-dropdown__list" id="cutupNotifDropdownList"></div>' +
      '</div>';

    var logout = document.getElementById('logoutBtnHeader');
    if (logout) profile.insertBefore(wrap, logout);
    else profile.appendChild(wrap);

    document.getElementById('cutupNotifBell')?.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDropdown();
    });
    document.getElementById('cutupNotifViewAll')?.addEventListener('click', function () {
      closeDropdown();
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closeDropdown();
    });
  }

  function renderPageToolbar(root) {
    var f = state.filter;
    return (
      '<div class="cutup-notif-page__toolbar">' +
        '<div class="cutup-notif-page__filters">' +
          '<button type="button" class="cutup-notif-filter-btn' + (f === 'all' ? ' is-active' : '') + '" data-filter="all">All</button>' +
          '<button type="button" class="cutup-notif-filter-btn' + (f === 'unread' ? ' is-active' : '') + '" data-filter="unread">Unread</button>' +
          '<button type="button" class="cutup-notif-filter-btn' + (f === 'read' ? ' is-active' : '') + '" data-filter="read">Read</button>' +
        '</div>' +
        '<button type="button" class="btn-secondary" id="cutupNotifMarkAll">Mark all as read</button>' +
      '</div>'
    );
  }

  function renderPageList() {
    if (!state.pageItems.length) {
      return '<div class="cutup-notif-empty">No notifications match this filter.</div>';
    }
    return (
      '<div class="cutup-notif-page__list">' +
        state.pageItems
          .map(function (item) {
            var unread = !item.is_read ? ' is-unread' : '';
            return (
              '<article class="cutup-notif-page-card' + unread + '">' +
                '<div class="cutup-notif-page-card__icon" aria-hidden="true">' + esc(item.icon || '⚙️') + '</div>' +
                '<div>' +
                  '<h3 class="cutup-notif-page-card__title">' + esc(item.title) + '</h3>' +
                  '<p class="cutup-notif-page-card__msg">' + esc(item.message) + '</p>' +
                  '<span class="cutup-notif-page-card__time">' + esc(relTime(item.created_at)) + '</span>' +
                '</div>' +
                (item.is_read
                  ? ''
                  : '<button type="button" class="cutup-notif-page-card__action" data-mark-id="' + esc(item.id) + '">Mark read</button>') +
              '</article>'
            );
          })
          .join('') +
      '</div>' +
      '<div class="cutup-notif-pager">' +
        '<button type="button" class="btn-secondary" id="cutupNotifPrev"' + (state.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
        '<span class="dashboard-muted">Page ' + state.page + ' of ' + state.totalPages + '</span>' +
        '<button type="button" class="btn-secondary" id="cutupNotifNext"' + (state.page >= state.totalPages ? ' disabled' : '') + '>Next</button>' +
      '</div>'
    );
  }

  async function loadPage(root) {
    if (state.loading) return;
    state.loading = true;
    var host = root.querySelector('#cutupNotifPageHost');
    if (host) host.innerHTML = '<p class="dashboard-muted">Loading notifications…</p>';

    var res = await apiGet('/api/notifications?page=' + state.page + '&limit=20&filter=' + encodeURIComponent(state.filter));
    state.loading = false;
    if (!res.ok) {
      if (host) host.innerHTML = '<p class="dashboard-empty-note">Could not load notifications.</p>';
      return;
    }
    state.pageItems = res.data.notifications || [];
    state.totalPages = res.data.totalPages || 1;
    state.page = res.data.page || state.page;
    if (host) host.innerHTML = renderPageList();
    bindPageEvents(root);
    await refreshUnreadCount();
  }

  function bindPageEvents(root) {
    if (root.dataset.eventsBound === '1') return;
    root.dataset.eventsBound = '1';
    root.addEventListener('click', function (e) {
      var filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        state.filter = filterBtn.getAttribute('data-filter') || 'all';
        state.page = 1;
        var toolbar = root.querySelector('.cutup-notif-page__toolbar');
        if (toolbar) toolbar.outerHTML = renderPageToolbar(root);
        void loadPage(root);
        return;
      }
      if (e.target.closest('#cutupNotifMarkAll')) {
        void apiPost('/api/notifications/read-all', { all: true }).then(function () { return loadPage(root); });
        return;
      }
      if (e.target.closest('#cutupNotifPrev')) {
        if (state.page > 1) {
          state.page -= 1;
          void loadPage(root);
        }
        return;
      }
      if (e.target.closest('#cutupNotifNext')) {
        if (state.page < state.totalPages) {
          state.page += 1;
          void loadPage(root);
        }
        return;
      }
      var markBtn = e.target.closest('[data-mark-id]');
      if (markBtn) {
        var id = Number(markBtn.getAttribute('data-mark-id'));
        void apiPost('/api/notifications/' + id + '/read', { id: id }).then(function () { return loadPage(root); });
      }
    });
  }

  function mountPageSection() {
    var root = document.getElementById('notificationsPageRoot');
    if (!root) return;
    if (root.dataset.mounted !== '1') {
      root.dataset.mounted = '1';
      root.innerHTML = renderPageToolbar(root) + '<div id="cutupNotifPageHost"></div>';
    }
    bindPageEvents(root);
    void loadPage(root);
  }

  window.CutupDashboardNotifications = {
    init: function () {
      mountBell();
      void refreshUnreadCount();
    },
    refresh: function () {
      void refreshUnreadCount();
    },
    mountPage: mountPageSection,
  };
})();
