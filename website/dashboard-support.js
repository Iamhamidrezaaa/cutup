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
    activity: [],
    loading: false,
    createFormOpen: false,
    pendingAttachments: [],
    selectedRating: 0,
  };

  var ICON_MSG =
    '<svg class="cutup-help-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 15a4 4 0 01-4 4H7l-4 4V7a4 4 0 014-4h10a4 4 0 014 4v8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '</svg>';

  var ICON_CLIP =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  var RATING_OPTIONS = [
    { score: 1, emoji: '😡', label: 'Very dissatisfied' },
    { score: 2, emoji: '😢', label: 'Dissatisfied' },
    { score: 3, emoji: '😐', label: 'Neutral' },
    { score: 4, emoji: '😍', label: 'Satisfied' },
    { score: 5, emoji: '🥰', label: 'Very satisfied' },
  ];

  function btnPrimary(label, attrs) {
    attrs = attrs || '';
    var icon = /data-no-icon/.test(attrs) ? '' : ICON_MSG;
    var type = /type="submit"/.test(attrs) ? 'submit' : 'button';
    return '<button type="' + type + '" class="cutup-help-btn cutup-help-btn--primary" ' + attrs + '>' + icon + '<span>' + esc(label) + '</span></button>';
  }

  function btnSecondary(label, attrs) {
    attrs = attrs || '';
    return '<button type="button" class="cutup-help-btn cutup-help-btn--secondary" ' + attrs + '><span>' + esc(label) + '</span></button>';
  }

  function ratingEmoji(score) {
    var opt = RATING_OPTIONS.find(function (o) { return o.score === score; });
    return opt ? opt.emoji : '⭐';
  }

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
    void window.CutupDashboardNotifications?.markTicketRead?.(num);
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

  function kpiTrend(key, s) {
    if (key === 'waiting' && s.waiting_count > 0) return 'Needs your reply';
    if (key === 'open' && s.new_7d > 0) return '+' + s.new_7d + ' this week';
    if (key === 'resolved' && s.resolved_count > 0) return 'All clear';
    if (key === 'in_progress' && s.in_progress_count > 0) return 'Team is on it';
    if (key === 'avg') return 'First reply target';
    return '—';
  }

  function renderKpi(icon, label, value, trend, accent) {
    return (
      '<article class="cutup-support-kpi' + (accent ? ' cutup-support-kpi--accent' : '') + '" role="listitem">' +
        '<span class="cutup-support-kpi__icon" aria-hidden="true">' + icon + '</span>' +
        '<div class="cutup-support-kpi__body">' +
          '<span class="cutup-support-kpi__label">' + esc(label) + '</span>' +
          '<strong class="cutup-support-kpi__value">' + esc(value) + '</strong>' +
          '<span class="cutup-support-kpi__trend">' + esc(trend) + '</span>' +
        '</div>' +
      '</article>'
    );
  }

  function renderMetrics() {
    var s = state.stats || {};
    var avg = fmtDurationMs(s.avg_first_response_ms);
    return (
      '<div class="cutup-support-kpis" role="list">' +
        renderKpi('📂', 'Open Tickets', s.open_count || 0, kpiTrend('open', s), false) +
        renderKpi('⏳', 'Waiting For You', s.waiting_count || 0, kpiTrend('waiting', s), false) +
        renderKpi('🔄', 'In Progress', s.in_progress_count || 0, kpiTrend('in_progress', s), false) +
        renderKpi('✅', 'Resolved', s.resolved_count || 0, kpiTrend('resolved', s), false) +
        renderKpi('⚡', 'Avg First Response', avg, kpiTrend('avg', s), true) +
      '</div>'
    );
  }

  function renderEmptyState() {
    return (
      '<div class="cutup-support-zero">' +
        '<div class="cutup-support-zero__illus" aria-hidden="true">' +
          '<svg width="120" height="96" viewBox="0 0 120 96" fill="none"><rect x="8" y="16" width="72" height="56" rx="12" fill="#EEF2FF" stroke="#C7D2FE"/><path d="M28 40h32M28 52h20" stroke="#818CF8" stroke-width="3" stroke-linecap="round"/><circle cx="88" cy="56" r="20" fill="#635BFF"/><path d="M82 56l4 4 8-8" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</div>' +
        '<h2>Need help?</h2>' +
        '<p>Our support team typically responds within 24 hours — urgent billing issues within 12 hours.</p>' +
        '<p class="cutup-support-zero__sla">Expected response: under 24h · Billing: under 12h</p>' +
        '<div class="cutup-support-zero__actions">' +
          btnPrimary('Create Ticket', 'id="cutupSupportCreateBtnEmpty"') +
          '<a href="#help" class="cutup-help-btn cutup-help-btn--secondary">Browse Help Center</a>' +
        '</div>' +
      '</div>'
    );
  }

  function slaBadge(t) {
    var st = String(t.sla_status || 'healthy').toLowerCase();
    if (st === 'healthy' && t.first_response_at) return '';
    var label = st === 'breached' ? 'SLA Breached' : st === 'at_risk' ? 'At Risk' : 'Healthy';
    return '<span class="cutup-support-sla cutup-support-sla--' + esc(st) + '">' + esc(label) + '</span>';
  }

  function renderIssueCard(t, compact) {
    return (
      '<button type="button" class="cutup-support-issue' + (compact ? ' cutup-support-issue--compact' : '') + '" data-ticket="' + esc(t.ticket_number) + '">' +
        '<div class="cutup-support-issue__top">' +
          '<span class="cutup-support-issue__id">' + esc(t.ticket_number) + '</span>' +
          '<span class="cutup-support-issue__badges">' + deptBadge(t.department) + statusBadge(t.status) + slaBadge(t) + '</span>' +
        '</div>' +
        '<h3 class="cutup-support-issue__subject">' + esc(t.subject || 'Support request') + '</h3>' +
        '<div class="cutup-support-issue__meta">' +
          '<span>Updated ' + esc(relTime(t.last_activity_at || t.updated_at)) + '</span>' +
          (!compact ? '<span aria-hidden="true">·</span><span>Created ' + esc(fmtDate(t.created_at)) + '</span>' : '') +
        '</div>' +
      '</button>'
    );
  }

  function activityLabel(item) {
    var map = {
      created: 'Ticket Created',
      assigned: 'Ticket Assigned',
      admin_reply: 'Ticket Replied',
      user_reply: 'You Replied',
      status_change: 'Status Changed',
    };
    return map[item.event_type] || String(item.event_type || '').replace(/_/g, ' ');
  }

  function activityIcon(type) {
    var map = { created: '🎫', assigned: '👤', admin_reply: '💬', user_reply: '↩️', status_change: '🔄' };
    return map[type] || '•';
  }

  function renderActivityFeed() {
    if (!state.activity.length) {
      return '<p class="cutup-support-activity-empty">No recent activity yet.</p>';
    }
    return (
      '<div class="cutup-support-activity" role="feed">' +
        state.activity.slice(0, 8).map(function (a) {
          return (
            '<button type="button" class="cutup-support-activity__item" data-ticket="' + esc(a.ticket_number) + '">' +
              '<span class="cutup-support-activity__icon" aria-hidden="true">' + activityIcon(a.event_type) + '</span>' +
              '<span class="cutup-support-activity__body">' +
                '<strong>' + esc(activityLabel(a)) + '</strong>' +
                '<span>' + esc(a.subject || a.ticket_number) + '</span>' +
                '<time>' + esc(relTime(a.created_at)) + '</time>' +
              '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderHomeGrid() {
    if (!state.tickets.length) return renderEmptyState();
    var recent = state.tickets.slice(0, 5);
    return (
      '<div class="cutup-support-home-grid">' +
        '<section class="cutup-support-panel">' +
          '<header class="cutup-support-panel__head"><h2>Recent Tickets</h2><a href="#" id="cutupSupportViewAll" class="cutup-support-panel__link">View all</a></header>' +
          '<div class="cutup-support-issues">' + recent.map(function (t) { return renderIssueCard(t, true); }).join('') + '</div>' +
        '</section>' +
        '<section class="cutup-support-panel">' +
          '<header class="cutup-support-panel__head"><h2>Support Activity</h2></header>' +
          renderActivityFeed() +
        '</section>' +
      '</div>'
    );
  }

  function renderCreatePanel() {
    return (
      '<section class="cutup-support-create-panel" id="cutupSupportCreatePanel"' + (state.createFormOpen ? '' : ' hidden') + '>' +
        '<div class="cutup-support-create-panel__head">' +
          '<div><h2>Create support ticket</h2><p>Tell us how we can help. We typically respond within 24 hours.</p></div>' +
          '<button type="button" class="cutup-support-create-panel__close" id="cutupSupportCreateClose" aria-label="Close form">×</button>' +
        '</div>' +
        '<form class="cutup-support-form" id="cutupSupportForm" novalidate>' +
          '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="cutup-support-honeypot">' +
          '<div class="cutup-support-form__grid">' +
            '<label>Department<select name="department" required>' +
              DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.value) + '">' + esc(d.label) + '</option>'; }).join('') +
            '</select></label>' +
            '<label>Priority<select name="priority" required>' +
              PRIORITIES.map(function (p) { return '<option value="' + esc(p.value) + '"' + (p.value === 'NORMAL' ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') +
            '</select></label>' +
          '</div>' +
          '<label>Subject<input name="subject" id="cutupSupportSubject" type="text" required minlength="3" maxlength="200" placeholder="Brief summary"></label>' +
          '<div id="cutupSupportDeflect" class="cutup-support-deflect" hidden></div>' +
          '<label>Message<textarea name="message" required minlength="10" maxlength="8000" placeholder="Describe your issue in detail…" rows="4"></textarea></label>' +
          '<div id="cutupSupportTurnstile" class="cf-turnstile" data-sitekey="' + esc(TURNSTILE_SITE_KEY) + '"></div>' +
          '<p id="cutupSupportFormError" class="cutup-support-form-error" hidden role="alert"></p>' +
          '<div class="cutup-support-form__actions">' +
            btnSecondary('Cancel', 'type="button" id="cutupSupportFormCancel" data-no-icon') +
            btnPrimary('Submit Ticket', 'type="submit" id="cutupSupportFormSubmit" data-no-icon') +
          '</div>' +
        '</form>' +
      '</section>'
    );
  }

  function renderListView() {
    return (
      '<div class="cutup-support-root">' +
        '<div class="cutup-support-head">' +
          '<div class="cutup-support-head__copy">' +
            '<h1 class="section-title">Support Center</h1>' +
            '<p class="dashboard-section-lead">Get help from the Cutup team.</p>' +
          '</div>' +
          btnPrimary('Create Ticket', 'id="cutupSupportCreateBtn"') +
        '</div>' +
        renderMetrics() +
        renderCreatePanel() +
        renderHomeGrid() +
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
    if (event.event_type === 'admin_reply') return 'Support replied';
    if (event.event_type === 'user_reply') return 'You replied';
    return String(event.event_type || 'update').replace(/_/g, ' ');
  }

  var INLINE_EVENT_TYPES = { created: 1, status_change: 1, assigned: 1 };

  function buildConversationTimeline(messages, events) {
    var items = [];
    (messages || []).forEach(function (m) {
      items.push({ kind: 'message', at: m.created_at, data: m });
    });
    (events || []).forEach(function (e) {
      if (!INLINE_EVENT_TYPES[e.event_type]) return;
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

  function renderAttachments(attachments) {
    if (!attachments?.length) return '';
    return (
      '<div class="cutup-support-attachments">' +
        attachments.map(function (a) {
          var isImg = String(a.mime || '').startsWith('image/');
          if (isImg) {
            return (
              '<a class="cutup-support-attach cutup-support-attach--img" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
                '<img src="' + esc(a.url) + '" alt="' + esc(a.filename) + '" loading="lazy">' +
              '</a>'
            );
          }
          if (String(a.mime || '').includes('pdf')) {
            return (
              '<a class="cutup-support-attach cutup-support-attach--pdf" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
                '<span>📄</span><span>' + esc(a.filename) + '</span><em>Download PDF</em>' +
              '</a>'
            );
          }
          return (
            '<a class="cutup-support-attach" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
              '<span>📎</span><span>' + esc(a.filename) + '</span>' +
            '</a>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderMessageBubble(m) {
    var isUser = m.sender_type === 'user';
    var who = isUser ? 'You' : (m.sender_name || m.sender_email || 'Cutup Support');
    var side = isUser ? 'cutup-support-msg--user' : 'cutup-support-msg--admin';
    var avatar = avatarUrl(who, isUser);
    var attach = Array.isArray(m.attachments) ? m.attachments : null;
    return (
      '<article class="cutup-support-msg ' + side + '">' +
        '<img class="cutup-support-msg__avatar" src="' + esc(avatar) + '" alt="" width="36" height="36" loading="lazy" decoding="async">' +
        '<div class="cutup-support-msg__body">' +
          '<header class="cutup-support-msg__head">' +
            '<span class="cutup-support-msg__name">' + esc(who) + '</span>' +
            '<time class="cutup-support-msg__time" datetime="' + esc(m.created_at) + '" title="' + esc(fmtDate(m.created_at)) + '">' + esc(fmtDate(m.created_at)) + '</time>' +
          '</header>' +
          '<div class="cutup-support-msg__bubble">' +
            (m.message ? esc(m.message) : '') +
            renderAttachments(attach) +
          '</div>' +
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

  function timelineIcon(type) {
    var map = {
      created: '🎫', assigned: '👤', status_change: '🔄',
      admin_reply: '💬', user_reply: '↩️', internal_note: '📝',
    };
    return map[type] || '•';
  }

  function renderTimeline(events) {
    var all = (events || []).slice().sort(function (a, b) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    if (!all.length) return '<p class="cutup-support-timeline-empty">No timeline events.</p>';
    return (
      '<ol class="cutup-support-timeline">' +
        all.map(function (e, i) {
          var last = i === all.length - 1;
          return (
            '<li class="cutup-support-timeline__item' + (last ? ' is-last' : '') + '">' +
              '<span class="cutup-support-timeline__dot" aria-hidden="true">' + timelineIcon(e.event_type) + '</span>' +
              '<div class="cutup-support-timeline__body">' +
                '<strong>' + esc(eventLabel(e)) + '</strong>' +
                '<time datetime="' + esc(e.created_at) + '">' + esc(fmtDate(e.created_at)) + '</time>' +
              '</div>' +
            '</li>'
          );
        }).join('') +
      '</ol>'
    );
  }

  function closedBanner(ticket) {
    if (!['CLOSED', 'RESOLVED'].includes(ticket.status)) return '';
    var msg;
    if (ticket.status === 'CLOSED') {
      if (ticket.closed_by === 'admin') {
        msg = 'This ticket was closed by Cutup support' + (ticket.closed_at ? ' on ' + fmtDate(ticket.closed_at) : '') + '. Open a new ticket if you need more help.';
      } else {
        msg = 'You closed this ticket' + (ticket.closed_at ? ' on ' + fmtDate(ticket.closed_at) : '') + '.';
      }
    } else {
      msg = 'This ticket is resolved. You can still reply or close it below.';
    }
    return (
      '<div class="cutup-support-status-banner cutup-support-status-banner--' + esc(String(ticket.status).toLowerCase()) + '" role="status">' +
        '<strong>' + esc(formatStatusLabel(ticket.status)) + '</strong>' +
        '<p>' + esc(msg) + '</p>' +
      '</div>'
    );
  }

  function renderRatingPicker(selected) {
    return (
      '<div class="cutup-support-rating" role="radiogroup" aria-label="Rate support experience">' +
        RATING_OPTIONS.map(function (opt) {
          var active = selected === opt.score ? ' is-selected' : '';
          return (
            '<button type="button" class="cutup-support-rating__opt' + active + '" data-rating="' + opt.score + '" title="' + esc(opt.label) + '" aria-label="' + esc(opt.label) + '">' +
              '<span class="cutup-support-rating__emoji" aria-hidden="true">' + opt.emoji + '</span>' +
              '<span class="cutup-support-rating__score">' + opt.score + '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderCloseSection(ticket) {
    if (ticket.status === 'CLOSED') {
      if (ticket.satisfaction_rating) {
        return (
          '<div class="cutup-support-close-card cutup-support-close-card--done">' +
            '<p>Thanks for your feedback <span class="cutup-support-rating__emoji" aria-hidden="true">' + ratingEmoji(ticket.satisfaction_rating) + '</span></p>' +
          '</div>'
        );
      }
      return '';
    }
    return (
      '<section class="cutup-support-close-card">' +
        '<h3>Close this ticket</h3>' +
        '<p>How satisfied are you with the support you received?</p>' +
        renderRatingPicker(state.selectedRating) +
        '<div class="cutup-support-close-card__actions">' +
          btnPrimary('Close Ticket', 'id="cutupSupportCloseTicket" data-no-icon') +
        '</div>' +
        '<p id="cutupSupportCloseError" class="cutup-support-form-error" hidden role="alert"></p>' +
      '</section>'
    );
  }

  function renderDetailView(ticket, messages, events) {
    var closed = ticket.status === 'CLOSED';
    var composer = closed
      ? ''
      : '<div class="cutup-support-reply">' +
          '<label for="cutupSupportReply">Reply</label>' +
          '<div id="cutupSupportAttachPreview" class="cutup-support-attach-preview" hidden></div>' +
          '<div class="cutup-support-reply__row">' +
            '<textarea id="cutupSupportReply" placeholder="Write a reply…" rows="3"></textarea>' +
            '<div class="cutup-support-reply__actions">' +
              '<label class="cutup-support-attach-btn" title="Attach file">' +
                '<input type="file" id="cutupSupportFile" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.zip" hidden>' +
                ICON_CLIP +
              '</label>' +
              btnPrimary('Send', 'id="cutupSupportSendReply" data-no-icon') +
            '</div>' +
          '</div>' +
        '</div>';
    return (
      '<div class="cutup-support-detail">' +
        btnSecondary('← All tickets', 'id="cutupSupportBack" data-no-icon') +
        '<div class="cutup-support-detail__layout">' +
          '<div class="cutup-support-detail__main">' +
            '<header class="cutup-support-detail__header">' +
              '<h1 class="section-title">' + esc(ticket.subject) + '</h1>' +
              '<div class="cutup-support-meta">' +
                '<strong>' + esc(ticket.ticket_number) + '</strong>' +
                statusBadge(ticket.status) +
                priorityBadge(ticket.priority) +
                deptBadge(ticket.department) +
                slaBadge(ticket) +
                '<span>Created ' + esc(fmtDate(ticket.created_at)) + '</span>' +
                (ticket.assigned_admin_email ? '<span>' + esc(ticket.assigned_admin_email) + '</span>' : '') +
              '</div>' +
            '</header>' +
            closedBanner(ticket) +
            '<div class="cutup-support-timeline-mobile">' +
              '<h3>Timeline</h3>' + renderTimeline(events) +
            '</div>' +
            '<div class="cutup-support-conversation">' +
              '<div class="cutup-support-thread" id="cutupSupportThread">' + renderConversation(messages, events) + '</div>' +
              composer +
              renderCloseSection(ticket) +
            '</div>' +
          '</div>' +
          '<aside class="cutup-support-detail__sidebar">' +
            '<div class="cutup-support-sidebar-card">' +
              '<h3>Ticket Timeline</h3>' + renderTimeline(events) +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</div>'
    );
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

  function toggleCreateForm(open) {
    state.createFormOpen = open !== false;
    var panel = document.getElementById('cutupSupportCreatePanel');
    if (panel) panel.hidden = !state.createFormOpen;
    if (!state.createFormOpen) {
      if (window.turnstile) {
        try { window.turnstile.reset(); } catch (_e) { /* noop */ }
      }
      return;
    }
    var err = document.getElementById('cutupSupportFormError');
    if (err) err.hidden = true;
    panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  function bindCreateForm(root) {
    bindDeflection();
    root.querySelector('#cutupSupportCreateBtn')?.addEventListener('click', function () {
      toggleCreateForm(!state.createFormOpen);
    });
    root.querySelector('#cutupSupportCreateBtnEmpty')?.addEventListener('click', function () {
      toggleCreateForm(true);
    });
    root.querySelector('#cutupSupportCreateClose')?.addEventListener('click', function () {
      toggleCreateForm(false);
    });
    root.querySelector('#cutupSupportFormCancel')?.addEventListener('click', function () {
      toggleCreateForm(false);
    });

    root.querySelector('#cutupSupportForm')?.addEventListener('submit', async function (e) {
      e.preventDefault();
      var form = e.target;
      var errEl = document.getElementById('cutupSupportFormError');
      var submitBtn = document.getElementById('cutupSupportFormSubmit');
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
      toggleCreateForm(false);
      form.reset();
      window.CutupDashboardNotifications?.refreshUnreadCount?.();
      if (res.data?.ticket?.ticket_number) {
        navigateToTicket(res.data.ticket.ticket_number);
      } else {
        navigateToList();
      }
    });
  }

  function bindListEvents(root) {
    bindCreateForm(root);
    root.querySelectorAll('[data-ticket]').forEach(function (row) {
      row.addEventListener('click', function () {
        navigateToTicket(row.getAttribute('data-ticket'));
      });
    });
    root.querySelectorAll('.cutup-support-activity__item[data-ticket]').forEach(function (row) {
      row.addEventListener('click', function () {
        navigateToTicket(row.getAttribute('data-ticket'));
      });
    });
  }

  function bindDeflection() {
    var subject = document.getElementById('cutupSupportSubject');
    var host = document.getElementById('cutupSupportDeflect');
    if (!subject || !host || subject.dataset.bound === '1') return;
    subject.dataset.bound = '1';
    var timer;
    subject.addEventListener('input', function () {
      clearTimeout(timer);
      var q = subject.value.trim();
      if (q.length < 3) {
        host.hidden = true;
        return;
      }
      timer = setTimeout(async function () {
        var articles = await (window.CutupDashboardHelp?.searchArticles?.(q, 3) || Promise.resolve([]));
        if (!articles.length) {
          host.hidden = true;
          return;
        }
        host.hidden = false;
        host.innerHTML =
          '<p class="cutup-support-deflect__title">Suggested articles</p>' +
          articles.map(function (a) {
            return (
              '<a href="#help/' + esc(a.slug) + '" class="cutup-support-deflect__item">' +
                '<strong>' + esc(a.title) + '</strong>' +
                '<span>' + esc(a.summary) + '</span>' +
              '</a>'
            );
          }).join('');
      }, 320);
    });
  }

  async function uploadAttachment(file) {
    var fd = new FormData();
    fd.append('file', file);
    var r = await fetch(apiBase() + '/api/support/attachments', {
      method: 'POST',
      credentials: 'include',
      headers: sessionHeaders(),
      body: fd,
    });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function bindDetailEvents(root, ticketNumber) {
    state.pendingAttachments = [];
    state.selectedRating = 0;
    root.querySelector('#cutupSupportBack')?.addEventListener('click', navigateToList);

    root.querySelectorAll('[data-rating]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedRating = Number(btn.getAttribute('data-rating')) || 0;
        root.querySelectorAll('[data-rating]').forEach(function (b) {
          b.classList.toggle('is-selected', b === btn);
        });
        var err = document.getElementById('cutupSupportCloseError');
        if (err) err.hidden = true;
      });
    });

    root.querySelector('#cutupSupportCloseTicket')?.addEventListener('click', async function () {
      var err = document.getElementById('cutupSupportCloseError');
      if (!state.selectedRating) {
        if (err) {
          err.textContent = 'Please select a satisfaction rating before closing.';
          err.hidden = false;
        }
        return;
      }
      var btn = document.getElementById('cutupSupportCloseTicket');
      if (btn) btn.disabled = true;
      var res = await apiPost('/api/support/tickets', {
        action: 'close',
        ticketNumber: ticketNumber,
        satisfactionRating: state.selectedRating,
      });
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (err) {
          err.textContent = res.data?.error === 'already_closed' ? 'This ticket is already closed.' : 'Could not close ticket. Try again.';
          err.hidden = false;
        }
        return;
      }
      void mount(ticketNumber);
    });
    var fileInput = document.getElementById('cutupSupportFile');
    var preview = document.getElementById('cutupSupportAttachPreview');
    fileInput?.addEventListener('change', async function () {
      var file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) {
        if (typeof showDashboardBanner === 'function') showDashboardBanner('File must be under 20 MB.', 'error');
        fileInput.value = '';
        return;
      }
      var up = await uploadAttachment(file);
      fileInput.value = '';
      if (!up.ok) {
        if (typeof showDashboardBanner === 'function') showDashboardBanner('Upload failed. Try again.', 'error');
        return;
      }
      state.pendingAttachments = [up.data.attachment];
      if (preview) {
        preview.hidden = false;
        preview.innerHTML = '<span>📎 ' + esc(up.data.attachment.filename) + '</span> <button type="button" id="cutupSupportClearAttach">Remove</button>';
        preview.querySelector('#cutupSupportClearAttach')?.addEventListener('click', function () {
          state.pendingAttachments = [];
          preview.hidden = true;
          preview.innerHTML = '';
        });
      }
    });
    root.querySelector('#cutupSupportSendReply')?.addEventListener('click', async function () {
      var ta = document.getElementById('cutupSupportReply');
      var msg = ta?.value?.trim();
      if (!msg && !state.pendingAttachments.length) return;
      var btn = document.getElementById('cutupSupportSendReply');
      if (btn) btn.disabled = true;
      var res = await apiPost('/api/support/tickets', {
        action: 'reply',
        ticketNumber: ticketNumber,
        message: msg || '',
        attachments: state.pendingAttachments.length ? state.pendingAttachments : undefined,
      });
      if (btn) btn.disabled = false;
      if (!res.ok) {
        if (typeof showDashboardBanner === 'function') {
          showDashboardBanner('Could not send reply. Try again.', 'error');
        }
        return;
      }
      if (ta) ta.value = '';
      state.pendingAttachments = [];
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
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

  async function loadActivity() {
    var res = await apiGet('/api/support/tickets?action=activity&limit=12');
    if (res.ok) state.activity = res.data.activity || [];
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
      void window.CutupDashboardNotifications?.markTicketRead?.(ticketNumber);
      void window.CutupDashboardNotifications?.refreshUnreadCount?.();
      return;
    }

    state.view = 'list';
    state.ticketNumber = null;
    await Promise.all([loadOverview(), loadList(), loadActivity()]);
    state.loading = false;
    root.innerHTML = renderListView();
    bindListEvents(root);
    maybeOpenCreateFromSession();
  }

  function maybeOpenCreateFromSession() {
    try {
      if (sessionStorage.getItem('cutup_open_support_modal') === '1') {
        sessionStorage.removeItem('cutup_open_support_modal');
        toggleCreateForm(true);
      }
    } catch (_e) { /* noop */ }
  }

  window.CutupDashboardSupport = {
    parseSupportHash: parseSupportHash,
    mount: mount,
    navigateToList: navigateToList,
    navigateToTicket: navigateToTicket,
    openCreateTicket: function () { toggleCreateForm(true); },
  };

  window.addEventListener('hashchange', function () {
    var route = parseSupportHash(window.location.hash);
    if (!route) return;
    var active = document.getElementById('support-section')?.classList.contains('active');
    if (active) void mount(route.ticket);
  });
})();
