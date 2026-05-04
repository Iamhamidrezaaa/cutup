/**
 * Central client audit pipeline: POST /api/audit/event
 * Exposes window.trackEvent(name, metadata?, eventType?)
 */
(function cutupAuditTrack() {
  function getApiBase() {
    try {
      if (typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined') {
        return String(window.CUTUP_API_BASE || '').replace(/\/$/, '');
      }
      const o =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : '';
      if (o && (o.indexOf('localhost') !== -1 || o.indexOf('127.0.0.1') !== -1)) {
        return 'http://localhost:3001';
      }
      return o.replace(/\/$/, '');
    } catch (_e) {
      return '';
    }
  }

  function getSessionId() {
    try {
      return localStorage.getItem('cutup_session');
    } catch (_e) {
      return null;
    }
  }

  var AX_PAIR_KEY = 'cutup_ax_auth_pair';

  function getAnalyticsSessionId() {
    try {
      var authSid = getSessionId() || '';
      var guestKey = authSid ? authSid : '_guest_';
      var prev = sessionStorage.getItem(AX_PAIR_KEY);
      if (prev !== guestKey) {
        sessionStorage.setItem(AX_PAIR_KEY, guestKey);
        var id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'ax-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('cutup_analytics_session', id);
        return id;
      }
      var existing = localStorage.getItem('cutup_analytics_session');
      if (!existing) {
        existing =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'ax-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
        localStorage.setItem('cutup_analytics_session', existing);
      }
      return existing;
    } catch (_e) {
      return null;
    }
  }

  function send(name, metadata, eventType) {
    const base = getApiBase();
    if (!base) return;
    const ax = getAnalyticsSessionId();
    const payload = {
      event_name: String(name || '').slice(0, 128),
      event_type: eventType != null ? String(eventType).slice(0, 64) : 'ui',
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      analytics_session_id: ax,
      path:
        typeof location !== 'undefined'
          ? `${location.pathname || ''}${location.search || ''}`.slice(0, 2048)
          : '',
      referrer: typeof document !== 'undefined' ? String(document.referrer || '').slice(0, 2048) : ''
    };
    const headers = { 'Content-Type': 'application/json' };
    const sid = getSessionId();
    if (sid) headers['X-Session-Id'] = sid;
    if (ax) headers['X-Analytics-Session-Id'] = ax;
    fetch(`${base}/api/audit/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }

  function trackEvent(name, metadata, eventType) {
    send(name, metadata, eventType);
  }

  if (typeof window !== 'undefined') {
    window.trackEvent = trackEvent;
    window.trackAuditEvent = trackEvent;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      trackEvent(
        'page_view',
        { title: document.title || '', href: String(location.href || '').slice(0, 500) },
        'product'
      );
    });

    window.addEventListener('error', function (ev) {
      trackEvent(
        'js_error',
        {
          message: String(ev.message || '').slice(0, 500),
          file: String(ev.filename || '').slice(0, 500),
          line: ev.lineno || 0,
          col: ev.colno || 0
        },
        'error'
      );
    });

    document.addEventListener(
      'click',
      function (ev) {
        const t = ev.target && ev.target.closest && ev.target.closest('[data-track]');
        if (!t) return;
        const name = t.getAttribute('data-track');
        if (!name) return;
        trackEvent(
          'click',
          { target: name, tag: t.tagName, id: t.id || null },
          'ui'
        );
      },
      true
    );
  }
})();
