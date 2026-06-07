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

  function renderStats() {
    var s = state.stats || {};
    return (
      '<div class="cutup-support-stats">' +
        '<article class="cutup-support-stat"><span>Open Tickets</span><strong>' + esc(s.open_count || 0) + '</strong></article>' +
        '<article class="cutup-support-stat"><span>Waiting Response</span><strong>' + esc(s.waiting_count || 0) + '</strong></article>' +
        '<article class="cutup-support-stat"><span>Resolved</span><strong>' + esc(s.resolved_count || 0) + '</strong></article>' +
        '<article class="cutup-support-stat"><span>Closed</span><strong>' + esc(s.closed_count || 0) + '</strong></article>' +
      '</div>'
    );
  }

  function renderList() {
    if (!state.tickets.length) {
      return '<div class="cutup-support-empty">No support tickets yet. Create one to get help from our team.</div>';
    }
    return (
      '<div class="cutup-support-table-wrap">' +
        '<table class="cutup-support-table" aria-label="Support tickets">' +
          '<thead><tr>' +
            '<th>Ticket</th><th>Department</th><th>Status</th><th>Last Activity</th><th>Created</th>' +
          '</tr></thead><tbody>' +
          state.tickets.map(function (t) {
            return (
              '<tr data-ticket="' + esc(t.ticket_number) + '" tabindex="0" role="button">' +
                '<td><strong>' + esc(t.ticket_number) + '</strong></td>' +
                '<td>' + esc(deptLabel(t.department)) + '</td>' +
                '<td>' + statusBadge(t.status) + '</td>' +
                '<td>' + esc(relTime(t.last_activity_at || t.updated_at)) + '</td>' +
                '<td>' + esc(fmtDate(t.created_at)) + '</td>' +
              '</tr>'
            );
          }).join('') +
          '</tbody></table></div>'
    );
  }

  function renderListView() {
    return (
      '<div class="cutup-support-root">' +
        '<div class="cutup-support-head">' +
          '<div><h1 class="section-title" style="margin:0 0 6px">Support</h1>' +
          '<p class="dashboard-section-lead">Get help from the Cutup team. Track tickets and replies in one place.</p></div>' +
          '<button type="button" class="btn-primary" id="cutupSupportCreateBtn">Create Ticket</button>' +
        '</div>' +
        renderStats() +
        renderList() +
      '</div>'
    );
  }

  function renderMessages(messages) {
    if (!messages?.length) return '<div class="cutup-support-empty">No messages yet.</div>';
    return messages.map(function (m) {
      var isUser = m.sender_type === 'user';
      var cls = isUser ? 'cutup-support-msg--user' : 'cutup-support-msg--admin';
      var who = isUser ? 'You' : (m.sender_name || m.sender_email || 'Support');
      return (
        '<div class="cutup-support-msg ' + cls + '">' +
          '<div class="cutup-support-msg__bubble">' + esc(m.message) + '</div>' +
          '<span class="cutup-support-msg__meta">' + esc(who) + ' · ' + esc(fmtDate(m.created_at)) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderDetailView(ticket, messages) {
    var closed = ['CLOSED', 'RESOLVED'].includes(ticket.status);
    return (
      '<div class="cutup-support-detail">' +
        '<button type="button" class="cutup-support-detail__back" id="cutupSupportBack">← All tickets</button>' +
        '<div>' +
          '<h1 class="section-title" style="margin:0 0 8px">' + esc(ticket.subject) + '</h1>' +
          '<div class="cutup-support-meta">' +
            '<span><strong>' + esc(ticket.ticket_number) + '</strong></span>' +
            '<span>' + statusBadge(ticket.status) + '</span>' +
            '<span>' + priorityBadge(ticket.priority) + '</span>' +
            '<span>' + esc(deptLabel(ticket.department)) + '</span>' +
            '<span>Created ' + esc(fmtDate(ticket.created_at)) + '</span>' +
            (ticket.assigned_admin_email ? '<span>Assigned: ' + esc(ticket.assigned_admin_email) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cutup-support-thread" id="cutupSupportThread">' + renderMessages(messages) + '</div>' +
        (closed
          ? '<p class="dashboard-muted">This ticket is ' + esc(ticket.status.toLowerCase().replace(/_/g, ' ')) + '. Open a new ticket if you need further help.</p>'
          : '<div class="cutup-support-reply">' +
              '<label for="cutupSupportReply">Your reply</label>' +
              '<textarea id="cutupSupportReply" placeholder="Type your message…" rows="4"></textarea>' +
              '<button type="button" class="btn-primary" id="cutupSupportSendReply">Send Reply</button>' +
            '</div>') +
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
    root.querySelectorAll('[data-ticket]').forEach(function (row) {
      var open = function () {
        navigateToTicket(row.getAttribute('data-ticket'));
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
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
      root.innerHTML = renderDetailView(detail.data.ticket, detail.data.messages);
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
