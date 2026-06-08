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
    sse: null,
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
    return '';
  }

  function parseTicketFromHref(href) {
    var raw = String(href || '').trim();
    if (!raw) return null;
    try {
      var base = raw.indexOf('http') === 0 ? undefined : window.location.origin;
      var u = new URL(raw, base);
      var hash = (u.hash || '').replace(/^#/, '');
      var hm = hash.match(/^support\/(.+)$/);
      if (hm) return decodeURIComponent(hm[1]);
      var ticket = u.searchParams.get('ticket');
      if (ticket && (u.pathname.indexOf('go.html') >= 0 || u.pathname.indexOf('dashboard.html') >= 0)) {
        return String(ticket).trim();
      }
    } catch (_e) { /* noop */ }
    var local = raw.replace(/^#/, '');
    var lm = local.match(/^support\/(.+)$/);
    if (lm) return decodeURIComponent(lm[1]);
    return null;
  }

  function openSupportTicket(ticketNumber) {
    var num = String(ticketNumber || '').trim();
    if (!num) return;
    if (typeof window.cutupActivateDashboardSection === 'function') {
      window.cutupActivateDashboardSection('support/' + encodeURIComponent(num));
    } else if (typeof navigateDashboardSection === 'function') {
      navigateDashboardSection('support/' + encodeURIComponent(num));
    } else {
      window.location.hash = 'support/' + encodeURIComponent(num);
    }
    if (window.CutupDashboardSupport?.mount) {
      void window.CutupDashboardSupport.mount(num);
    } else if (window.CutupDashboardSupport?.navigateToTicket) {
      window.CutupDashboardSupport.navigateToTicket(num);
    }
  }

  function openNotificationsPage() {
    closeDropdown();
    if (typeof window.cutupActivateDashboardSection === 'function') {
      window.cutupActivateDashboardSection('notifications');
    } else if (typeof navigateDashboardSection === 'function') {
      navigateDashboardSection('notifications');
    } else {
      window.location.hash = 'notifications';
    }
    mountPageSection();
  }

  function dayGroup(iso) {
    var d = new Date(iso);
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var startYesterday = new Date(startToday.getTime() - 86400000);
    if (d >= startToday) return 'Today';
    if (d >= startYesterday) return 'Yesterday';
    return 'Earlier';
  }

  function actionLabel(item) {
    var m = item?.metadata || {};
    if (m.ticketUrl || m.ticketNumber) return 'View ticket';
    if (m.downloadUrl) return 'Download';
    if (m.href || m.actionUrl || m.ctaUrl) return 'Open';
    return 'View';
  }

  async function refreshUnreadCount() {
    var res = await apiGet('/api/notifications/unread-count');
    if (!res.ok) return;
    state.unread = res.data.count || 0;
    var badge = document.getElementById('cutupNotifBadge');
    var bell = document.getElementById('cutupNotifBell');
    if (badge) {
      badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
      badge.hidden = state.unread <= 0;
    }
    if (bell) bell.classList.toggle('has-unread', state.unread > 0);
  }

  function renderDropdownItem(item) {
    var unread = !item.is_read ? ' is-unread' : '';
    return (
      '<button type="button" class="cutup-notif-item' + unread + '" data-notif-id="' + esc(item.id) + '">' +
        '<span class="cutup-notif-item__icon" aria-hidden="true">' + esc(item.icon || '⚙️') + '</span>' +
        '<span class="cutup-notif-item__body">' +
          '<span class="cutup-notif-item__row">' +
            '<p class="cutup-notif-item__title">' + esc(item.title) + '</p>' +
            (!item.is_read ? '<span class="cutup-notif-item__dot" aria-label="Unread"></span>' : '') +
          '</span>' +
          '<p class="cutup-notif-item__msg">' + esc(item.message) + '</p>' +
          '<span class="cutup-notif-item__foot">' +
            '<span class="cutup-notif-item__time">' + esc(relTime(item.created_at)) + '</span>' +
            '<span class="cutup-notif-item__action">' + esc(actionLabel(item)) + ' →</span>' +
          '</span>' +
        '</span>' +
      '</button>'
    );
  }

  function renderDropdownList() {
    var list = document.getElementById('cutupNotifDropdownList');
    if (!list) return;
    if (!state.dropdownItems.length) {
      list.innerHTML = '<div class="cutup-notif-empty">You&apos;re all caught up.</div>';
      return;
    }
    var groups = { Today: [], Yesterday: [], Earlier: [] };
    state.dropdownItems.forEach(function (item) {
      groups[dayGroup(item.created_at)].push(item);
    });
    list.innerHTML = ['Today', 'Yesterday', 'Earlier']
      .filter(function (g) { return groups[g].length; })
      .map(function (g) {
        return (
          '<div class="cutup-notif-group">' +
            '<div class="cutup-notif-group__label">' + g + '</div>' +
            groups[g].map(renderDropdownItem).join('') +
          '</div>'
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

  async function markTicketNotificationsRead(ticketNumber) {
    if (!ticketNumber) return;
    await apiPost('/api/notifications/read-all', { ticketNumber: ticketNumber });
  }

  async function handleNotificationClick(id, item) {
    var href = notificationHref(item);
    var ticketNumber = item?.metadata?.ticketNumber || parseTicketFromHref(href) || null;
    if (ticketNumber) {
      await markTicketNotificationsRead(ticketNumber);
    } else if (id && !item?.is_read) {
      await apiPost('/api/notifications/' + id + '/read', { id: id });
    }
    closeDropdown();

    if (ticketNumber) {
      openSupportTicket(ticketNumber);
      await refreshUnreadCount();
      return;
    }

    if (href.startsWith('#')) {
      var section = href.replace(/^#/, '');
      if (section === 'notifications') {
        openNotificationsPage();
      } else if (typeof navigateDashboardSection === 'function') {
        navigateDashboardSection(section);
      } else {
        window.location.hash = href;
      }
    } else if (href && href.indexOf('/go.html') >= 0) {
      var goTicket = parseTicketFromHref(href);
      if (goTicket) {
        openSupportTicket(goTicket);
      } else {
        window.location.assign(href);
      }
    } else if (href && (href.indexOf('#support/') >= 0 || href.indexOf('dashboard.html') >= 0)) {
      var fromDash = parseTicketFromHref(href);
      if (fromDash) openSupportTicket(fromDash);
      else window.location.assign(href);
    } else if (href) {
      window.location.assign(href);
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
        '<div class="cutup-notif-dropdown__head"><strong>Notifications</strong><button type="button" id="cutupNotifViewAll" class="cutup-notif-dropdown__link">View all</button></div>' +
        '<div class="cutup-notif-dropdown__list" id="cutupNotifDropdownList"></div>' +
      '</div>';

    var logout = document.getElementById('logoutBtnHeader');
    if (logout) profile.insertBefore(wrap, logout);
    else profile.appendChild(wrap);

    document.getElementById('cutupNotifBell')?.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDropdown();
    });
    document.getElementById('cutupNotifViewAll')?.addEventListener('click', function (e) {
      e.preventDefault();
      openNotificationsPage();
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

  function renderFeedItem(item) {
    var unread = !item.is_read ? ' is-unread' : '';
    var href = notificationHref(item);
    return (
      '<article class="cutup-notif-feed-item' + unread + '">' +
        '<div class="cutup-notif-feed-item__rail"><span class="cutup-notif-feed-item__dot" aria-hidden="true">' + esc(item.icon || '⚙️') + '</span></div>' +
        '<div class="cutup-notif-feed-item__body">' +
          '<header><h3>' + esc(item.title) + '</h3><time>' + esc(relTime(item.created_at)) + '</time></header>' +
          '<p>' + esc(item.message) + '</p>' +
          '<div class="cutup-notif-feed-item__actions">' +
            '<button type="button" class="cutup-notif-feed-item__open" data-open-href="' + esc(href) + '" data-open-id="' + esc(item.id) + '">' + esc(actionLabel(item)) + '</button>' +
            (!item.is_read ? '<button type="button" class="cutup-notif-feed-item__read" data-mark-id="' + esc(item.id) + '">Mark read</button>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderPageList() {
    if (!state.pageItems.length) {
      return '<div class="cutup-notif-empty">No notifications match this filter.</div>';
    }
    var groups = { Today: [], Yesterday: [], Earlier: [] };
    state.pageItems.forEach(function (item) {
      groups[dayGroup(item.created_at)].push(item);
    });
    return (
      '<div class="cutup-notif-feed">' +
        ['Today', 'Yesterday', 'Earlier']
          .filter(function (g) { return groups[g].length; })
          .map(function (g) {
            return (
              '<section class="cutup-notif-feed-group">' +
                '<h2 class="cutup-notif-feed-group__title">' + g + '</h2>' +
                groups[g].map(renderFeedItem).join('') +
              '</section>'
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
      var openBtn = e.target.closest('[data-open-href]');
      if (openBtn) {
        var href = openBtn.getAttribute('data-open-href') || '';
        var oid = Number(openBtn.getAttribute('data-open-id'));
        var item = state.pageItems.find(function (x) { return x.id === oid; });
        void handleNotificationClick(oid, item);
        return;
      }
      var markBtn = e.target.closest('[data-mark-id]');
      if (markBtn) {
        var id = Number(markBtn.getAttribute('data-mark-id'));
        void apiPost('/api/notifications/' + id + '/read', { id: id }).then(function () { return loadPage(root); });
      }
    });
  }

  function connectSse() {
    if (state.sse || typeof EventSource === 'undefined') return;
    try {
      var url = apiBase() + '/api/notifications/stream';
      var sid = typeof currentSession !== 'undefined' ? currentSession : '';
      if (sid) url += '?session=' + encodeURIComponent(sid);
      var es = new EventSource(url, { withCredentials: true });
      es.addEventListener('unread', function (ev) {
        try {
          var data = JSON.parse(ev.data || '{}');
          state.unread = data.count || 0;
          void refreshUnreadCount();
        } catch (_e) { /* noop */ }
      });
      es.addEventListener('notification', function () {
        void refreshUnreadCount();
        var dd = document.getElementById('cutupNotifDropdown');
        if (dd && !dd.hidden) void loadDropdown();
      });
      es.onerror = function () {
        es.close();
        state.sse = null;
        setTimeout(connectSse, 15000);
      };
      state.sse = es;
    } catch (_e) { /* noop */ }
  }

  function mountPageSection() {
    var root = document.getElementById('notificationsPageRoot');
    if (!root) return;
    if (root.dataset.mounted !== '1') {
      root.dataset.mounted = '1';
      root.innerHTML =
        '<header class="cutup-notif-page-head">' +
          '<div><h1 class="section-title">Activity Center</h1><p class="dashboard-section-lead">Exports, billing, support, and account updates in one feed.</p></div>' +
        '</header>' +
        renderPageToolbar(root) +
        '<div id="cutupNotifPageHost"></div>';
    }
    bindPageEvents(root);
    void loadPage(root);
  }

  window.CutupDashboardNotifications = {
    markTicketRead: markTicketNotificationsRead,
    refresh: function () {
      void refreshUnreadCount();
    },
    refreshUnreadCount: refreshUnreadCount,
    init: function () {
      mountBell();
      void refreshUnreadCount();
      connectSse();
    },
    mountPage: mountPageSection,
    openPage: openNotificationsPage,
    openSupportTicket: openSupportTicket,
  };
})();
