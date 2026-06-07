/**
 * Admin — Email delivery logs (email_send_log).
 */
(function () {
  'use strict';

  var PAGE_SIZE = 40;
  var state = {
    page: 1,
    total: 0,
    totalPages: 1,
    logs: [],
    filters: { q: '', recipient: '', template: '', status: '', provider: '' },
    loading: false,
  };

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

  function statusBadge(status) {
    var s = String(status || 'unknown').toLowerCase();
    var cls = s === 'sent' ? 'is-sent' : s === 'failed' ? 'is-failed' : 'is-skipped';
    return '<span class="admin-email-log__status ' + cls + '">' + esc(s) + '</span>';
  }

  function renderFilters() {
    var f = state.filters;
    return (
      '<div class="admin-email-log__filters">' +
        '<input type="search" id="emailLogSearch" class="admin-input" placeholder="Search recipient, template, subject, message ID…" value="' + esc(f.q) + '" />' +
        '<input type="text" id="emailLogRecipient" class="admin-input" placeholder="Recipient" value="' + esc(f.recipient) + '" />' +
        '<input type="text" id="emailLogTemplate" class="admin-input" placeholder="Template" value="' + esc(f.template) + '" />' +
        '<select id="emailLogStatus" class="admin-input">' +
          '<option value="">All statuses</option>' +
          '<option value="sent"' + (f.status === 'sent' ? ' selected' : '') + '>sent</option>' +
          '<option value="failed"' + (f.status === 'failed' ? ' selected' : '') + '>failed</option>' +
          '<option value="skipped"' + (f.status === 'skipped' ? ' selected' : '') + '>skipped</option>' +
        '</select>' +
        '<select id="emailLogProvider" class="admin-input">' +
          '<option value="">All providers</option>' +
          '<option value="resend"' + (f.provider === 'resend' ? ' selected' : '') + '>resend</option>' +
          '<option value="smtp"' + (f.provider === 'smtp' ? ' selected' : '') + '>smtp</option>' +
        '</select>' +
        '<button type="button" class="admin-btn" id="emailLogApplyBtn">Apply</button>' +
        '<button type="button" class="admin-btn" id="emailLogClearBtn">Clear</button>' +
      '</div>'
    );
  }

  function renderTable() {
    if (!state.logs.length) {
      return '<p class="admin-muted">No delivery logs found.</p>';
    }
    var rows = state.logs
      .map(function (row) {
        return (
          '<tr>' +
            '<td>' + esc(row.template) + '</td>' +
            '<td>' + esc(row.recipient) + '</td>' +
            '<td>' + statusBadge(row.status) + '</td>' +
            '<td>' + esc(row.provider || '—') + '</td>' +
            '<td class="admin-email-log__mono">' + esc(row.message_id || '—') + '</td>' +
            '<td>' + esc(fmtDate(row.created_at)) + '</td>' +
          '</tr>'
        );
      })
      .join('');

    return (
      '<div class="admin-email-log__table-wrap">' +
        '<table class="admin-email-log__table">' +
          '<thead><tr>' +
            '<th>Template</th><th>Recipient</th><th>Status</th><th>Provider</th><th>Message ID</th><th>Created At</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>'
    );
  }

  function renderPager() {
    return (
      '<div class="admin-email-log__pager">' +
        '<button type="button" class="admin-btn" id="emailLogPrevBtn"' + (state.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
        '<span class="admin-muted">Page ' + state.page + ' of ' + state.totalPages + ' · ' + state.total + ' total</span>' +
        '<button type="button" class="admin-btn" id="emailLogNextBtn"' + (state.page >= state.totalPages ? ' disabled' : '') + '>Next</button>' +
      '</div>'
    );
  }

  function renderShell(root) {
    root.innerHTML =
      '<div class="admin-email-log">' +
        '<header class="admin-email-log__head">' +
          '<h2>Delivery Logs</h2>' +
          '<p class="admin-muted">Every email sent through the platform sendEmail() pipeline.</p>' +
        '</header>' +
        renderFilters() +
        '<p id="emailLogStatus" class="admin-muted"></p>' +
        '<div id="emailLogTableHost"></div>' +
        '<div id="emailLogPagerHost"></div>' +
      '</div>';
  }

  function readFiltersFromDom() {
    return {
      q: document.getElementById('emailLogSearch')?.value?.trim() || '',
      recipient: document.getElementById('emailLogRecipient')?.value?.trim() || '',
      template: document.getElementById('emailLogTemplate')?.value?.trim() || '',
      status: document.getElementById('emailLogStatus')?.value || '',
      provider: document.getElementById('emailLogProvider')?.value || '',
    };
  }

  function refreshTableDom() {
    var tableHost = document.getElementById('emailLogTableHost');
    var pagerHost = document.getElementById('emailLogPagerHost');
    if (tableHost) tableHost.innerHTML = renderTable();
    if (pagerHost) pagerHost.innerHTML = renderPager();
    bindPager();
  }

  async function loadLogs() {
    var status = document.getElementById('emailLogStatus');
    if (state.loading) return;
    state.loading = true;
    if (status) status.textContent = 'Loading…';

    var q = new URLSearchParams({
      page: String(state.page),
      limit: String(PAGE_SIZE),
    });
    Object.keys(state.filters).forEach(function (key) {
      if (state.filters[key]) q.set(key, state.filters[key]);
    });

    try {
      var res = await api('/api/admin/email-send-log?' + q.toString());
      if (!res.ok) throw new Error(res.data?.error || res.data?.message || 'load_failed');
      state.logs = res.data.logs || [];
      state.total = res.data.total || 0;
      state.totalPages = res.data.totalPages || 1;
      state.page = res.data.page || state.page;
      refreshTableDom();
      if (status) status.textContent = state.logs.length ? '' : 'No matching logs.';
    } catch (err) {
      if (status) status.textContent = 'Could not load logs: ' + (err?.message || err);
    } finally {
      state.loading = false;
    }
  }

  function bindFilters() {
    document.getElementById('emailLogApplyBtn')?.addEventListener('click', function () {
      state.filters = readFiltersFromDom();
      state.page = 1;
      void loadLogs();
    });
    document.getElementById('emailLogClearBtn')?.addEventListener('click', function () {
      state.filters = { q: '', recipient: '', template: '', status: '', provider: '' };
      state.page = 1;
      var root = document.getElementById('emailDeliveryLogRoot');
      if (root) {
        renderShell(root);
        bindFilters();
        void loadLogs();
      }
    });
    document.getElementById('emailLogSearch')?.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        state.filters = readFiltersFromDom();
        state.page = 1;
        void loadLogs();
      }
    });
  }

  function bindPager() {
    document.getElementById('emailLogPrevBtn')?.addEventListener('click', function () {
      if (state.page <= 1) return;
      state.page -= 1;
      void loadLogs();
    });
    document.getElementById('emailLogNextBtn')?.addEventListener('click', function () {
      if (state.page >= state.totalPages) return;
      state.page += 1;
      void loadLogs();
    });
  }

  function injectStyles() {
    if (document.getElementById('cutup-admin-email-delivery-log-css')) return;
    var s = document.createElement('style');
    s.id = 'cutup-admin-email-delivery-log-css';
    s.textContent =
      '.admin-email-log__filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}' +
      '.admin-email-log__filters .admin-input{min-width:140px}' +
      '.admin-email-log__filters #emailLogSearch{flex:1;min-width:220px}' +
      '.admin-email-log__table-wrap{overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-email-log__table{width:100%;border-collapse:collapse;font-size:13px}' +
      '.admin-email-log__table th,.admin-email-log__table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:left;vertical-align:top}' +
      '.admin-email-log__table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;background:#f9fafb}' +
      '.admin-email-log__mono{font-family:ui-monospace,monospace;font-size:12px;word-break:break-all}' +
      '.admin-email-log__status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;text-transform:uppercase}' +
      '.admin-email-log__status.is-sent{background:#dcfce7;color:#166534}' +
      '.admin-email-log__status.is-failed{background:#fee2e2;color:#991b1b}' +
      '.admin-email-log__status.is-skipped{background:#fef3c7;color:#92400e}' +
      '.admin-email-log__pager{display:flex;align-items:center;gap:12px;margin-top:12px}';
    document.head.appendChild(s);
  }

  window.CutupAdminEmailDeliveryLog = {
    mount: async function (root) {
      if (!root) return;
      root.id = 'emailDeliveryLogRoot';
      injectStyles();
      renderShell(root);
      bindFilters();
      await loadLogs();
    },
    reload: function () {
      void loadLogs();
    },
  };
})();
