/**
 * Admin — notification center stats.
 */
(function () {
  'use strict';

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function apiBase() {
    return window.location.origin;
  }

  async function api(path) {
    var r = await fetch(apiBase() + path, { credentials: 'include' });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch (_e) {
      return '—';
    }
  }

  function renderStats(data) {
    return (
      '<div class="admin-notif-stats">' +
        '<article class="admin-notif-kpi"><span>Total</span><strong>' + esc(data.total) + '</strong></article>' +
        '<article class="admin-notif-kpi"><span>Unread</span><strong>' + esc(data.unread) + '</strong></article>' +
        '<article class="admin-notif-kpi"><span>Read</span><strong>' + esc(data.read) + '</strong></article>' +
        '<article class="admin-notif-kpi"><span>Last 24h</span><strong>' + esc(data.last24h) + '</strong></article>' +
      '</div>'
    );
  }

  function renderRecent(rows) {
    if (!rows?.length) return '<p class="admin-muted">No recent notifications.</p>';
    return (
      '<div class="admin-notif-table-wrap"><table class="admin-notif-table">' +
        '<thead><tr><th>Type</th><th>Title</th><th>User</th><th>Status</th><th>Created</th></tr></thead><tbody>' +
        rows
          .map(function (row) {
            return (
              '<tr>' +
                '<td>' + esc(row.type) + '</td>' +
                '<td>' + esc(row.title) + '</td>' +
                '<td>' + esc(row.user_email) + '</td>' +
                '<td>' + esc(row.is_read ? 'read' : 'unread') + '</td>' +
                '<td>' + esc(fmtDate(row.created_at)) + '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
    );
  }

  function injectStyles() {
    if (document.getElementById('cutup-admin-notifications-css')) return;
    var s = document.createElement('style');
    s.id = 'cutup-admin-notifications-css';
    s.textContent =
      '.admin-notif-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:16px 0 24px}' +
      '.admin-notif-kpi{padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-notif-kpi span{display:block;font-size:12px;color:#64748b;margin-bottom:6px}' +
      '.admin-notif-kpi strong{font-size:24px;color:#0f172a}' +
      '.admin-notif-table-wrap{overflow:auto;border:1px solid #e5e7eb;border-radius:12px}' +
      '.admin-notif-table{width:100%;border-collapse:collapse;font-size:13px}' +
      '.admin-notif-table th,.admin-notif-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:left}';
    document.head.appendChild(s);
  }

  window.CutupAdminNotifications = {
    mount: async function (root) {
      if (!root) return;
      injectStyles();
      root.innerHTML =
        '<div class="admin-notifications">' +
          '<header><h2>Notifications</h2><p class="admin-muted">In-app notification center activity across all users.</p></header>' +
          '<p id="adminNotifStatus" class="admin-muted">Loading…</p>' +
          '<div id="adminNotifStats"></div>' +
          '<h3>Recent activity</h3>' +
          '<div id="adminNotifRecent"></div>' +
        '</div>';

      var res = await api('/api/admin/notifications');
      var status = document.getElementById('adminNotifStatus');
      if (!res.ok) {
        if (status) status.textContent = 'Could not load stats: ' + (res.data?.error || 'error');
        return;
      }
      if (status) status.textContent = '';
      document.getElementById('adminNotifStats').innerHTML = renderStats(res.data);
      document.getElementById('adminNotifRecent').innerHTML = renderRecent(res.data.recent);
    },
  };
})();
