/**
 * Admin — Support Center V3 (Linear Inbox)
 */
(function () {
  'use strict';

  var STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
  var QUEUES = [
    { id: '', label: 'All Open', icon: '📥' },
    { id: 'open', label: 'Open', icon: '📂' },
    { id: 'assigned', label: 'Assigned', icon: '👤' },
    { id: 'waiting', label: 'Waiting', icon: '⏳' },
    { id: 'resolved', label: 'Resolved', icon: '✅' },
    { id: 'breached', label: 'Breached SLA', icon: '🔴' },
  ];

  var state = {
    tickets: [],
    analytics: null,
    admins: [],
    queue: '',
    q: '',
    page: 1,
    totalPages: 1,
    selected: null,
    preview: null,
    loadingPreview: false,
  };

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function apiBase() { return window.location.origin; }

  async function apiGet(path) {
    var r = await fetch(apiBase() + path, { credentials: 'include' });
    return { ok: r.ok, data: await r.json().catch(function () { return {}; }) };
  }

  async function apiPost(body) {
    var r = await fetch(apiBase() + '/api/admin/support', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { ok: r.ok, data: await r.json().catch(function () { return {}; }) };
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
    return '<span class="admin-inbox-badge admin-inbox-badge--' + esc(cls) + '">' + esc(text) + '</span>';
  }

  function slaBadge(t) {
    var st = String(t.sla_status || 'healthy').toLowerCase();
    if (st === 'healthy' && t.first_response_at) return '';
    var label = st === 'breached' ? 'Breached' : st === 'at_risk' ? 'At Risk' : 'OK';
    return '<span class="admin-inbox-sla admin-inbox-sla--' + esc(st) + '">' + esc(label) + '</span>';
  }

  function injectStyles() {
    if (document.getElementById('cutup-admin-inbox-css')) return;
    var s = document.createElement('style');
    s.id = 'cutup-admin-inbox-css';
    s.textContent =
      '.admin-inbox{display:grid;grid-template-columns:200px 1fr 360px;gap:12px;min-height:520px}' +
      '.admin-inbox-queues,.admin-inbox-list,.admin-inbox-preview{border:1px solid #e5e7eb;border-radius:14px;background:#fff;overflow:hidden}' +
      '.admin-inbox-queues{padding:10px;display:flex;flex-direction:column;gap:4px}' +
      '.admin-inbox-queue{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 10px;border:none;border-radius:10px;background:transparent;cursor:pointer;font-size:13px;color:#475569;font-family:inherit}' +
      '.admin-inbox-queue.is-active{background:#f5f3ff;color:#4338ca;font-weight:600}' +
      '.admin-inbox-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px;border-bottom:1px solid #f1f5f9}' +
      '.admin-inbox-kpi{padding:8px;border:1px solid #f1f5f9;border-radius:10px;font-size:11px;color:#64748b}' +
      '.admin-inbox-kpi strong{display:block;font-size:16px;color:#0f172a;margin-top:2px}' +
      '.admin-inbox-list__head{padding:10px;border-bottom:1px solid #f1f5f9}' +
      '.admin-inbox-list__head input{width:100%;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px}' +
      '.admin-inbox-cards{display:flex;flex-direction:column;gap:6px;padding:8px;max-height:560px;overflow-y:auto}' +
      '.admin-inbox-card{display:block;width:100%;text-align:left;padding:10px 12px;border:1px solid #f1f5f9;border-radius:10px;background:#fafafa;cursor:pointer;font-family:inherit}' +
      '.admin-inbox-card.is-selected,.admin-inbox-card:hover{border-color:#c7d2fe;background:#fafaff}' +
      '.admin-inbox-card__top{display:flex;justify-content:space-between;gap:8px;margin-bottom:4px}' +
      '.admin-inbox-card__id{font-size:11px;font-weight:600;color:#64748b}' +
      '.admin-inbox-card__subject{margin:0 0 4px;font-size:13px;font-weight:600;color:#0f172a}' +
      '.admin-inbox-card__meta{font-size:11px;color:#94a3b8;display:flex;flex-wrap:wrap;gap:6px}' +
      '.admin-inbox-preview{display:flex;flex-direction:column;min-height:0}' +
      '.admin-inbox-preview__empty{padding:40px 16px;text-align:center;color:#94a3b8;font-size:13px}' +
      '.admin-inbox-preview__head{padding:12px;border-bottom:1px solid #f1f5f9}' +
      '.admin-inbox-preview__head h3{margin:0 0 4px;font-size:15px}' +
      '.admin-inbox-preview__meta{font-size:11px;color:#64748b;display:flex;flex-wrap:wrap;gap:6px}' +
      '.admin-inbox-thread{flex:1;overflow-y:auto;padding:12px;max-height:220px;background:#f8fafc;display:flex;flex-direction:column;gap:10px;font-size:12px}' +
      '.admin-inbox-controls{padding:12px;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px}' +
      '.admin-inbox-controls select,.admin-inbox-controls textarea{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;box-sizing:border-box}' +
      '.admin-inbox-controls textarea{min-height:64px;resize:vertical}' +
      '.admin-inbox-timeline{padding:10px 12px;border-top:1px solid #f1f5f9;max-height:140px;overflow-y:auto;font-size:11px;color:#64748b}' +
      '.admin-inbox-timeline li{margin-bottom:4px}' +
      '.admin-inbox-badge{display:inline-flex;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase}' +
      '.admin-inbox-badge--open{background:#dbeafe;color:#1d4ed8}' +
      '.admin-inbox-badge--in_progress{background:#e0e7ff;color:#4338ca}' +
      '.admin-inbox-badge--waiting_for_user{background:#fef3c7;color:#b45309}' +
      '.admin-inbox-badge--urgent{background:#fee2e2;color:#b91c1c}' +
      '.admin-inbox-badge--normal{background:#e0f2fe;color:#0369a1}' +
      '.admin-inbox-sla{font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px}' +
      '.admin-inbox-sla--breached{background:#fee2e2;color:#b91c1c}' +
      '.admin-inbox-sla--at_risk{background:#fef3c7;color:#b45309}' +
      '.admin-inbox-sla--healthy{background:#d1fae5;color:#047857}' +
      '.admin-inbox-analytics{margin-bottom:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}' +
      '.admin-inbox-analytics article{padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;font-size:11px;color:#64748b}' +
      '.admin-inbox-analytics strong{display:block;font-size:18px;color:#0f172a}' +
      '@media(max-width:1100px){.admin-inbox{grid-template-columns:1fr}.admin-inbox-queues{display:grid;grid-template-columns:repeat(3,1fr)}.admin-inbox-preview{min-height:360px}}';
    document.head.appendChild(s);
  }

  function renderAnalytics() {
    var a = state.analytics || {};
    return (
      '<div class="admin-inbox-analytics">' +
        '<article><span>Open</span><strong>' + esc(a.openTickets || 0) + '</strong></article>' +
        '<article><span>Waiting</span><strong>' + esc(a.waitingTickets || 0) + '</strong></article>' +
        '<article><span>Urgent</span><strong>' + esc(a.urgentTickets || 0) + '</strong></article>' +
        '<article><span>Breached SLA</span><strong>' + esc(a.breachedCount || 0) + '</strong></article>' +
        '<article><span>Avg Response</span><strong>' + esc(fmtDuration(a.avgFirstResponseMs)) + '</strong></article>' +
        '<article><span>Avg Resolution</span><strong>' + esc(fmtDuration(a.avgResolutionMs)) + '</strong></article>' +
      '</div>'
    );
  }

  function renderQueues() {
    return QUEUES.map(function (q) {
      return (
        '<button type="button" class="admin-inbox-queue' + (state.queue === q.id ? ' is-active' : '') + '" data-queue="' + esc(q.id) + '">' +
          '<span>' + q.icon + '</span><span>' + esc(q.label) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderTicketCard(t) {
    var sel = state.selected === t.ticket_number ? ' is-selected' : '';
    return (
      '<button type="button" class="admin-inbox-card' + sel + '" data-ticket="' + esc(t.ticket_number) + '">' +
        '<div class="admin-inbox-card__top">' +
          '<span class="admin-inbox-card__id">' + esc(t.ticket_number) + '</span>' +
          '<span>' + badge(String(t.priority || 'normal').toLowerCase(), t.priority) + slaBadge(t) + '</span>' +
        '</div>' +
        '<p class="admin-inbox-card__subject">' + esc(t.subject) + '</p>' +
        '<div class="admin-inbox-card__meta">' +
          '<span>' + esc(t.user_email || '—') + '</span>' +
          '<span>·</span><span>' + esc(deptLabel(t.department)) + '</span>' +
          '<span>·</span><span>' + esc(fmtDate(t.last_activity_at || t.updated_at)) + '</span>' +
        '</div>' +
      '</button>'
    );
  }

  function renderPreview() {
    if (!state.preview) {
      return '<div class="admin-inbox-preview__empty">Select a ticket to preview, reply, and assign — without leaving the inbox.</div>';
    }
    var d = state.preview;
    var t = d.ticket;
    var msgs = (d.messages || []).slice(-4).map(function (m) {
      var who = m.sender_type === 'user' ? (m.sender_email || 'Customer') : (m.sender_email || 'Support');
      return '<div><strong>' + esc(who) + '</strong>: ' + esc((m.message || '').slice(0, 180)) + '</div>';
    }).join('');
    var timeline = (d.events || []).slice(-6).map(function (e) {
      return '<li>' + esc(fmtDate(e.created_at)) + ' — ' + esc(e.event_type.replace(/_/g, ' ')) + '</li>';
    }).join('');
    return (
      '<div class="admin-inbox-preview__head">' +
        '<h3>' + esc(t.subject) + '</h3>' +
        '<div class="admin-inbox-preview__meta">' +
          badge(String(t.status || '').toLowerCase(), t.status.replace(/_/g, ' ')) +
          badge(String(t.priority || 'normal').toLowerCase(), t.priority) +
          slaBadge(t) +
          '<span>' + esc(t.user_email) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="admin-inbox-thread" id="adminInboxThread">' + (msgs || '<span>No messages yet.</span>') + '</div>' +
      '<div class="admin-inbox-controls">' +
        '<textarea id="adminInboxReply" placeholder="Reply to customer…"></textarea>' +
        '<button type="button" class="btn" id="adminInboxSendReply">Send Reply</button>' +
        '<label>Status<select id="adminInboxStatus">' +
          STATUSES.map(function (s) { return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>'; }).join('') +
        '</select></label>' +
        '<button type="button" class="btn ghost" id="adminInboxSaveStatus">Update Status</button>' +
        '<label>Assign<select id="adminInboxAssignee"><option value="">Unassigned</option>' +
          state.admins.map(function (a) {
            return '<option value="' + esc(a.id) + '"' + (String(t.assigned_admin_id) === String(a.id) ? ' selected' : '') + '>' + esc(a.email) + '</option>';
          }).join('') +
        '</select></label>' +
        '<button type="button" class="btn ghost" id="adminInboxSaveAssign">Assign</button>' +
        '<textarea id="adminInboxNote" placeholder="Internal note (not visible to user)…"></textarea>' +
        '<button type="button" class="btn ghost" id="adminInboxAddNote">Add Note</button>' +
      '</div>' +
      '<div class="admin-inbox-timeline"><strong>Timeline</strong><ul>' + (timeline || '<li>No activity</li>') + '</ul></div>'
    );
  }

  function renderInbox() {
    return (
      '<div class="admin-support-v3">' +
        '<header style="margin-bottom:12px"><h2 style="margin:0 0 4px;font-size:1.25rem">Support Inbox</h2><p class="admin-muted" style="margin:0;font-size:13px">Linear-style triage — queues, list, and live preview.</p></header>' +
        renderAnalytics() +
        '<div class="admin-inbox">' +
          '<aside class="admin-inbox-queues" aria-label="Queues">' + renderQueues() + '</aside>' +
          '<section class="admin-inbox-list">' +
            '<div class="admin-inbox-list__head"><input type="search" id="adminInboxSearch" placeholder="Search tickets…" value="' + esc(state.q) + '"></div>' +
            '<div class="admin-inbox-cards" id="adminInboxCards">' +
              (state.tickets.length ? state.tickets.map(renderTicketCard).join('') : '<p class="admin-inbox-preview__empty">No tickets in this queue.</p>') +
            '</div>' +
          '</section>' +
          '<aside class="admin-inbox-preview" id="adminInboxPreview">' + renderPreview() + '</aside>' +
        '</div>' +
      '</div>'
    );
  }

  function buildListQuery() {
    var q = '/api/admin/support?action=list&page=' + state.page + '&limit=40';
    if (state.queue) q += '&queue=' + encodeURIComponent(state.queue);
    if (state.q) q += '&q=' + encodeURIComponent(state.q);
    return q;
  }

  async function loadPreview(ticketNumber) {
    state.loadingPreview = true;
    state.selected = ticketNumber;
    var res = await apiGet('/api/admin/support?ticket=' + encodeURIComponent(ticketNumber));
    state.loadingPreview = false;
    if (res.ok) state.preview = res.data;
    else state.preview = null;
    var host = document.getElementById('adminInboxPreview');
    if (host) {
      host.innerHTML = renderPreview();
      bindPreviewEvents();
      document.querySelectorAll('.admin-inbox-card[data-ticket]').forEach(function (el) {
        el.classList.toggle('is-selected', el.getAttribute('data-ticket') === ticketNumber);
      });
    }
  }

  function bindPreviewEvents() {
    var ticket = state.selected;
    if (!ticket) return;
    document.getElementById('adminInboxSendReply')?.addEventListener('click', async function () {
      var msg = document.getElementById('adminInboxReply')?.value?.trim();
      if (!msg) return;
      await apiPost({ action: 'reply', ticketNumber: ticket, message: msg });
      void loadPreview(ticket);
      void refreshList();
    });
    document.getElementById('adminInboxSaveStatus')?.addEventListener('click', async function () {
      await apiPost({ action: 'status', ticketNumber: ticket, status: document.getElementById('adminInboxStatus')?.value });
      void loadPreview(ticket);
      void refreshList();
    });
    document.getElementById('adminInboxSaveAssign')?.addEventListener('click', async function () {
      var val = document.getElementById('adminInboxAssignee')?.value;
      await apiPost({ action: 'assign', ticketNumber: ticket, assigneeAdminId: val === '' ? null : Number(val) });
      void loadPreview(ticket);
      void refreshList();
    });
    document.getElementById('adminInboxAddNote')?.addEventListener('click', async function () {
      var note = document.getElementById('adminInboxNote')?.value?.trim();
      if (!note) return;
      await apiPost({ action: 'note', ticketNumber: ticket, note: note });
      void loadPreview(ticket);
    });
  }

  async function refreshList() {
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

  function bindInboxEvents(root) {
    root.querySelectorAll('[data-queue]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.queue = btn.getAttribute('data-queue') || '';
        state.page = 1;
        void mountInbox(root);
      });
    });
    root.querySelectorAll('[data-ticket]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        void loadPreview(btn.getAttribute('data-ticket'));
      });
    });
    var search = document.getElementById('adminInboxSearch');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          state.q = search.value.trim();
          state.page = 1;
          void mountInbox(root);
        }
      });
    }
  }

  async function mountInbox(root) {
    root.innerHTML = '<p class="admin-muted">Loading inbox…</p>';
    await refreshList();
    root.innerHTML = renderInbox();
    bindInboxEvents(root);
    if (state.selected) void loadPreview(state.selected);
  }

  window.CutupAdminSupport = {
    mount: async function (root) {
      if (!root) return;
      injectStyles();
      state.selected = null;
      state.preview = null;
      await mountInbox(root);
    },
  };
})();
