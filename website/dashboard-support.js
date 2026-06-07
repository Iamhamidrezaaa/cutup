/**
 * Cutup dashboard — Support Center (user).
 */
(function () {
  'use strict';

  var TURNSTILE_SITE_KEY = '0x4AAAAAADIgzmavc-RbN4iZ';

  var DEPARTMENTS = [
    { value: 'TECHNICAL_SUPPORT', label: 'Technical Support' },
    { value: 'BILLING', label: 'Billing' },
    { value: 'FEATURE_REQUEST', label: 'Feature Request' },
    { value: 'ACCOUNT', label: 'Account' },
    { value: 'MANAGEMENT', label: 'Management' },
    { value: 'GENERAL', label: 'General' },
  ];

  var PRIORITIES = [
    { value: 'LOW', label: 'Low' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'HIGH', label: 'High' },
    { value: 'URGENT', label: 'Urgent' },
  ];

  var state = {
    view: 'list',
    ticketNumber: null,
    stats: null,
    tickets: [],
    loading: false,
    modalOpen: false,
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

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_e) {
      return '—';
    }
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

  function deptLabel(v) {
    var d = DEPARTMENTS.find(function (x) { return x.value === v; });
    return d ? d.label : String(v || '').replace(/_/g, ' ');
  }

  function statusBadge(status) {
    var key = String(status || '').toLowerCase();
    var label = String(status || '').replace(/_/g, ' ');
    return '<span class="cutup-support-badge cutup-support-badge--' + esc(key) + '">' + esc(label) + '</span>';
  }

  function priorityBadge(priority) {
    var key = String(priority || 'normal').toLowerCase();
    return '<span class="cutup-support-badge cutup-support-badge--' + esc(key) + '">' + esc(priority || 'NORMAL') + '</span>';
  }

  function parseSupportHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (raw === 'support' || raw.indexOf('support/') === 0) {
      var ticket = null;
      if (raw.indexOf('support/') === 0) {
        ticket = decodeURIComponent(raw.slice('support/'.length));
      }
      return { section: 'support', ticket: ticket || null };
    }
    return null;
  }

  function navigateToList() {
    window.location.hash = 'support';
    state.view = 'list';
    state.ticketNumber = null;
    void mount(null);
  }

  function navigateToTicket(num) {
    window.location.hash = 'support/' + encodeURIComponent(num);
    state.view = 'detail';
    state.ticketNumber = num;
    void mount(num);
  }

  function rootEl() {
    return document.getElementById('supportPageRoot');
  }

  function fmtDurationMs(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return '< 24h';
    var h = Math.floor(Number(ms) / 3600000);
    var m = Math.floor((Number(ms) % 3600000) / 60000);
    if (h < 1) return m + 'm';
    if (h < 48) return h + 'h' + (m ? ' ' + m + 'm' : '');
    return Math.floor(h / 24) + 'd';
  }

  function deptBadge(dept) {
    return '<span class="cutup-support-dept">' + esc(deptLabel(dept)) + '</span>';
  }

  function renderMetrics() {
    var s = state.stats || {};
    var avg = fmtDurationMs(s.avg_first_response_ms);
    return (
      '<div class="cutup-support-metrics" role="list">' +
        '<div class="cutup-support-metric" role="listitem"><span>Open</span><strong>' + esc(s.open_count || 0) + '</strong></div>' +
        '<div class="cutup-support-metric" role="listitem"><span>Waiting</span><strong>' + esc(s.waiting_count || 0) + '</strong></div>' +
        '<div class="cutup-support-metric" role="listitem"><span>Resolved</span><strong>' + esc(s.resolved_count || 0) + '</strong></div>' +
        '<div class="cutup-support-metric" role="listitem"><span>Closed</span><strong>' + esc(s.closed_count || 0) + '</strong></div>' +
        '<div class="cutup-support-metric cutup-support-metric--accent" role="listitem"><span>Avg response</span><strong>' + esc(avg) + '</strong></div>' +
      '</div>'
    );
  }

  function renderEmptyState() {
    return (
      '<div class="cutup-support-zero">' +
        '<div class="cutup-support-zero__icon" aria-hidden="true">💬</div>' +
        '<h2>No support tickets yet</h2>' +
        '<p>Describe your issue and our team will help you resolve it quickly.</p>' +
        '<p class="cutup-support-zero__sla">Typical response within 24 hours</p>' +
        '<button type="button" class="btn-primary cutup-support-cta" id="cutupSupportCreateBtnEmpty">+ Create Ticket</button>' +
      '</div>'
    );
  }

  function renderIssueCard(t) {
    return (
      '<button type="button" class="cutup-support-issue" data-ticket="' + esc(t.ticket_number) + '">' +
        '<div class="cutup-support-issue__top">' +
          '<span class="cutup-support-issue__id">' + esc(t.ticket_number) + '</span>' +
          '<span class="cutup-support-issue__badges">' + deptBadge(t.department) + statusBadge(t.status) + '</span>' +
        '</div>' +
        '<h3 class="cutup-support-issue__subject">' + esc(t.subject || 'Support request') + '</h3>' +
        '<div class="cutup-support-issue__meta">' +
          '<span>Updated ' + esc(relTime(t.last_activity_at || t.updated_at)) + '</span>' +
          '<span aria-hidden="true">·</span>' +
          '<span>Created ' + esc(fmtDate(t.created_at)) + '</span>' +
        '</div>' +
      '</button>'
    );
  }

  function renderList() {
    if (!state.tickets.length) return renderEmptyState();
    return (
      '<div class="cutup-support-issues" aria-label="Your support tickets">' +
        state.tickets.map(renderIssueCard).join('') +
      '</div>'
    );
  }

  function renderListView() {
    return (
      '<div class="cutup-support-root">' +
        '<div class="cutup-support-head">' +
          '<div class="cutup-support-head__copy">' +
            '<h1 class="section-title">Support</h1>' +
            '<p class="dashboard-section-lead">Premium support from the Cutup team — track every reply in one place.</p>' +
          '</div>' +
          '<button type="button" class="btn-primary cutup-support-cta" id="cutupSupportCreateBtn">+ Create Ticket</button>' +
        '</div>' +
        renderMetrics() +
        renderList() +
      '</div>'
    );
  }

  function avatarUrl(name, isUser) {
    if (isUser && typeof currentUser !== 'undefined' && currentUser?.picture) {
      return currentUser.picture;
    }
    var label = String(name || (isUser ? 'You' : 'Support')).trim() || 'User';
    if (typeof generateAvatar === 'function' && isUser) {
      return generateAvatar(label);
    }
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
      items.push({ kind: 'event', at: e.created_at, data: e });
    });
    items.sort(function (a, b) {
      return new Date(a.at).getTime() - new Date(b.at).getTime();
    });
    return items;
  }

  function renderSystemEvent(event) {
    return (
      '<div class="cutup-support-system" role="status">' +
        '<span class="cutup-support-system__pill">' + esc(eventLabel(event)) + '</span>' +
        '<time class="cutup-support-system__time" datetime="' + esc(event.created_at) + '">' + esc(fmtDate(event.created_at)) + '</time>' +
      '</div>'
    );
  }

  function renderMessageBubble(m) {
    var isUser = m.sender_type === 'user';
    var who = isUser ? 'You' : (m.sender_name || m.sender_email || 'Cutup Support');
    var side = isUser ? 'cutup-support-msg--user' : 'cutup-support-msg--admin';
    var avatar = avatarUrl(who, isUser);
    return (
      '<article class="cutup-support-msg ' + side + '">' +
        '<img class="cutup-support-msg__avatar" src="' + esc(avatar) + '" alt="" width="36" height="36" loading="lazy" decoding="async">' +
        '<div class="cutup-support-msg__body">' +
          '<header class="cutup-support-msg__head">' +
            '<span class="cutup-support-msg__name">' + esc(who) + '</span>' +
            '<time class="cutup-support-msg__time" datetime="' + esc(m.created_at) + '" title="' + esc(fmtDate(m.created_at)) + '">' + esc(fmtDate(m.created_at)) + '</time>' +
          '</header>' +
          '<div class="cutup-support-msg__bubble">' + esc(m.message) + '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderConversation(messages, events) {
    var items = buildConversationTimeline(messages, events);
    if (!items.length) return '<div class="cutup-support-empty">No messages yet.</div>';
    return items
      .map(function (item) {
        return item.kind === 'event' ? renderSystemEvent(item.data) : renderMessageBubble(item.data);
      })
      .join('');
  }

  function renderDetailView(ticket, messages, events) {
    var closed = ['CLOSED', 'RESOLVED'].includes(ticket.status);
    var composer = closed
      ? '<p class="cutup-support-closed-note">This ticket is ' + esc(formatStatusLabel(ticket.status)) + '. Create a new ticket if you need more help.</p>'
      : '<div class="cutup-support-reply">' +
          '<label for="cutupSupportReply">Reply</label>' +
          '<div class="cutup-support-reply__row">' +
            '<textarea id="cutupSupportReply" placeholder="Write a reply…" rows="2"></textarea>' +
            '<button type="button" class="btn-primary" id="cutupSupportSendReply">Send</button>' +
          '</div>' +
        '</div>';
    return (
      '<div class="cutup-support-detail">' +
        '<button type="button" class="cutup-support-detail__back" id="cutupSupportBack">← All tickets</button>' +
        '<header class="cutup-support-detail__header">' +
          '<h1 class="section-title">' + esc(ticket.subject) + '</h1>' +
          '<div class="cutup-support-meta">' +
            '<strong>' + esc(ticket.ticket_number) + '</strong>' +
            statusBadge(ticket.status) +
            priorityBadge(ticket.priority) +
            deptBadge(ticket.department) +
            '<span>Created ' + esc(fmtDate(ticket.created_at)) + '</span>' +
            (ticket.assigned_admin_email ? '<span>' + esc(ticket.assigned_admin_email) + '</span>' : '') +
          '</div>' +
        '</header>' +
        '<div class="cutup-support-conversation">' +
          '<div class="cutup-support-thread" id="cutupSupportThread">' + renderConversation(messages, events) + '</div>' +
          composer +
        '</div>' +
      '</div>'
    );
  }

  function renderCreateModal() {
    return (
      '<div class="cutup-support-modal" id="cutupSupportModal" hidden role="dialog" aria-modal="true" aria-labelledby="cutupSupportModalTitle">' +
        '<div class="cutup-support-modal__card">' +
          '<h2 id="cutupSupportModalTitle">Create support ticket</h2>' +
          '<p class="dashboard-muted" style="margin:0 0 16px">Tell us how we can help. We typically respond within 24 hours.</p>' +
          '<form class="cutup-support-form" id="cutupSupportForm" novalidate>' +
            '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">' +
            '<label>Department<select name="department" required>' +
              DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.value) + '">' + esc(d.label) + '</option>'; }).join('') +
            '</select></label>' +
            '<label>Priority<select name="priority" required>' +
              PRIORITIES.map(function (p) { return '<option value="' + esc(p.value) + '"' + (p.value === 'NORMAL' ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') +
            '</select></label>' +
            '<label>Subject<input name="subject" type="text" required minlength="3" maxlength="200" placeholder="Brief summary"></label>' +
            '<label>Message<textarea name="message" required minlength="10" maxlength="8000" placeholder="Describe your issue in detail…"></textarea></label>' +
            '<div id="cutupSupportTurnstile" class="cf-turnstile" data-sitekey="' + esc(TURNSTILE_SITE_KEY) + '"></div>' +
            '<p id="cutupSupportFormError" class="dashboard-empty-note" hidden role="alert"></p>' +
            '<div class="cutup-support-form__actions">' +
              '<button type="button" class="btn-secondary" id="cutupSupportModalCancel">Cancel</button>' +
              '<button type="submit" class="btn-primary" id="cutupSupportModalSubmit">Submit Ticket</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>'
    );
  }

  function ensureModal() {
    if (document.getElementById('cutupSupportModal')) return;
    document.body.insertAdjacentHTML('beforeend', renderCreateModal());
    bindModalEvents();
  }

  function loadTurnstileScript() {
    return new Promise(function (resolve) {
      if (window.turnstile) {
        resolve();
        return;
      }
      if (document.getElementById('cutupTurnstileScript')) {
        document.getElementById('cutupTurnstileScript').addEventListener('load', resolve, { once: true });
        return;
      }
      var s = document.createElement('script');
      s.id = 'cutupTurnstileScript';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  function openModal() {
    ensureModal();
    var modal = document.getElementById('cutupSupportModal');
    if (!modal) return;
    modal.hidden = false;
    state.modalOpen = true;
    var err = document.getElementById('cutupSupportFormError');
    if (err) err.hidden = true;
    void loadTurnstileScript().then(function () {
      if (window.turnstile) {
        var el = document.getElementById('cutupSupportTurnstile');
        if (el && !el.dataset.rendered) {
          window.turnstile.render(el, { sitekey: TURNSTILE_SITE_KEY });
          el.dataset.rendered = '1';
        }
      }
    });
  }

  function closeModal() {
    var modal = document.getElementById('cutupSupportModal');
    if (modal) modal.hidden = true;
    state.modalOpen = false;
    if (window.turnstile) {
      try { window.turnstile.reset(); } catch (_e) { /* noop */ }
    }
  }

  function bindModalEvents() {
    var modal = document.getElementById('cutupSupportModal');
    if (!modal || modal.dataset.bound === '1') return;
    modal.dataset.bound = '1';

    document.getElementById('cutupSupportModalCancel')?.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });

    document.getElementById('cutupSupportForm')?.addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var errEl = document.getElementById('cutupSupportFormError');
      var submitBtn = document.getElementById('cutupSupportModalSubmit');
      var token = form.querySelector('[name="cf-turnstile-response"]')?.value;
      if (!token) {
        if (errEl) {
          errEl.textContent = 'Please complete the security check.';
          errEl.hidden = false;
        }
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      var res = await apiPost('/api/support/tickets', {
        action: 'create',
        department: form.department.value,
        priority: form.priority.value,
        subject: form.subject.value.trim(),
        message: form.message.value.trim(),
        cfToken: token,
        website: form.website?.value || '',
      });
      if (submitBtn) submitBtn.disabled = false;
      if (!res.ok) {
        if (errEl) {
          errEl.textContent = res.data?.error === 'captcha_failed' ? 'Security check failed. Try again.' : 'Could not create ticket. Please try again.';
          errEl.hidden = false;
        }
        if (window.turnstile) window.turnstile.reset();
        return;
      }
      closeModal();
      form.reset();
      window.CutupDashboardNotifications?.refresh?.();
      if (res.data?.ticket?.ticket_number) {
        navigateToTicket(res.data.ticket.ticket_number);
      } else {
        navigateToList();
      }
    });
  }

  function bindListEvents(root) {
    root.querySelector('#cutupSupportCreateBtn')?.addEventListener('click', openModal);
    root.querySelector('#cutupSupportCreateBtnEmpty')?.addEventListener('click', openModal);
    root.querySelectorAll('[data-ticket]').forEach(function (row) {
      row.addEventListener('click', function () {
        navigateToTicket(row.getAttribute('data-ticket'));
      });
    });
  }

  function bindDetailEvents(root, ticketNumber) {
    root.querySelector('#cutupSupportBack')?.addEventListener('click', navigateToList);
    root.querySelector('#cutupSupportSendReply')?.addEventListener('click', async function () {
      var ta = document.getElementById('cutupSupportReply');
      var msg = ta?.value?.trim();
      if (!msg) return;
      var btn = document.getElementById('cutupSupportSendReply');
      if (btn) btn.disabled = true;
      var res = await apiPost('/api/support/tickets', {
        action: 'reply',
        ticketNumber: ticketNumber,
        message: msg,
      });
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (typeof showDashboardBanner === 'function') {
          showDashboardBanner('Could not send reply. Try again.', 'error');
        }
        return;
      }
      if (ta) ta.value = '';
      void mount(ticketNumber);
    });
    var thread = document.getElementById('cutupSupportThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  async function loadOverview() {
    var res = await apiGet('/api/support/tickets?action=overview');
    if (res.ok) state.stats = res.data.stats || {};
  }

  async function loadList() {
    var res = await apiGet('/api/support/tickets');
    if (res.ok) state.tickets = res.data.tickets || [];
  }

  async function mount(ticketNumber) {
    var root = rootEl();
    if (!root) return;

    state.loading = true;
    root.innerHTML = '<p class="dashboard-muted">Loading support…</p>';

    if (ticketNumber) {
      state.view = 'detail';
      state.ticketNumber = ticketNumber;
      var detail = await apiGet('/api/support/tickets?ticket=' + encodeURIComponent(ticketNumber));
      state.loading = false;
      if (!detail.ok) {
        root.innerHTML = '<p class="dashboard-empty-note">Ticket not found.</p><button type="button" class="btn-secondary" id="cutupSupportBack">← All tickets</button>';
        root.querySelector('#cutupSupportBack')?.addEventListener('click', navigateToList);
        return;
      }
      root.innerHTML = renderDetailView(detail.data.ticket, detail.data.messages, detail.data.events);
      bindDetailEvents(root, ticketNumber);
      return;
    }

    state.view = 'list';
    state.ticketNumber = null;
    await Promise.all([loadOverview(), loadList()]);
    state.loading = false;
    root.innerHTML = renderListView();
    bindListEvents(root);
  }

  window.CutupDashboardSupport = {
    parseSupportHash: parseSupportHash,
    mount: mount,
    navigateToList: navigateToList,
    navigateToTicket: navigateToTicket,
  };

  window.addEventListener('hashchange', function () {
    var route = parseSupportHash(window.location.hash);
    if (!route) return;
    var active = document.getElementById('support-section')?.classList.contains('active');
    if (active) void mount(route.ticket);
  });
})();
