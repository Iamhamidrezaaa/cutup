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
      '.admin-support>header{margin-bottom:16px}.admin-support>header h2{margin:0 0 4px;font-size:1.25rem;letter-spacing:-.02em}.admin-support>header .admin-muted{margin:0;font-size:13px}' +
      '.admin-support-kpis{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}' +
      '.admin-support-kpi{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;font-size:12px;color:#64748b}' +
      '.admin-support-kpi strong{font-size:14px;font-weight:700;color:#0f172a}' +
      '.admin-support-filters{display:grid;grid-template-columns:1fr repeat(4,minmax(0,140px)) auto;gap:8px;margin-bottom:14px;align-items:center}' +
      '.admin-support-filters input{grid-column:1/-1}' +
      '.admin-support-filters select,.admin-support-filters input{padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;background:#fff}' +
      '.admin-support-issues{display:flex;flex-direction:column;gap:6px}' +
      '.admin-support-issue{display:grid;grid-template-columns:1fr auto;gap:8px 12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;transition:border-color .15s,background .15s;text-align:left;font-family:inherit;width:100%;box-sizing:border-box}' +
      '.admin-support-issue:hover{border-color:#c7d2fe;background:#fafaff}' +
      '.admin-support-issue__main{min-width:0}' +
      '.admin-support-issue__top{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:4px}' +
      '.admin-support-issue__id{font-size:11px;font-weight:600;color:#64748b;font-variant-numeric:tabular-nums}' +
      '.admin-support-issue__subject{margin:0 0 4px;font-size:14px;font-weight:600;color:#0f172a;line-height:1.35;letter-spacing:-.01em}' +
      '.admin-support-issue__meta{font-size:11px;color:#94a3b8;display:flex;flex-wrap:wrap;gap:6px}' +
      '.admin-support-issue__side{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0}' +
      '.admin-support-quick{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}' +
      '.admin-support-quick button{padding:4px 8px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;font-size:10px;font-weight:600;color:#475569;cursor:pointer;white-space:nowrap}' +
      '.admin-support-quick button:hover{border-color:#c7d2fe;background:#f5f3ff;color:#4338ca}' +
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
      '.admin-support-thread{display:flex;flex-direction:column;gap:20px;padding:24px 20px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;max-height:480px;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '.admin-support-msg{display:flex;gap:10px;max-width:min(82%,520px);align-items:flex-end}' +
      '.admin-support-msg--user{align-self:flex-end;flex-direction:row-reverse}' +
      '.admin-support-msg--admin{align-self:flex-start;flex-direction:row}' +
      '.admin-support-msg__avatar{width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;border:1px solid #e2e8f0;background:#fff}' +
      '.admin-support-msg--user .admin-support-msg__avatar{border-color:rgba(99,91,255,.25)}' +
      '.admin-support-msg__body{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}' +
      '.admin-support-msg__head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
      '.admin-support-msg--user .admin-support-msg__head{justify-content:flex-end}' +
      '.admin-support-msg__name{font-size:13px;font-weight:600;color:#0f172a}' +
      '.admin-support-msg__time{font-size:11px;color:#94a3b8;white-space:nowrap}' +
      '.admin-support-msg__bubble{padding:12px 16px;border-radius:18px;font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 2px rgba(15,23,42,.04)}' +
      '.admin-support-msg--user .admin-support-msg__bubble{background:#635bff;color:#fff;border-bottom-right-radius:6px}' +
      '.admin-support-msg--admin .admin-support-msg__bubble{background:#f4f4f5;color:#0f172a;border:1px solid #e4e4e7;border-bottom-left-radius:6px}' +
      '.admin-support-system{align-self:center;display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:4px 0}' +
      '.admin-support-system__pill{display:inline-block;padding:6px 14px;border-radius:999px;background:#fff;border:1px solid #e2e8f0;font-size:12px;font-weight:500;color:#64748b;text-align:center;max-width:92%}' +
      '.admin-support-system__time{font-size:11px;color:#94a3b8}' +
      '.admin-support-side{display:flex;flex-direction:column;gap:14px}' +
      '.admin-support-panel{padding:14px;border:1px solid #e5e7eb;border-radius:12px;background:#fff}' +
      '.admin-support-panel h4{margin:0 0 10px;font-size:13px}' +
      '.admin-support-panel select,.admin-support-panel textarea{width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box}' +
      '.admin-support-panel textarea{min-height:72px;resize:vertical}' +
      '.admin-support-notes{font-size:12px;color:#475569}' +
      '.admin-support-note{padding:8px 0;border-bottom:1px solid #f1f5f9}' +
      '.admin-support-timeline{font-size:12px;color:#64748b}' +
      '.admin-support-timeline li{margin-bottom:6px}' +
      '.admin-support-empty{padding:32px;text-align:center;color:#64748b;font-size:13px;border:1px dashed #e5e7eb;border-radius:10px}' +
      '@media(max-width:900px){.admin-support-detail{grid-template-columns:1fr}.admin-support-filters{grid-template-columns:1fr 1fr}.admin-support-filters input{grid-column:1/-1}.admin-support-issue{grid-template-columns:1fr}.admin-support-issue__side{align-items:flex-start}}';
    document.head.appendChild(s);
  }

  function renderAnalytics() {
    var a = state.analytics || {};
    return (
      '<div class="admin-support-kpis">' +
        '<article class="admin-support-kpi"><span>Open</span><strong>' + esc(a.openTickets || 0) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>First response</span><strong>' + esc(fmtDuration(a.avgFirstResponseMs)) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>Resolution</span><strong>' + esc(fmtDuration(a.avgResolutionMs)) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>24h</span><strong>' + esc(a.tickets24h || 0) + '</strong></article>' +
        '<article class="admin-support-kpi"><span>7d</span><strong>' + esc(a.tickets7d || 0) + '</strong></article>' +
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

  function quickActionsForTicket(t) {
    var actions = [];
    var s = t.status;
    if (s === 'OPEN') actions.push({ status: 'IN_PROGRESS', label: 'Start' });
    if (s === 'IN_PROGRESS') actions.push({ status: 'WAITING_FOR_USER', label: 'Waiting' });
    if (s === 'WAITING_FOR_USER') actions.push({ status: 'IN_PROGRESS', label: 'Resume' });
    if (['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'].includes(s)) {
      actions.push({ status: 'RESOLVED', label: 'Resolve' });
    }
    if (s === 'RESOLVED') actions.push({ status: 'CLOSED', label: 'Close' });
    return actions;
  }

  function renderQuickActions(t) {
    var actions = quickActionsForTicket(t);
    if (!actions.length) return '';
    return (
      '<div class="admin-support-quick">' +
        actions
          .map(function (a) {
            return (
              '<button type="button" data-quick-status="' + esc(a.status) + '" data-ticket="' + esc(t.ticket_number) + '">' +
                esc(a.label) +
              '</button>'
            );
          })
          .join('') +
      '</div>'
    );
  }

  function renderIssueRow(t) {
    return (
      '<article class="admin-support-issue" data-ticket="' + esc(t.ticket_number) + '" tabindex="0" role="button">' +
        '<div class="admin-support-issue__main">' +
          '<div class="admin-support-issue__top">' +
            '<span class="admin-support-issue__id">' + esc(t.ticket_number) + '</span>' +
            badge(String(t.priority || 'normal').toLowerCase(), t.priority) +
          '</div>' +
          '<h3 class="admin-support-issue__subject">' + esc(t.subject || 'Support request') + '</h3>' +
          '<div class="admin-support-issue__meta">' +
            '<span>' + esc(t.user_email || '—') + '</span>' +
            '<span>·</span>' +
            '<span>' + esc(deptLabel(t.department)) + '</span>' +
            '<span>·</span>' +
            '<span>' + esc(t.assigned_admin_email || 'Unassigned') + '</span>' +
            '<span>·</span>' +
            '<span>' + esc(fmtDate(t.last_activity_at || t.updated_at)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="admin-support-issue__side">' +
          badge(String(t.status || '').toLowerCase(), t.status.replace(/_/g, ' ')) +
          renderQuickActions(t) +
        '</div>' +
      '</article>'
    );
  }

  function renderIssueList() {
    if (!state.tickets.length) return '<div class="admin-support-empty">No tickets match your filters.</div>';
    return '<div class="admin-support-issues">' + state.tickets.map(renderIssueRow).join('') + '</div>';
  }

  function renderListView() {
    return (
      '<div class="admin-support">' +
        '<header><h2>Support Center</h2><p class="admin-muted">Customer tickets — reply, assign, and resolve.</p></header>' +
        renderAnalytics() +
        renderFilters() +
        renderIssueList() +
        '<p class="admin-muted" style="margin-top:12px;font-size:12px">Page ' + state.page + ' of ' + state.totalPages + '</p>' +
      '</div>'
    );
  }

  var INLINE_EVENT_TYPES = { created: 1, status_change: 1, assigned: 1 };

  function avatarUrl(name, isUser) {
    var label = String(name || (isUser ? 'User' : 'Support')).trim() || 'User';
    var bg = isUser ? '635BFF' : 'E2E8F0';
    var color = isUser ? 'fff' : '475569';
    return (
      'https://ui-avatars.com/api/?name=' +
      encodeURIComponent(label) +
      '&size=80&background=' +
      bg +
      '&color=' +
      color +
      '&bold=true'
    );
  }

  function formatStatusLabel(status) {
    return String(status || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function eventLabel(event) {
    var p = event.payload || {};
    if (event.event_type === 'created') return 'Ticket opened';
    if (event.event_type === 'status_change') {
      return p.status ? 'Status changed to ' + formatStatusLabel(p.status) : 'Status updated';
    }
    if (event.event_type === 'assigned') {
      if (p.assigneeEmail) return 'Assigned to ' + p.assigneeEmail;
      if (p.assigneeAdminId == null) return 'Ticket unassigned';
      return 'Ticket assigned to support';
    }
    return String(event.event_type || 'update').replace(/_/g, ' ');
  }

  function buildConversationTimeline(messages, events) {
    var items = [];
    (messages || []).forEach(function (m) {
      items.push({ kind: 'message', at: m.created_at, data: m });
    });
    (events || []).forEach(function (e) {
      if (INLINE_EVENT_TYPES[e.event_type]) {
        items.push({ kind: 'event', at: e.created_at, data: e });
      }
    });
    items.sort(function (a, b) {
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    return items;
  }

  function renderSystemEvent(event) {
    return (
      '<div class="admin-support-system" role="status">' +
        '<span class="admin-support-system__pill">' + esc(eventLabel(event)) + '</span>' +
        '<time class="admin-support-system__time" datetime="' + esc(event.created_at) + '">' + esc(fmtDate(event.created_at)) + '</time>' +
      '</div>'
    );
  }

  function renderMessageBubble(m) {
    var isUser = m.sender_type === 'user';
    var who = isUser ? (m.sender_name || m.sender_email || 'Customer') : (m.sender_email || 'Support');
    var side = isUser ? 'admin-support-msg--user' : 'admin-support-msg--admin';
    return (
      '<article class="admin-support-msg ' + side + '">' +
        '<img class="admin-support-msg__avatar" src="' + esc(avatarUrl(who, isUser)) + '" alt="" width="36" height="36" loading="lazy" decoding="async">' +
        '<div class="admin-support-msg__body">' +
          '<header class="admin-support-msg__head">' +
            '<span class="admin-support-msg__name">' + esc(who) + '</span>' +
            '<time class="admin-support-msg__time" datetime="' + esc(m.created_at) + '">' + esc(fmtDate(m.created_at)) + '</time>' +
          '</header>' +
          '<div class="admin-support-msg__bubble">' + esc(m.message) + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderConversation(messages, events) {
    var items = buildConversationTimeline(messages, events);
    if (!items.length) return '<p class="admin-muted">No messages yet.</p>';
    return items
      .map(function (item) {
        return item.kind === 'event' ? renderSystemEvent(item.data) : renderMessageBubble(item.data);
      })
      .join('');
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
            '<div class="admin-support-thread" id="adminSupportThread">' + renderConversation(data.messages, data.events) + '</div>' +
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
    root.querySelectorAll('.admin-support-issue[data-ticket]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-quick-status]')) return;
        state.view = 'detail';
        state.ticketNumber = row.getAttribute('data-ticket');
        void mountDetail(root, state.ticketNumber);
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('[data-quick-status]')) return;
          e.preventDefault();
          state.view = 'detail';
          state.ticketNumber = row.getAttribute('data-ticket');
          void mountDetail(root, state.ticketNumber);
        }
      });
    });
    root.querySelectorAll('[data-quick-status]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var ticket = btn.getAttribute('data-ticket');
        var status = btn.getAttribute('data-quick-status');
        btn.disabled = true;
        await apiPost({ action: 'status', ticketNumber: ticket, status: status });
        void mountList(root);
      });
    });
    var search = document.getElementById('adminSupportSearch');
    if (search && !search.dataset.boundEnter) {
      search.dataset.boundEnter = '1';
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') document.getElementById('adminSupportApplyFilters')?.click();
      });
    }
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
    var thread = document.getElementById('adminSupportThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
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
