/**
 * Admin — Email delivery logs (email_send_log).
 */
(function () {
  'use strict';

  var PAGE_SIZES = [25, 50, 100];
  var DEBOUNCE_MS = 400;

  var state = {
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1,
    logs: [],
    displayLogs: [],
    filters: {
      q: '',
      recipient: '',
      template: '',
      status: '',
      provider: '',
      dateFrom: '',
      dateTo: '',
    },
    summary: { sent: 0, queued: 0, failed: 0, total: 0 },
    loading: false,
    summaryLoading: false,
    openMenuId: null,
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

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'ec-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function copyText(text) {
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(true);
    } catch (_e) {
      document.body.removeChild(ta);
      return Promise.resolve(false);
    }
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
    var label = s === 'skipped' ? 'queued' : s;
    var cls = 'ec-status--' + (s === 'skipped' ? 'queued' : s);
    if (s !== 'sent' && s !== 'failed' && s !== 'skipped' && s !== 'delivered' && s !== 'opened' && s !== 'clicked') {
      cls = 'ec-status--queued';
    }
    return '<span class="ec-status ' + cls + '">' + esc(label) + '</span>';
  }

  function truncate(val, max) {
    var s = String(val ?? '');
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
  }

  function buildQueryParams(extra, opts) {
    opts = opts || {};
    var q = new URLSearchParams({
      page: String(extra.page != null ? extra.page : state.page),
      limit: String(extra.limit != null ? extra.limit : state.pageSize),
    });
    Object.keys(state.filters).forEach(function (key) {
      if (key === 'dateFrom' || key === 'dateTo') return;
      if (opts.withoutStatus && key === 'status') return;
      if (state.filters[key]) q.set(key, state.filters[key]);
    });
    return q;
  }

  function applyDateFilter(logs) {
    var from = state.filters.dateFrom;
    var to = state.filters.dateTo;
    if (!from && !to) return logs;
    return logs.filter(function (row) {
      if (!row.created_at) return false;
      var d = new Date(row.created_at);
      if (from) {
        var start = new Date(from + 'T00:00:00');
        if (d < start) return false;
      }
      if (to) {
        var end = new Date(to + 'T23:59:59.999');
        if (d > end) return false;
      }
      return true;
    });
  }

  function renderFilters() {
    var f = state.filters;
    return (
      '<div class="ec-log-filters">' +
        '<input type="search" id="emailLogSearch" class="ec-input ec-input--search" placeholder="Search recipient, template, subject, message ID…" value="' + esc(f.q) + '" />' +
        '<input type="text" id="emailLogTemplate" class="ec-input ec-input--compact" placeholder="Template" value="' + esc(f.template) + '" />' +
        '<select id="emailLogStatus" class="ec-select">' +
          '<option value="">All statuses</option>' +
          '<option value="sent"' + (f.status === 'sent' ? ' selected' : '') + '>Sent</option>' +
          '<option value="failed"' + (f.status === 'failed' ? ' selected' : '') + '>Failed</option>' +
          '<option value="skipped"' + (f.status === 'skipped' ? ' selected' : '') + '>Queued</option>' +
        '</select>' +
        '<select id="emailLogProvider" class="ec-select">' +
          '<option value="">All providers</option>' +
          '<option value="resend"' + (f.provider === 'resend' ? ' selected' : '') + '>Resend</option>' +
          '<option value="smtp"' + (f.provider === 'smtp' ? ' selected' : '') + '>SMTP</option>' +
        '</select>' +
        '<input type="date" id="emailLogDateFrom" class="ec-input ec-input--date" value="' + esc(f.dateFrom) + '" aria-label="From date" />' +
        '<input type="date" id="emailLogDateTo" class="ec-input ec-input--date" value="' + esc(f.dateTo) + '" aria-label="To date" />' +
        '<button type="button" class="ec-btn ec-btn--ghost" id="emailLogClearBtn">Clear Filters</button>' +
      '</div>'
    );
  }

  function renderSummary() {
    var s = state.summary;
    return (
      '<div class="ec-kpi-row" aria-label="Delivery summary">' +
        '<div class="ec-kpi ec-kpi--sent"><span class="ec-kpi__label">Sent</span><span class="ec-kpi__value">' + esc(String(s.sent)) + '</span></div>' +
        '<div class="ec-kpi ec-kpi--queued"><span class="ec-kpi__label">Queued</span><span class="ec-kpi__value">' + esc(String(s.queued)) + '</span></div>' +
        '<div class="ec-kpi ec-kpi--failed"><span class="ec-kpi__label">Failed</span><span class="ec-kpi__value">' + esc(String(s.failed)) + '</span></div>' +
        '<div class="ec-kpi"><span class="ec-kpi__label">Total</span><span class="ec-kpi__value">' + esc(String(s.total)) + '</span></div>' +
      '</div>'
    );
  }

  function renderRowActions(row) {
    var id = String(row.id || row.message_id || Math.random());
    var open = state.openMenuId === id ? ' is-open' : '';
    return (
      '<div class="ec-actions' + open + '" data-actions-id="' + esc(id) + '">' +
        '<button type="button" class="ec-actions__toggle" aria-label="Row actions" data-action-toggle="' + esc(id) + '">⋯</button>' +
        '<div class="ec-actions__menu" role="menu">' +
          '<button type="button" class="ec-actions__item" data-action="copy-id" data-value="' + esc(row.message_id || '') + '">Copy Message ID</button>' +
          '<button type="button" class="ec-actions__item" data-action="copy-recipient" data-value="' + esc(row.recipient || '') + '">Copy Recipient</button>' +
          '<button type="button" class="ec-actions__item" data-action="view-payload" data-row-id="' + esc(id) + '">View Payload</button>' +
          '<button type="button" class="ec-actions__item" data-action="provider-details" data-provider="' + esc(row.provider || '') + '" data-msg="' + esc(row.message_id || '') + '"' + (!row.provider ? ' disabled' : '') + '>Open Provider Details</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderTable() {
    if (state.loading && !state.displayLogs.length) {
      return (
        '<div class="ec-table-card">' +
          '<div style="padding:24px">' +
            Array(5).fill('<div class="ec-skeleton" style="height:40px;margin-bottom:8px"></div>').join('') +
          '</div>' +
        '</div>'
      );
    }
    if (!state.displayLogs.length) {
      return (
        '<div class="ec-empty">' +
          '<p class="ec-empty__title">No delivery logs</p>' +
          '<p class="ec-empty__desc">Adjust filters or send a test email from the Templates tab.</p>' +
        '</div>'
      );
    }

    var rows = state.displayLogs.map(function (row) {
      var rowId = String(row.id || row.message_id || '');
      var subject = row.subject || '—';
      var msgId = row.message_id || '—';
      return (
        '<tr data-row-key="' + esc(rowId) + '">' +
          '<td><span class="ec-cell-truncate" title="' + esc(row.template) + '">' + esc(truncate(row.template, 28)) + '</span></td>' +
          '<td><span class="ec-cell-truncate" title="' + esc(row.recipient) + '">' + esc(truncate(row.recipient, 32)) + '</span></td>' +
          '<td>' + statusBadge(row.status) + '</td>' +
          '<td>' + esc(row.provider || '—') + '</td>' +
          '<td class="ec-mono"><span class="ec-cell-truncate" title="' + esc(msgId) + '">' + esc(truncate(msgId, 24)) + '</span></td>' +
          '<td>' + esc(fmtDate(row.created_at)) + '</td>' +
          '<td>' + renderRowActions(row) + '</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="ec-table-card">' +
        '<div class="ec-table-wrap">' +
          '<table class="ec-table">' +
            '<thead><tr>' +
              '<th>Template</th><th>Recipient</th><th>Status</th><th>Provider</th><th>Message ID</th><th>Created</th><th></th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>'
    );
  }

  function renderPager() {
    var total = state.total;
    var page = state.page;
    var size = state.pageSize;
    var start = total === 0 ? 0 : (page - 1) * size + 1;
    var end = Math.min(page * size, total);
    var hasDateFilter = Boolean(state.filters.dateFrom || state.filters.dateTo);
    var info = total === 0
      ? 'No emails to show'
      : 'Showing ' + start + '–' + end + ' of ' + total + ' emails';
    if (hasDateFilter && state.displayLogs.length !== state.logs.length) {
      info += ' · ' + state.displayLogs.length + ' after date filter';
    }

    var pageOptions = '';
    for (var p = 1; p <= state.totalPages; p += 1) {
      pageOptions += '<option value="' + p + '"' + (p === page ? ' selected' : '') + '>' + p + '</option>';
    }
    var sizeOptions = PAGE_SIZES.map(function (n) {
      return '<option value="' + n + '"' + (n === size ? ' selected' : '') + '>' + n + '</option>';
    }).join('');

    return (
      '<div class="ec-pager">' +
        '<span class="ec-pager__info">' + esc(info) + '</span>' +
        '<div class="ec-pager__controls">' +
          '<label>Rows per page <select id="emailLogPageSize" class="ec-select">' + sizeOptions + '</select></label>' +
          '<label>Page <select id="emailLogPageSelect" class="ec-select">' + pageOptions + '</select></label>' +
          '<button type="button" class="ec-btn" id="emailLogPrevBtn"' + (page <= 1 ? ' disabled' : '') + '>Previous</button>' +
          '<button type="button" class="ec-btn" id="emailLogNextBtn"' + (page >= state.totalPages ? ' disabled' : '') + '>Next</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderShell(root) {
    root.innerHTML =
      '<div class="ec-root admin-email-log">' +
        '<header class="ec-page-head">' +
          '<h2>Delivery Logs</h2>' +
          '<p class="ec-muted">Every email sent through the platform sendEmail() pipeline.</p>' +
        '</header>' +
        renderFilters() +
        '<div id="emailLogSummaryHost">' + renderSummary() + '</div>' +
        '<p id="emailLogStatus" class="ec-status-line ec-muted"></p>' +
        '<div id="emailLogTableHost"></div>' +
        '<div id="emailLogPagerHost"></div>' +
      '</div>';
  }

  function readFiltersFromDom() {
    return {
      q: document.getElementById('emailLogSearch')?.value?.trim() || '',
      recipient: '',
      template: document.getElementById('emailLogTemplate')?.value?.trim() || '',
      status: document.getElementById('emailLogStatus')?.value || '',
      provider: document.getElementById('emailLogProvider')?.value || '',
      dateFrom: document.getElementById('emailLogDateFrom')?.value || '',
      dateTo: document.getElementById('emailLogDateTo')?.value || '',
    };
  }

  function refreshTableDom() {
    state.displayLogs = applyDateFilter(state.logs);
    var tableHost = document.getElementById('emailLogTableHost');
    var pagerHost = document.getElementById('emailLogPagerHost');
    var summaryHost = document.getElementById('emailLogSummaryHost');
    if (tableHost) tableHost.innerHTML = renderTable();
    if (pagerHost) pagerHost.innerHTML = renderPager();
    if (summaryHost) summaryHost.innerHTML = renderSummary();
  }

  async function loadSummary() {
    if (state.summaryLoading) return;
    state.summaryLoading = true;
    try {
      var base = buildQueryParams({ page: 1, limit: 1 }, { withoutStatus: true });
      var baseStr = base.toString();
      var sentQ = new URLSearchParams(base);
      sentQ.set('status', 'sent');
      var failedQ = new URLSearchParams(base);
      failedQ.set('status', 'failed');
      var queuedQ = new URLSearchParams(base);
      queuedQ.set('status', 'skipped');

      var results = await Promise.all([
        api('/api/admin/email-send-log?' + sentQ.toString()),
        api('/api/admin/email-send-log?' + queuedQ.toString()),
        api('/api/admin/email-send-log?' + failedQ.toString()),
        api('/api/admin/email-send-log?' + baseStr),
      ]);

      state.summary = {
        sent: results[0].ok ? (results[0].data.total || 0) : 0,
        queued: results[1].ok ? (results[1].data.total || 0) : 0,
        failed: results[2].ok ? (results[2].data.total || 0) : 0,
        total: results[3].ok ? (results[3].data.total || 0) : 0,
      };
    } catch (_e) {
      /* keep previous summary */
    } finally {
      state.summaryLoading = false;
      var summaryHost = document.getElementById('emailLogSummaryHost');
      if (summaryHost) summaryHost.innerHTML = renderSummary();
    }
  }

  async function loadLogs() {
    var status = document.getElementById('emailLogStatus');
    if (state.loading) return;
    state.loading = true;
    if (status) status.textContent = 'Loading…';
    refreshTableDom();

    var q = buildQueryParams({});

    try {
      var res = await api('/api/admin/email-send-log?' + q.toString());
      if (!res.ok) throw new Error(res.data?.error || res.data?.message || 'load_failed');
      state.logs = res.data.logs || [];
      state.total = res.data.total || 0;
      state.totalPages = res.data.totalPages || 1;
      state.page = res.data.page || state.page;
      void loadSummary();
      if (status) status.textContent = state.logs.length ? '' : 'No matching logs on this page.';
    } catch (err) {
      if (status) status.textContent = 'Could not load logs: ' + (err?.message || err);
    } finally {
      state.loading = false;
      refreshTableDom();
    }
  }

  var applyFiltersDebounced = debounce(function () {
    state.filters = readFiltersFromDom();
    state.page = 1;
    void loadLogs();
  }, DEBOUNCE_MS);

  function bindFilters() {
    var ids = ['emailLogSearch', 'emailLogTemplate', 'emailLogStatus', 'emailLogProvider', 'emailLogDateFrom', 'emailLogDateTo'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', applyFiltersDebounced);
      el.addEventListener('change', applyFiltersDebounced);
    });

    document.getElementById('emailLogClearBtn')?.addEventListener('click', function () {
      state.filters = { q: '', recipient: '', template: '', status: '', provider: '', dateFrom: '', dateTo: '' };
      state.page = 1;
      state.pageSize = 25;
      var root = document.getElementById('emailDeliveryLogRoot');
      if (root) {
        renderShell(root);
        bindFilters();
        bindTableDelegation();
        bindPagerDelegation();
        void loadLogs();
      }
    });
  }

  function bindPagerDelegation() {
    var host = document.getElementById('emailLogPagerHost');
    if (!host || host.__ecPagerBound) return;
    host.__ecPagerBound = true;

    host.addEventListener('click', function (e) {
      if (e.target.id === 'emailLogPrevBtn') {
        if (state.page <= 1) return;
        state.page -= 1;
        void loadLogs();
      } else if (e.target.id === 'emailLogNextBtn') {
        if (state.page >= state.totalPages) return;
        state.page += 1;
        void loadLogs();
      }
    });
    host.addEventListener('change', function (e) {
      if (e.target.id === 'emailLogPageSize') {
        state.pageSize = Math.max(1, Number(e.target.value) || 25);
        state.page = 1;
        void loadLogs();
      } else if (e.target.id === 'emailLogPageSelect') {
        state.page = Math.max(1, Number(e.target.value) || 1);
        void loadLogs();
      }
    });
  }

  function findRowByKey(key) {
    return state.logs.find(function (r) {
      return String(r.id || r.message_id || '') === key;
    }) || state.displayLogs.find(function (r) {
      return String(r.id || r.message_id || '') === key;
    });
  }

  function bindTableDelegation() {
    var host = document.getElementById('emailLogTableHost');
    if (!host || host.__ecDelegationBound) return;
    host.__ecDelegationBound = true;

    host.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-action-toggle]');
      if (toggle) {
        e.stopPropagation();
        var id = toggle.getAttribute('data-action-toggle');
        state.openMenuId = state.openMenuId === id ? null : id;
        document.querySelectorAll('.ec-actions').forEach(function (wrap) {
          wrap.classList.toggle('is-open', wrap.getAttribute('data-actions-id') === state.openMenuId);
        });
        return;
      }

      var actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      e.stopPropagation();

      var action = actionBtn.getAttribute('data-action');
      if (action === 'copy-id' || action === 'copy-recipient') {
        var val = actionBtn.getAttribute('data-value') || '';
        void copyText(val).then(function (ok) { toast(ok ? 'Copied' : 'Copy failed'); });
      } else if (action === 'view-payload') {
        var key = actionBtn.closest('tr')?.getAttribute('data-row-key') || '';
        var row = findRowByKey(key);
        var payload = {
          template: row?.template,
          recipient: row?.recipient,
          subject: row?.subject,
          status: row?.status,
          provider: row?.provider,
          message_id: row?.message_id,
          error: row?.error,
          created_at: row?.created_at,
        };
        void copyText(JSON.stringify(payload, null, 2)).then(function (ok) {
          toast(ok ? 'Payload copied to clipboard' : 'Copy failed');
        });
      } else if (action === 'provider-details') {
        var provider = (actionBtn.getAttribute('data-provider') || '').toLowerCase();
        var msg = actionBtn.getAttribute('data-msg') || '';
        if (provider === 'resend' && msg) {
          window.open('https://resend.com/emails/' + encodeURIComponent(msg), '_blank', 'noopener,noreferrer');
        } else {
          toast('Provider details not available for ' + (provider || 'unknown'));
        }
      }

      state.openMenuId = null;
      document.querySelectorAll('.ec-actions').forEach(function (w) { w.classList.remove('is-open'); });
    });

    if (!window.__ecLogMenuCloseBound) {
      window.__ecLogMenuCloseBound = true;
      document.addEventListener('click', function () {
        state.openMenuId = null;
        document.querySelectorAll('.ec-actions').forEach(function (w) { w.classList.remove('is-open'); });
      });
    }
  }

  function ensureStyles() {
    if (document.getElementById('cutup-admin-email-center-css')) return;
    var link = document.createElement('link');
    link.id = 'cutup-admin-email-center-css';
    link.rel = 'stylesheet';
    link.href = 'admin-email-center.css?v=20260602-email-v1';
    document.head.appendChild(link);
  }

  window.CutupAdminEmailDeliveryLog = {
    mount: async function (root) {
      if (!root) return;
      root.id = 'emailDeliveryLogRoot';
      ensureStyles();
      renderShell(root);
      bindFilters();
      bindTableDelegation();
      bindPagerDelegation();
      await loadLogs();
    },
    reload: function () {
      void loadLogs();
    },
  };
})();
