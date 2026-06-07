/**
 * Reusable activity timeline renderer for dashboard sections.
 */
(function () {
  'use strict';

  var EVENT_ICONS = {
    transcript_created: '📝',
    translation_created: '🌐',
    subtitle_generated: '💬',
    mp4_export_generated: '🎬',
    output_downloaded: '⬇️',
    project_deleted: '🗑️',
    plan_upgraded: '⬆️',
    subscription_renewed: '🔄',
    payment_successful: '✅',
    payment_failed: '❌',
    credits_reset: '🔁'
  };

  var PROCESSING_TYPES = new Set([
    'transcript_created',
    'translation_created',
    'subtitle_generated',
    'mp4_export_generated',
    'output_downloaded',
    'project_deleted'
  ]);

  var BILLING_TYPES = new Set([
    'plan_upgraded',
    'subscription_renewed',
    'payment_successful',
    'payment_failed',
    'credits_reset'
  ]);

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatRelativeTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    var diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return 'Just now';
    var mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hours / 24);
    if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
    var months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? ' month ago' : ' months ago');
    var years = Math.floor(months / 12);
    return years + (years === 1 ? ' year ago' : ' years ago');
  }

  function formatDetailHtml(description) {
    if (!description) return '';
    return String(description)
      .split('\n')
      .map(function (line) { return esc(line); })
      .join('<br>');
  }

  function renderCard(event) {
    var icon = EVENT_ICONS[event.eventType] || '•';
    var when = formatRelativeTime(event.createdAt);
    var title = esc(event.title || event.eventType || 'Activity');
    var detail = event.description
      ? '<p class="af-card__detail">' + formatDetailHtml(event.description) + '</p>'
      : '';
    return (
      '<li class="af-card">' +
        '<span class="af-card__icon" aria-hidden="true">' + icon + '</span>' +
        '<div class="af-card__body">' +
          '<div class="af-card__head">' +
            '<strong class="af-card__title">' + title + '</strong>' +
            '<time class="af-card__time" datetime="' + esc(event.createdAt || '') + '">' + esc(when) + '</time>' +
          '</div>' +
          detail +
        '</div>' +
      '</li>'
    );
  }

  function filterEvents(events, category) {
    var list = Array.isArray(events) ? events : [];
    if (category === 'processing') {
      return list.filter(function (e) { return PROCESSING_TYPES.has(e.eventType); });
    }
    if (category === 'billing') {
      return list.filter(function (e) { return BILLING_TYPES.has(e.eventType); });
    }
    return list;
  }

  function renderTimeline(container, events, options) {
    if (!container) return;
    var opts = options || {};
    var limit = opts.limit || 10;
    var category = opts.category || 'all';
    var emptyMessage = opts.emptyMessage || 'No activity yet.';
    var filtered = filterEvents(events, category).slice(0, limit);

    if (!filtered.length) {
      container.innerHTML = '<div class="af-empty">' + esc(emptyMessage) + '</div>';
      return;
    }

    container.innerHTML = '<ul class="af-timeline">' + filtered.map(renderCard).join('') + '</ul>';
  }

  window.CutupActivityFeed = {
    renderTimeline: renderTimeline,
    formatRelativeTime: formatRelativeTime,
    filterEvents: filterEvents,
    PROCESSING_TYPES: PROCESSING_TYPES,
    BILLING_TYPES: BILLING_TYPES
  };
})();
