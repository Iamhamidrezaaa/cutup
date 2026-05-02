/**
 * Inline conversion reminders (no modal): email CTA tracking, idle nudge, payment-failed hint.
 */
(function () {
  function stripEmailClickParams() {
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get('cutup_ec') !== '1') return;
      var t = u.searchParams.get('t');
      if (typeof sendAnalyticsEvent === 'function') {
        var sid = null;
        try {
          sid = localStorage.getItem('cutup_session');
        } catch (_e) {
          sid = null;
        }
        sendAnalyticsEvent('email_clicked', { plan: t || null, sessionId: sid });
      }
      u.searchParams.delete('cutup_ec');
      u.searchParams.delete('t');
      var qs = u.searchParams.toString();
      window.history.replaceState({}, '', u.pathname + (qs ? '?' + qs : '') + (u.hash || ''));
    } catch (_e) {
      /* noop */
    }
  }

  function hasRecentPaymentFailure() {
    try {
      var raw = localStorage.getItem('cutup_payment_failed_at');
      if (!raw) return false;
      var t = Number(raw);
      return !!(t && Date.now() - t < 7 * 24 * 60 * 60 * 1000);
    } catch (_e) {
      return false;
    }
  }

  function mountPaymentFailedBanner(host) {
    try {
      if (sessionStorage.getItem('cutup_payfail_banner_ok') === '1') return;
      if (!hasRecentPaymentFailure()) return;
      host.hidden = false;
      host.className = 'cutup-inline-notify cutup-inline-notify--warn';
      host.setAttribute('role', 'status');
      host.innerHTML =
        '<div class="cutup-inline-notify__inner"><p class="cutup-inline-notify__text">Payment didn’t go through — you can try again from your plan. If we emailed you, use the link when you’re ready.</p><button type="button" class="cutup-inline-notify__close" aria-label="Dismiss">×</button></div>';
      host.querySelector('.cutup-inline-notify__close').addEventListener('click', function () {
        host.hidden = true;
        try {
          sessionStorage.setItem('cutup_payfail_banner_ok', '1');
        } catch (_e2) {
          /* noop */
        }
      });
    } catch (_e) {
      /* noop */
    }
  }

  function initIdleBanner(host, options) {
    var idleMs = (options && options.idleMs) || 120000;
    var ctaHref = (options && options.ctaHref) || '#tool';
    var isEligible = options && options.isEligible;
    var timer = null;
    function clearT() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    function schedule() {
      clearT();
      timer = setTimeout(showIdle, idleMs);
    }
    function showIdle() {
      timer = null;
      try {
        if (sessionStorage.getItem('cutup_idle_banner_ok') === '1') return;
        if (hasRecentPaymentFailure() && sessionStorage.getItem('cutup_payfail_banner_ok') !== '1') return;
        if (isEligible && !isEligible()) return;
        if (host.classList.contains('cutup-inline-notify--warn') && !host.hidden) return;
        host.hidden = false;
        host.className = 'cutup-inline-notify cutup-inline-notify--idle';
        host.setAttribute('role', 'region');
        host.innerHTML =
          '<div class="cutup-inline-notify__inner"><p class="cutup-inline-notify__text">Still there? Pick up where you left off in the tool.</p><a class="cutup-inline-notify__cta" href="' +
          ctaHref +
          '">Open tool</a><button type="button" class="cutup-inline-notify__close" aria-label="Dismiss">×</button></div>';
        host.querySelector('.cutup-inline-notify__close').addEventListener('click', function () {
          host.hidden = true;
          try {
            sessionStorage.setItem('cutup_idle_banner_ok', '1');
          } catch (_e) {
            /* noop */
          }
        });
      } catch (_e2) {
        /* noop */
      }
    }
    function reset() {
      schedule();
    }
    ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
      document.addEventListener(ev, reset, { passive: true });
    });
    schedule();
  }

  var __cutupConversionBannersMounted = false;

  function run(mode) {
    stripEmailClickParams();
    var host = document.getElementById('cutupInlineNotify');
    if (!host) return;
    mountPaymentFailedBanner(host);
    if (mode === 'dashboard') {
      initIdleBanner(host, {
        idleMs: 180000,
        ctaHref: 'index.html#tool',
        isEligible: function () { return true; }
      });
    } else {
      initIdleBanner(host, {
        idleMs: 120000,
        ctaHref: '#tool',
        isEligible: function () {
          var rs = document.getElementById('resultSection');
          return !!(rs && rs.style.display !== 'none');
        }
      });
    }
  }

  if (typeof window !== 'undefined') {
    window.cutupInitConversionBanners = function (opts) {
      if (__cutupConversionBannersMounted) return;
      __cutupConversionBannersMounted = true;
      run((opts && opts.mode) || 'landing');
    };
  }

  if (typeof document !== 'undefined') {
    function auto() {
      if (!document.getElementById('cutupInlineNotify')) return;
      if (document.querySelector('.dashboard-container')) return;
      if (typeof window.cutupInitConversionBanners === 'function') {
        window.cutupInitConversionBanners({ mode: 'landing' });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', auto);
    } else {
      auto();
    }
  }
})();
