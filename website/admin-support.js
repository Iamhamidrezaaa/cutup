/**
 * Admin — Support Center.
 */
(function () {
  'use strict';

  var STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
  var DEPARTMENTS = ['TECHNICAL_SUPPORT', 'BILLING', 'FEATURE_REQUEST', 'ACCOUNT', 'MANAGEMENT', 'GENERAL'];
  var PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

  var state = {
    view: 'list',
    ticketNumber: null,
    tickets: [],
    analytics: null,
    admins: [],
    filters: { status: '', department: '', priority: '', assigned: '', q: '' },
    page: 1,
    totalPages: 1,
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

  async function apiGet(path) {
    var r = await fetch(apiBase() + path, { credentials: 'include' });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  async function apiPost(body) {
    var r = await fetch(apiBase() + '/api/admin/support', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch (_e) { return '—'; }
  }

  function fmtDuration(ms) {
    if (ms == null || Number.isNaN(ms)) return '—';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    if (h > 48) return Math.floor(h / 24) + 'd';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function deptLabel(v) {
    return String(v || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function badge(cls, text) {
    return '<span class="admin-support-badge admin-support-badge--' + esc(cls) + '">' + esc(text) + '</span>';
  }

  function injectStyles() {
    if (document.getElementById('cutup-admin-support-css')) return;
    var s = document.createElement('style');
    s.id = 'cutup-admin-support-css';
    s.textContent =
      '.admin-support-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0 20px}' +
      '.admin-support-kpi{padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-support-kpi span{display:block;font-size:11px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}' +
      '.admin-support-kpi strong{font-size:22px;color:#0f172a}' +
      '.admin-support-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center}' +
      '.admin-support-filters select,.admin-support-filters input{padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px}' +
      '.admin-support-table-wrap{overflow:auto;border:1px solid #e5e7eb;border-radius:12px}' +
      '.admin-support-table{width:100%;min-width:720px;border-collapse:collapse;font-size:13px}' +
      '.admin-support-table th,.admin-support-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:left}' +
      '.admin-support-table th{font-size:11px;text-transform:uppercase;color:#64748b;background:#f8fafc}' +
      '.admin-support-table tbody tr{cursor:pointer}' +
      '.admin-support-table tbody tr:hover{background:#f8fafc}' +
      '.admin-support-badge{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:600;text-transform:uppercase}' +
      '.admin-support-badge--open{background:#dbeafe;color:#1d4ed8}' +
      '.admin-support-badge--in_progress{background:#e0e7ff;color:#4338ca}' +
      '.admin-support-badge--waiting_for_user{background:#fef3c7;color:#b45309}' +
      '.admin-support-badge--resolved{background:#d1fae5;color:#047857}' +
      '.admin-support-badge--closed{background:#f1f5f9;color:#475569}' +
      '.admin-support-badge--low{background:#f1f5f9;color:#64748b}' +
      '.admin-support-badge--normal{background:#e0f2fe;color:#0369a1}' +
      '.admin-support-badge--high{background:#ffedd5;color:#c2410c}' +
      '.admin-support-badge--urgent{background:#fee2e2;color:#b91c1c}' +
      '.admin-support-detail{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}' +
      '.admin-support-thread{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;max-height:420px;overflow-y:auto}' +
      '.admin-support-msg{max-width:88%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap}' +
      '.admin-support-msg--user{align-self:flex-end;background:#6366f1;color:#fff}' +
      '.admin-support-msg--admin{align-self:flex-start;background:#fff;border:1px solid #e2e8f0}' +
      '.admin-support-side{display:flex;flex-direction:column;gap:14px}' +
      '.admin-support-panel{padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-support-panel h4{margin:0 0 10px;font-size:13px}' +
      '.admin-support-panel select,.admin-support-panel textarea{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box}' +
      '.admin-support-panel textarea{min-height:72px;resize:vertical}' +
      '.admin-support-notes{font-size:12px;color:#475569}' +
      '.admin-support-note{padding:8px 0;border-bottom:1px solid #f1f5f9}' +
      '.admin-support-timeline{font-size:12px;color:#64748b}' +
      '.admin-support-timeline li{margin-bottom:6px}' +
      '@media(max-width:900px){.admin-support-detail{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function renderAnalytics() {
    var a = state.analytics || {};
    var dept = (a.departmentDistribution || []).map(function (d) {
      return esc(deptLabel(d.department)) + ': ' + esc(d.count);
    }).join(' · ') || '—';
    return (
      '<div class="admin-support-kpis">' +
        '<article class="admin-support-kpi"><span>Open</span><strong>' + esc(a.openTickets || 0) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>Avg first response</span><strong>' + esc(fmtDuration(a.avgFirstResponseMs)) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>Avg resolution</span><strong>' + esc(fmtDuration(a.avgResolutionMs)) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>Last 24h</span><strong>' + esc(a.tickets24h || 0) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>Last 7 days</span><strong>' + esc(a.tickets7d || 0) + '</strong></article>' +
        '<article class="admin-support-kpi" style="grid-column:span 2"><span>Departments</span><strong style="font-size:14px;font-weight:500">' + dept + '</strong></article>' +
      '</div>'
    );
  }

  function renderFilters() {
    var f = state.filters;
    return (
      '<div class="admin-support-filters">' +
        '<input type="search" id="adminSupportSearch" placeholder="Search ticket, subject, user…" value="' + esc(f.q) + '">' +
        '<select id="adminSupportFilterStatus"><option value="">All statuses</option>' +
          STATUSES.map(function (s) { return '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join('') +
        '</select>' +
        '<select id="adminSupportFilterDept"><option value="">All departments</option>' +
          DEPARTMENTS.map(function (d) { return '<option value="' + d + '"' + (f.department === d ? ' selected' : '') + '>' + deptLabel(d) + '</option>'; }).join('') +
        '</select>' +
        '<select id="adminSupportFilterPriority"><option value="">All priorities</option>' +
          PRIORITIES.map(function (p) { return '<option value="' + p + '"' + (f.priority === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
        '</select>' +
        '<select id="adminSupportFilterAssigned"><option value="">All assignees</option>' +
          '<option value="unassigned"' + (f.assigned === 'unassigned' ? ' selected' : '') + '>Unassigned</option>' +
          state.admins.map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (String(f.assigned) === String(a.id) ? ' selected' : '') + '>' + esc(a.email) + '</option>';
          }).join('') +
        '</select>' +
        '<button type="button" class="btn ghost" id="adminSupportApplyFilters">Apply</button>' +
      '</div>'
    );
  }

  function renderTable() {
    if (!state.tickets.length) return '<p class="admin-muted">No tickets match your filters.</p>';
    return (
      '<div class="admin-support-table-wrap"><table class="admin-support-table">' +
        '<thead><tr><th>Ticket</th><th>User</th><th>Dept</th><th>Priority</th><th>Status</th><th>Assigned</th><th>Last activity</th><th>Created</th></tr></thead><tbody>' +
        state.tickets.map(function (t) {
          return (
            '<tr data-ticket="' + esc(t.ticket_number) + '">' +
              '<td><strong>' + esc(t.ticket_number) + '</strong></td>' +
              '<td>' + esc(t.user_email || '—') + '</td>' +
              '<td>' + esc(deptLabel(t.department)) + '</td>' +
              '<td>' + badge(String(t.priority || 'normal').toLowerCase(), t.priority) + '</td>' +
              '<td>' + badge(String(t.status || '').toLowerCase(), t.status.replace(/_/g, ' ')) + '</td>' +
              '<td>' + esc(t.assigned_admin_email || '—') + '</td>' +
              '<td>' + esc(fmtDate(t.last_activity_at || t.updated_at)) + '</td>' +
              '<td>' + esc(fmtDate(t.created_at)) + '</td>' +
            '</tr>'
          );
        }).join('') +
        '</tbody></table></div>'
    );
  }

  function renderListView() {
    return (
      '<div class="admin-support">' +
        '<header><h2>Support Center</h2><p class="admin-muted">Manage customer tickets, assignments, and responses.</p></header>' +
        renderAnalytics() +
        renderFilters() +
        renderTable() +
        '<p class="admin-muted" style="margin-top:10px">Page ' + state.page + ' of ' + state.totalPages + '</p>' +
      '</div>'
    );
  }

  function renderMessages(messages) {
    return (messages || []).map(function (m) {
      var cls = m.sender_type === 'user' ? 'admin-support-msg--user' : 'admin-support-msg--admin';
      var who = m.sender_type === 'user' ? (m.sender_name || 'User') : (m.sender_email || 'Admin');
      return '<div class="admin-support-msg ' + cls + '"><div>' + esc(m.message) + '</div><small style="opacity:.75">' + esc(who) + ' · ' + esc(fmtDate(m.created_at)) + '</small></div>';
    }).join('');
  }

  function renderNotes(notes) {
    if (!notes?.length) return '<p class="admin-muted">No internal notes.</p>';
    return notes.map(function (n) {
      return '<div class="admin-support-note"><strong>' + esc(n.admin_email) + '</strong> · ' + esc(fmtDate(n.created_at)) + '<br>' + esc(n.note) + '</div>';
    }).join('');
  }

  function renderTimeline(events) {
    if (!events?.length) return '<p class="admin-muted">No activity yet.</p>';
    return '<ul class="admin-support-timeline">' + events.map(function (e) {
      return '<li>' + esc(fmtDate(e.created_at)) + ' — ' + esc(e.event_type.replace(/_/g, ' ')) + '</li>';
    }).join('') + '</ul>';
  }

  function renderDetailView(data) {
    var t = data.ticket;
    return (
      '<div class="admin-support">' +
        '<button type="button" class="btn ghost" id="adminSupportBack" style="margin-bottom:12px">← All tickets</button>' +
        '<h2 style="margin:0 0 6px">' + esc(t.subject) + '</h2>' +
        '<p class="admin-muted">' + esc(t.ticket_number) + ' · ' + esc(t.user_email) + ' · ' + esc(deptLabel(t.department)) + '</p>' +
        '<div class="admin-support-detail">' +
          '<div>' +
            '<div class="admin-support-thread">' + renderMessages(data.messages) + '</div>' +
            '<div style="margin-top:12px">' +
              '<textarea id="adminSupportReply" placeholder="Reply to customer…" rows="3"></textarea>' +
              '<button type="button" class="btn" id="adminSupportSendReply" style="margin-top:8px">Send Reply</button>' +
            '</div>' +
          '</div>' +
          '<div class="admin-support-side">' +
            '<div class="admin-support-panel">' +
              '<h4>Status</h4>' +
              '<select id="adminSupportStatus">' +
                STATUSES.map(function (s) { return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join('') +
              '</select>' +
              '<button type="button" class="btn ghost" id="adminSupportSaveStatus" style="margin-top:8px;width:100%">Update Status</button>' +
            '</div>' +
            '<div class="admin-support-panel">' +
              '<h4>Assignment</h4>' +
              '<select id="adminSupportAssignee">' +
                '<option value="">Unassigned</option>' +
                state.admins.map(function (a) {
                  return '<option value="' + esc(a.id) + '"' + (String(t.assigned_admin_id) === String(a.id) ? ' selected' : '') + '>' + esc(a.email) + '</option>';
                }).join('') +
              '</select>' +
              '<button type="button" class="btn ghost" id="adminSupportSaveAssign" style="margin-top:8px;width:100%">Assign</button>' +
            '</div>' +
            '<div class="admin-support-panel admin-support-notes">' +
              '<h4>Internal notes</h4>' +
              '<div id="adminSupportNotesList">' + renderNotes(data.notes) + '</div>' +
              '<textarea id="adminSupportNote" placeholder="Add internal note (not visible to user)…" style="margin-top:8px"></textarea>' +
              '<button type="button" class="btn ghost" id="adminSupportAddNote" style="margin-top:8px;width:100%">Add Note</button>' +
            '</div>' +
            '<div class="admin-support-panel">' +
              '<h4>Activity</h4>' + renderTimeline(data.events) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildListQuery() {
    var f = state.filters;
    var q = '/api/admin/support?action=list&page=' + state.page;
    if (f.status) q += '&status=' + encodeURIComponent(f.status);
    if (f.department) q += '&department=' + encodeURIComponent(f.department);
    if (f.priority) q += '&priority=' + encodeURIComponent(f.priority);
    if (f.assigned) q += '&assigned=' + encodeURIComponent(f.assigned);
    if (f.q) q += '&q=' + encodeURIComponent(f.q);
    return q;
  }

  async function loadListData() {
    var results = await Promise.all([
      apiGet('/api/admin/support?action=analytics'),
      apiGet('/api/admin/support?action=admins'),
      apiGet(buildListQuery()),
    ]);
    if (results[0].ok) state.analytics = results[0].data.analytics;
    if (results[1].ok) state.admins = results[1].data.admins || [];
    if (results[2].ok) {
      state.tickets = results[2].data.tickets || [];
      state.page = results[2].data.page || 1;
      state.totalPages = results[2].data.totalPages || 1;
    }
  }

  function bindListEvents(root) {
    root.querySelector('#adminSupportApplyFilters')?.addEventListener('click', function () {
      state.filters = {
        status: document.getElementById('adminSupportFilterStatus')?.value || '',
        department: document.getElementById('adminSupportFilterDept')?.value || '',
        priority: document.getElementById('adminSupportFilterPriority')?.value || '',
        assigned: document.getElementById('adminSupportFilterAssigned')?.value || '',
        q: document.getElementById('adminSupportSearch')?.value?.trim() || '',
      };
      state.page = 1;
      void mountList(root);
    });
    root.querySelectorAll('[data-ticket]').forEach(function (row) {
      row.addEventListener('click', function () {
        state.view = 'detail';
        state.ticketNumber = row.getAttribute('data-ticket');
        void mountDetail(root, state.ticketNumber);
      });
    });
  }

  function bindDetailEvents(root, ticketNumber) {
    root.querySelector('#adminSupportBack')?.addEventListener('click', function () {
      state.view = 'list';
      state.ticketNumber = null;
      void mountList(root);
    });

    root.querySelector('#adminSupportSendReply')?.addEventListener('click', async function () {
      var msg = document.getElementById('adminSupportReply')?.value?.trim();
      if (!msg) return;
      var res = await apiPost({ action: 'reply', ticketNumber: ticketNumber, message: msg });
      if (!res.ok) return;
      void mountDetail(root, ticketNumber);
    });

    root.querySelector('#adminSupportSaveStatus')?.addEventListener('click', async function () {
      var status = document.getElementById('adminSupportStatus')?.value;
      await apiPost({ action: 'status', ticketNumber: ticketNumber, status: status });
      void mountDetail(root, ticketNumber);
    });

    root.querySelector('#adminSupportSaveAssign')?.addEventListener('click', async function () {
      var val = document.getElementById('adminSupportAssignee')?.value;
      await apiPost({
        action: 'assign',
        ticketNumber: ticketNumber,
        assigneeAdminId: val === '' ? null : Number(val),
      });
      void mountDetail(root, ticketNumber);
    });

    root.querySelector('#adminSupportAddNote')?.addEventListener('click', async function () {
      var note = document.getElementById('adminSupportNote')?.value?.trim();
      if (!note) return;
      await apiPost({ action: 'note', ticketNumber: ticketNumber, note: note });
      void mountDetail(root, ticketNumber);
    });
  }

  async function mountList(root) {
    root.innerHTML = '<p class="admin-muted">Loading support tickets…</p>';
    await loadListData();
    root.innerHTML = renderListView();
    bindListEvents(root);
  }

  async function mountDetail(root, ticketNumber) {
    root.innerHTML = '<p class="admin-muted">Loading ticket…</p>';
    var adminsRes = await apiGet('/api/admin/support?action=admins');
    if (adminsRes.ok) state.admins = adminsRes.data.admins || [];
    var res = await apiGet('/api/admin/support?ticket=' + encodeURIComponent(ticketNumber));
    if (!res.ok) {
      root.innerHTML = '<p class="admin-muted">Ticket not found.</p>';
      return;
    }
    root.innerHTML = renderDetailView(res.data);
    bindDetailEvents(root, ticketNumber);
  }

  window.CutupAdminSupport = {
    mount: async function (root) {
      if (!root) return;
      injectStyles();
      state.view = 'list';
      state.ticketNumber = null;
      await mountList(root);
    },
  };
})();
