/**
 * Admin — Support Center V4
 */
(function () {
  'use strict';

  var STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
  var ATTACH_MAX = 5 * 1024 * 1024;
  var ATTACH_EXT = /\.(png|jpe?g|webp|pdf|txt|zip)$/i;

  var QUEUES = [
    { id: 'all_open', label: 'All Open', icon: '📥' },
    { id: 'assigned_me', label: 'Assigned To Me', icon: '👤' },
    { id: 'waiting', label: 'Waiting', icon: '⏳' },
    { id: 'resolved', label: 'Resolved', icon: '✅' },
    { id: 'breached', label: 'Breached SLA', icon: '🔴' },
  ];

  var KPI_MAP = {
    open: 'open',
    waiting: 'waiting',
    urgent: 'urgent',
    breached: 'breached',
    avg_response: '',
  };

  var state = {
    tickets: [],
    analytics: null,
    admins: [],
    currentAdminId: null,
    queue: 'all_open',
    kpiFilter: null,
    q: '',
    page: 1,
    totalPages: 1,
    selected: null,
    preview: null,
    loadingPreview: false,
    composerTab: 'reply',
    pendingAttachments: [],
    lightboxUrl: null,
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

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
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
    return '<span class="sc-badge sc-badge--' + esc(cls) + '">' + esc(text) + '</span>';
  }

  function planLabel(plan) {
    var p = String(plan || 'free').toLowerCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }

  function isImageMime(mime) {
    return String(mime || '').startsWith('image/');
  }

  function isPdfMime(mime, filename) {
    return String(mime || '').includes('pdf') || /\.pdf$/i.test(filename || '');
  }

  function renderMessageAttachments(attachments, inBubble) {
    if (!attachments?.length) return '';
    return (
      '<div class="sc-attachments">' +
        attachments.map(function (a) {
          var url = a.url || '';
          var name = a.filename || 'file';
          if (isImageMime(a.mime)) {
            return (
              '<button type="button" class="sc-attach-thumb" data-lightbox="' + esc(url) + '" title="' + esc(name) + '">' +
                '<img src="' + esc(url) + '" alt="' + esc(name) + '" loading="lazy">' +
              '</button>'
            );
          }
          if (isPdfMime(a.mime, name)) {
            return (
              '<a class="sc-attach-file" href="' + esc(url) + '" target="_blank" rel="noopener">📄 ' + esc(name) + ' · View</a>' +
              '<a class="sc-attach-file" href="' + esc(url) + '" download="' + esc(name) + '">⬇ Download</a>'
            );
          }
          return '<a class="sc-attach-file" href="' + esc(url) + '" download="' + esc(name) + '" target="_blank" rel="noopener">📎 ' + esc(name) + '</a>';
        }).join('') +
      '</div>'
    );
  }

  function renderMessage(m) {
    var isUser = m.sender_type === 'user';
    var side = isUser ? 'sc-msg--user' : 'sc-msg--admin';
    var avatar = m.sender_avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(m.sender_name || 'U');
    var role = !isUser && m.sender_job_title ? '<span class="sc-msg__role">' + esc(m.sender_job_title) + '</span>' : '';
    return (
      '<article class="sc-msg ' + side + '">' +
        '<img class="sc-msg__avatar" src="' + esc(avatar) + '" alt="" width="36" height="36" loading="lazy">' +
        '<div class="sc-msg__body">' +
          '<header class="sc-msg__head">' +
            '<span class="sc-msg__name">' + esc(m.sender_name || (isUser ? 'Customer' : 'Support')) + '</span>' +
            role +
            '<time class="sc-msg__time" datetime="' + esc(m.created_at) + '">' + esc(fmtDate(m.created_at)) + '</time>' +
          '</header>' +
          '<div class="sc-msg__bubble">' +
            (m.message ? esc(m.message) : '') +
            renderMessageAttachments(m.attachments) +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderAnalytics() {
    var a = state.analytics || {};
    var items = [
      { key: 'open', label: 'Open', value: a.openTickets || 0 },
      { key: 'waiting', label: 'Waiting', value: a.waitingTickets || 0 },
      { key: 'urgent', label: 'Urgent', value: a.urgentTickets || 0 },
      { key: 'breached', label: 'Breached', value: a.breachedCount || 0 },
      { key: 'avg_response', label: 'Avg Response', value: fmtDuration(a.avgFirstResponseMs) },
      { key: 'avg_resolution', label: 'Avg Resolution', value: fmtDuration(a.avgResolutionMs) },
    ];
    return (
      '<div class="sc-kpi-grid" role="group" aria-label="Support KPIs">' +
        items.map(function (item) {
          var active = state.kpiFilter === item.key ? ' is-active' : '';
          return (
            '<button type="button" class="sc-kpi' + active + '" data-kpi="' + esc(item.key) + '">' +
              '<span class="sc-kpi__label">' + esc(item.label) + '</span>' +
              '<strong class="sc-kpi__value">' + esc(String(item.value)) + '</strong>' +
            '</button>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderQueues() {
    return QUEUES.map(function (q) {
      var active = state.queue === q.id && !state.kpiFilter ? ' is-active' : '';
      return (
        '<button type="button" class="sc-queue' + active + '" data-queue="' + esc(q.id) + '">' +
          '<span aria-hidden="true">' + q.icon + '</span><span>' + esc(q.label) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function renderTicketCard(t) {
    var sel = state.selected === t.ticket_number ? ' is-selected' : '';
    var agent = t.assigned_agent;
    var agentHtml = agent
      ? '<span class="sc-card__agent"><img src="' + esc(agent.avatar_url) + '" alt="">' + esc(agent.display_name) + '</span>'
      : '<span>Unassigned</span>';
    var attachBadge = t.attachment_count > 0 ? badge('attach', '📎 ' + t.attachment_count) : '';
    return (
      '<button type="button" class="sc-card' + sel + '" data-ticket="' + esc(t.ticket_number) + '">' +
        '<div class="sc-card__row">' +
          '<span class="sc-card__id">' + esc(t.ticket_number) + '</span>' +
          '<span>' + badge(String(t.status || '').toLowerCase(), String(t.status || '').replace(/_/g, ' ')) + '</span>' +
        '</div>' +
        '<p class="sc-card__subject">' + esc(t.subject) + '</p>' +
        '<div class="sc-card__meta">' +
          '<span>' + esc(t.customer_name || t.user_email || '—') + '</span>' +
          '<span>·</span><span>' + esc(deptLabel(t.department)) + '</span>' +
          '<span>·</span>' + badge(String(t.priority || 'normal').toLowerCase(), t.priority) +
          attachBadge +
          '<span>·</span>' + agentHtml +
          '<span>·</span><span>' + esc(fmtDate(t.last_activity_at || t.updated_at)) + '</span>' +
        '</div>' +
      '</button>'
    );
  }

  function renderCustomerPanel(c) {
    if (!c) return '<p class="sc-empty">No customer context.</p>';
    var score = c.support_score != null ? c.support_score + ' / 5' : '—';
    return (
      '<div class="sc-customer">' +
        '<img class="sc-customer__avatar" src="' + esc(c.avatar_url) + '" alt="" width="48" height="48">' +
        '<div>' +
          '<p class="sc-customer__name">' + esc(c.name) + '</p>' +
          '<p class="sc-customer__plan">' + esc(planLabel(c.plan)) + ' plan · Joined ' + esc(fmtDate(c.join_date)) + '</p>' +
        '</div>' +
        '<div class="sc-customer__stats">' +
          '<div class="sc-customer__stat"><span>Open Tickets</span><strong>' + esc(String(c.open_tickets)) + '</strong></div>' +
          '<div class="sc-customer__stat"><span>Resolved</span><strong>' + esc(String(c.resolved_tickets)) + '</strong></div>' +
          '<div class="sc-customer__stat"><span>Last Activity</span><strong style="font-size:12px">' + esc(fmtDate(c.last_activity)) + '</strong></div>' +
          '<div class="sc-customer__stat"><span>Support Score</span><strong>' + esc(score) + '</strong></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderAttachmentsGallery(attachments) {
    if (!attachments?.length) return '<p class="sc-empty">No attachments on this ticket.</p>';
    return (
      '<div class="sc-gallery">' +
        attachments.map(function (a) {
          if (isImageMime(a.mime)) {
            return (
              '<button type="button" class="sc-attach-thumb" data-lightbox="' + esc(a.url) + '" title="' + esc(a.filename) + '">' +
                '<img src="' + esc(a.url) + '" alt="' + esc(a.filename) + '" loading="lazy">' +
              '</button>'
            );
          }
          if (isPdfMime(a.mime, a.filename)) {
            return '<a class="sc-attach-file" href="' + esc(a.url) + '" target="_blank" rel="noopener">📄 ' + esc(a.filename) + '</a>';
          }
          return '<a class="sc-attach-file" href="' + esc(a.url) + '" download="' + esc(a.filename) + '">📎 ' + esc(a.filename) + '</a>';
        }).join('') +
      '</div>'
    );
  }

  function renderNotes(notes) {
    if (!notes?.length) return '<p class="sc-empty">No internal notes yet.</p>';
    return (
      '<div class="sc-notes">' +
        notes.map(function (n) {
          var avatar = n.admin_avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=Note';
          return (
            '<div class="sc-note">' +
              '<div class="sc-note__head">' +
                '<img src="' + esc(avatar) + '" alt="" width="24" height="24">' +
                '<span class="sc-note__meta">' + esc(n.admin_display_name || 'Agent') +
                  (n.admin_job_title ? ' · ' + esc(n.admin_job_title) : '') +
                  ' · ' + esc(fmtDate(n.created_at)) + '</span>' +
              '</div>' +
              '<div class="sc-note__body">' + esc(n.note || '') + '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderComposer(t) {
    var replyActive = state.composerTab === 'reply' ? ' is-active' : '';
    var noteActive = state.composerTab === 'note' ? ' is-active' : '';
    var statusActive = state.composerTab === 'status' ? ' is-active' : '';
    var attachPreview = state.pendingAttachments.length
      ? '<span class="sc-pending-attach">📎 ' + esc(state.pendingAttachments[0].filename) +
        ' <button type="button" class="sc-btn" id="scClearAttach" style="height:32px;padding:0 10px">Remove</button></span>'
      : '';

    var assignOptions = '<option value="">Unassigned</option>' +
      state.admins.map(function (a) {
        var name = a.profile?.display_name || a.email;
        return '<option value="' + esc(a.id) + '"' + (String(t.assigned_admin_id) === String(a.id) ? ' selected' : '') + '>' + esc(name) + '</option>';
      }).join('');

    return (
      '<div class="sc-composer">' +
        '<div class="sc-composer__tabs">' +
          '<button type="button" class="sc-composer__tab' + replyActive + '" data-composer-tab="reply">Reply</button>' +
          '<button type="button" class="sc-composer__tab' + noteActive + '" data-composer-tab="note">Internal Note</button>' +
          '<button type="button" class="sc-composer__tab' + statusActive + '" data-composer-tab="status">Status Update</button>' +
        '</div>' +
        '<div class="sc-composer__panel' + replyActive + '" data-composer-panel="reply">' +
          '<textarea id="scReplyText" placeholder="Write a reply to the customer…"></textarea>' +
          '<div class="sc-composer__actions">' +
            '<button type="button" class="sc-btn sc-btn--primary" id="scSendReply">Send Reply</button>' +
            '<label class="sc-btn"><input type="file" id="scAttachInput" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.zip" hidden>Attach File</label>' +
            attachPreview +
          '</div>' +
        '</div>' +
        '<div class="sc-composer__panel' + noteActive + '" data-composer-panel="note">' +
          '<textarea id="scNoteText" placeholder="Internal note — not visible to customer…"></textarea>' +
          '<div class="sc-composer__actions"><button type="button" class="sc-btn" id="scAddNote">Save Note</button></div>' +
        '</div>' +
        '<div class="sc-composer__panel' + statusActive + '" data-composer-panel="status">' +
          '<select id="scStatusSelect">' +
            STATUSES.map(function (s) {
              return '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>';
            }).join('') +
          '</select>' +
          '<label style="display:block;margin-bottom:8px;font-size:12px;font-weight:700;color:#6b7280">ASSIGN AGENT</label>' +
          '<select id="scAssignSelect">' + assignOptions + '</select>' +
          '<div class="sc-composer__actions" style="margin-top:8px">' +
            '<button type="button" class="sc-btn sc-btn--primary" id="scSaveStatus">Update Status</button>' +
            '<button type="button" class="sc-btn" id="scSaveAssign">Assign</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderWorkspace() {
    if (!state.preview) {
      return '<div class="sc-workspace__empty">Select a ticket to view conversation, customer context, and reply — without leaving the inbox.</div>';
    }
    var d = state.preview;
    var t = d.ticket;
    var thread = (d.messages || []).map(renderMessage).join('') || '<p class="sc-empty">No messages yet.</p>';
    var timeline = (d.events || []).slice().reverse().map(function (e) {
      return '<li>' + esc(fmtDate(e.created_at)) + ' — ' + esc(String(e.event_type || '').replace(/_/g, ' ')) + '</li>';
    }).join('');

    return (
      '<div class="sc-workspace__scroll">' +
        '<div class="sc-ticket-head">' +
          '<h3>' + esc(t.subject) + '</h3>' +
          '<div class="sc-ticket-head__meta">' +
            badge(String(t.status || '').toLowerCase(), String(t.status || '').replace(/_/g, ' ')) +
            badge(String(t.priority || 'normal').toLowerCase(), t.priority) +
            '<span class="sc-badge sc-badge--attach">' + esc(t.ticket_number) + '</span>' +
          '</div>' +
        '</div>' +
        '<section class="sc-section"><h4 class="sc-section__title">Customer Info</h4>' + renderCustomerPanel(d.customer) + '</section>' +
        '<section class="sc-section"><h4 class="sc-section__title">Conversation</h4><div class="sc-thread" id="scThread">' + thread + '</div></section>' +
        '<section class="sc-section"><h4 class="sc-section__title">Timeline</h4><ul class="sc-timeline">' + (timeline || '<li>No activity</li>') + '</ul></section>' +
        '<section class="sc-section"><h4 class="sc-section__title">Attachments</h4>' + renderAttachmentsGallery(d.attachments) + '</section>' +
        '<section class="sc-section"><h4 class="sc-section__title">Internal Notes</h4>' + renderNotes(d.notes) + '</section>' +
      '</div>' +
      renderComposer(t)
    );
  }

  function renderInbox() {
    return (
      '<div class="sc-root admin-support-v4">' +
        '<header class="sc-page-head">' +
          '<h2>Support Inbox</h2>' +
          '<p>Intercom-style conversations with Linear triage — customer context, attachments, and agent identity in one workspace.</p>' +
        '</header>' +
        renderAnalytics() +
        '<div class="sc-inbox" id="scInbox">' +
          '<aside class="sc-queues" aria-label="Queues">' + renderQueues() + '</aside>' +
          '<section class="sc-list">' +
            '<div class="sc-list__head"><input type="search" class="sc-list__search" id="scSearch" placeholder="Search tickets…" value="' + esc(state.q) + '"></div>' +
            '<div class="sc-cards" id="scCards">' +
              (state.tickets.length ? state.tickets.map(renderTicketCard).join('') : '<p class="sc-empty">No tickets in this queue.</p>') +
            '</div>' +
          '</section>' +
          '<aside class="sc-workspace" id="scWorkspace">' + renderWorkspace() + '</aside>' +
        '</div>' +
      '</div>'
    );
  }

  function effectiveQueue() {
    if (state.kpiFilter && KPI_MAP[state.kpiFilter] !== undefined) {
      return KPI_MAP[state.kpiFilter] || state.queue;
    }
    return state.queue;
  }

  function buildListQuery() {
    var q = '/api/admin/support?action=list&page=' + state.page + '&limit=50&queue=' + encodeURIComponent(effectiveQueue());
    if (state.q) q += '&q=' + encodeURIComponent(state.q);
    return q;
  }

  function refreshCardsDom() {
    var host = document.getElementById('scCards');
    if (host) {
      host.innerHTML = state.tickets.length
        ? state.tickets.map(renderTicketCard).join('')
        : '<p class="sc-empty">No tickets in this queue.</p>';
    }
    var kpiHost = document.querySelector('.sc-kpi-grid');
    if (kpiHost) kpiHost.outerHTML = renderAnalytics();
  }

  function refreshWorkspaceDom() {
    var host = document.getElementById('scWorkspace');
    if (host) host.innerHTML = renderWorkspace();
    var thread = document.getElementById('scThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  async function loadPreview(ticketNumber) {
    state.loadingPreview = true;
    state.selected = ticketNumber;
    state.pendingAttachments = [];
    var res = await apiGet('/api/admin/support?ticket=' + encodeURIComponent(ticketNumber));
    state.loadingPreview = false;
    state.preview = res.ok ? res.data : null;
    refreshWorkspaceDom();
    refreshCardsDom();
  }

  async function uploadAttachment(file) {
    if (!file) return null;
    if (file.size > ATTACH_MAX) throw new Error('File too large (max 5MB)');
    if (!ATTACH_EXT.test(file.name)) throw new Error('Unsupported file type');
    var fd = new FormData();
    fd.append('file', file);
    var r = await fetch(apiBase() + '/api/admin/support/attachments', {
      method: 'POST', credentials: 'include', body: fd,
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok || !d.attachment) throw new Error(d.error || 'upload_failed');
    return d.attachment;
  }

  async function refreshList() {
    var results = await Promise.all([
      apiGet('/api/admin/support?action=analytics'),
      apiGet('/api/admin/support?action=admins'),
      apiGet(buildListQuery()),
    ]);
    if (results[0].ok) state.analytics = results[0].data.analytics;
    if (results[1].ok) {
      state.admins = results[1].data.admins || [];
      state.currentAdminId = results[1].data.currentAdminId || null;
    }
    if (results[2].ok) {
      state.tickets = results[2].data.tickets || [];
      state.page = results[2].data.page || 1;
      state.totalPages = results[2].data.totalPages || 1;
      if (results[2].data.currentAdminId) state.currentAdminId = results[2].data.currentAdminId;
    }
  }

  function showLightbox(url) {
    state.lightboxUrl = url;
    var existing = document.getElementById('scLightbox');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.id = 'scLightbox';
    el.className = 'sc-lightbox';
    el.innerHTML = '<img src="' + esc(url) + '" alt="Attachment preview">';
    el.addEventListener('click', function () { el.remove(); state.lightboxUrl = null; });
    document.body.appendChild(el);
  }

  function bindRootEvents(root) {
    if (root.__scBound) return;
    root.__scBound = true;

    root.addEventListener('click', function (e) {
      var queueBtn = e.target.closest('[data-queue]');
      if (queueBtn) {
        state.queue = queueBtn.getAttribute('data-queue') || 'all_open';
        state.kpiFilter = null;
        state.page = 1;
        void refreshAndRender(root);
        return;
      }

      var kpiBtn = e.target.closest('[data-kpi]');
      if (kpiBtn) {
        var key = kpiBtn.getAttribute('data-kpi');
        state.kpiFilter = state.kpiFilter === key ? null : key;
        if (state.kpiFilter && KPI_MAP[state.kpiFilter]) state.queue = KPI_MAP[state.kpiFilter] || state.queue;
        state.page = 1;
        void refreshAndRender(root);
        return;
      }

      var card = e.target.closest('[data-ticket]');
      if (card) {
        void loadPreview(card.getAttribute('data-ticket'));
        return;
      }

      var lb = e.target.closest('[data-lightbox]');
      if (lb) {
        e.preventDefault();
        showLightbox(lb.getAttribute('data-lightbox'));
        return;
      }

      var tab = e.target.closest('[data-composer-tab]');
      if (tab) {
        state.composerTab = tab.getAttribute('data-composer-tab') || 'reply';
        document.querySelectorAll('[data-composer-tab]').forEach(function (b) {
          b.classList.toggle('is-active', b === tab);
        });
        document.querySelectorAll('[data-composer-panel]').forEach(function (p) {
          p.classList.toggle('is-active', p.getAttribute('data-composer-panel') === state.composerTab);
        });
        return;
      }

      if (e.target.id === 'scSendReply') {
        void sendReply();
        return;
      }
      if (e.target.id === 'scAddNote') {
        void addNote();
        return;
      }
      if (e.target.id === 'scSaveStatus') {
        void saveStatus();
        return;
      }
      if (e.target.id === 'scSaveAssign') {
        void saveAssign();
        return;
      }
      if (e.target.id === 'scClearAttach') {
        state.pendingAttachments = [];
        refreshWorkspaceDom();
      }
    });

    root.addEventListener('change', function (e) {
      if (e.target.id === 'scAttachInput' && e.target.files?.[0]) {
        void (async function () {
          try {
            var att = await uploadAttachment(e.target.files[0]);
            state.pendingAttachments = att ? [att] : [];
            refreshWorkspaceDom();
          } catch (err) {
            alert(err?.message || 'Upload failed');
          }
          e.target.value = '';
        })();
      }
    });

    var search = root.querySelector('#scSearch');
    if (search) {
      search.addEventListener('input', debounce(function () {
        state.q = search.value.trim();
        state.page = 1;
        void refreshAndRender(root);
      }, 400));
    }
  }

  async function sendReply() {
    var ticket = state.selected;
    var msg = document.getElementById('scReplyText')?.value?.trim();
    if (!ticket || (!msg && !state.pendingAttachments.length)) return;
    await apiPost({
      action: 'reply',
      ticketNumber: ticket,
      message: msg || '',
      attachments: state.pendingAttachments.length ? state.pendingAttachments : undefined,
    });
    state.pendingAttachments = [];
    await loadPreview(ticket);
    await refreshList();
    refreshCardsDom();
    var kpi = document.querySelector('.sc-kpi-grid');
    if (kpi) kpi.outerHTML = renderAnalytics();
  }

  async function addNote() {
    var ticket = state.selected;
    var note = document.getElementById('scNoteText')?.value?.trim();
    if (!ticket || !note) return;
    await apiPost({ action: 'note', ticketNumber: ticket, note: note });
    await loadPreview(ticket);
  }

  async function saveStatus() {
    var ticket = state.selected;
    var status = document.getElementById('scStatusSelect')?.value;
    if (!ticket || !status) return;
    await apiPost({ action: 'status', ticketNumber: ticket, status: status });
    await loadPreview(ticket);
    await refreshList();
    refreshCardsDom();
  }

  async function saveAssign() {
    var ticket = state.selected;
    var val = document.getElementById('scAssignSelect')?.value;
    if (!ticket) return;
    await apiPost({
      action: 'assign',
      ticketNumber: ticket,
      assigneeAdminId: val === '' ? null : Number(val),
    });
    await loadPreview(ticket);
    await refreshList();
    refreshCardsDom();
  }

  async function refreshAndRender(root) {
    await refreshList();
    refreshCardsDom();
    var kpi = root.querySelector('.sc-kpi-grid');
    if (kpi) kpi.outerHTML = renderAnalytics();
    document.querySelectorAll('[data-queue]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-queue') === state.queue && !state.kpiFilter);
    });
  }

  function ensureStyles() {
    if (document.getElementById('cutup-admin-support-center-css')) return;
    var link = document.createElement('link');
    link.id = 'cutup-admin-support-center-css';
    link.rel = 'stylesheet';
    link.href = 'admin-support-center.css?v=20260602-support-v4';
    document.head.appendChild(link);
  }

  async function mountInbox(root) {
    root.innerHTML = '<p class="admin-muted">Loading support inbox…</p>';
    await refreshList();
    root.innerHTML = renderInbox();
    bindRootEvents(root);
    if (state.selected) await loadPreview(state.selected);
  }

  window.CutupAdminSupport = {
    mount: async function (root) {
      if (!root) return;
      ensureStyles();
      state.selected = null;
      state.preview = null;
      state.queue = 'all_open';
      state.kpiFilter = null;
      state.composerTab = 'reply';
      state.pendingAttachments = [];
      await mountInbox(root);
    },
  };
})();
