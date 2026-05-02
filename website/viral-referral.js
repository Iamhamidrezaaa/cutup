/**
 * Lightweight referral + share (inline only). Does not change billing/subscription.
 */
(function () {
  const REFERRED_BY_KEY = 'cutup_referred_by';
  const REFERRAL_CODE_KEY = 'cutup_referral_code';
  const USAGE_STATS_KEY = 'cutup_usage_stats';
  const VIRAL_BOUND_KEY = 'cutup_viral_ui_bound';

  function getCutupSiteOrigin() {
    try {
      if (window.location && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
    } catch (_e) {
      /* noop */
    }
    return 'https://cutup.shop';
  }

  function initCutupReferralFromUrl() {
    try {
      const u = new URL(window.location.href);
      const ref = u.searchParams.get('ref');
      if (!ref) return;
      const v = String(ref).trim().slice(0, 64);
      if (!v) return;
      localStorage.setItem(REFERRED_BY_KEY, v);
      u.searchParams.delete('ref');
      const qs = u.searchParams.toString();
      window.history.replaceState({}, '', u.pathname + (qs ? '?' + qs : '') + (u.hash || ''));
    } catch (_e) {
      /* noop */
    }
  }

  function bootReferralFromUrl() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCutupReferralFromUrl);
    } else {
      initCutupReferralFromUrl();
    }
  }

  function getOrCreateReferralCode() {
    try {
      let c = localStorage.getItem(REFERRAL_CODE_KEY);
      if (c && /^[a-zA-Z0-9._-]{6,80}$/.test(c)) return c;
      let g = localStorage.getItem('cutup_guest_id');
      if (g && String(g).length >= 8 && /^[a-zA-Z0-9._-]{6,80}$/.test(String(g))) {
        localStorage.setItem(REFERRAL_CODE_KEY, g);
        return g;
      }
      c =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 24)
          : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(REFERRAL_CODE_KEY, c);
      return c;
    } catch (_e) {
      return 'ref';
    }
  }

  function buildReferralUrl() {
    const code = encodeURIComponent(getOrCreateReferralCode());
    return getCutupSiteOrigin() + '/?ref=' + code;
  }

  function readUsageTotal() {
    try {
      const raw = localStorage.getItem(USAGE_STATS_KEY);
      if (!raw) return 0;
      const o = JSON.parse(raw);
      return Number(o.totalUses) || 0;
    } catch (_e) {
      return 0;
    }
  }

  function bindViralControlsOnce() {
    if (sessionStorage.getItem(VIRAL_BOUND_KEY) === '1') return;
    sessionStorage.setItem(VIRAL_BOUND_KEY, '1');

    const copyBtn = document.getElementById('cutupViralCopyBtn');
    const shareBtn = document.getElementById('cutupViralShareBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const url = buildReferralUrl();
        const onOk = function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () {
            copyBtn.textContent = 'Copy link';
          }, 2000);
        };
        const hint = document.getElementById('cutupViralCopyHint');
        const showFallback = function () {
          if (hint) {
            hint.textContent = url;
            hint.hidden = false;
          }
          copyBtn.textContent = 'Select link below';
          setTimeout(function () {
            copyBtn.textContent = 'Copy link';
          }, 4000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            if (hint) hint.hidden = true;
            onOk();
          }).catch(showFallback);
        } else {
          showFallback();
        }
      });
    }
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        const url = buildReferralUrl();
        const title = 'Try Cutup for subtitles & transcripts';
        const text = 'I use Cutup for AI subtitles and transcripts — here is my invite link.';
        if (typeof navigator !== 'undefined' && navigator.share) {
          navigator.share({ title: title, text: text, url: url }).catch(function () {});
        } else {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).catch(function () {});
          }
        }
      });
    }
  }

  function showViralReferralAfterResult() {
    const block = document.getElementById('cutupViralReferralBlock');
    if (!block) return;
    bindViralControlsOnce();
    const sub = document.getElementById('cutupViralSub');
    const uses = readUsageTotal();
    if (sub) {
      sub.hidden = uses < 2;
    }
    block.hidden = false;
    if (shareBtnVisibility()) {
      const shareBtn = document.getElementById('cutupViralShareBtn');
      if (shareBtn) shareBtn.hidden = false;
    } else {
      const shareBtn = document.getElementById('cutupViralShareBtn');
      if (shareBtn) shareBtn.hidden = true;
    }
  }

  function shareBtnVisibility() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  function maybeTrackReferralSignup() {
    try {
      const sid = localStorage.getItem('cutup_session');
      if (!sid) return;
      const ref = localStorage.getItem(REFERRED_BY_KEY);
      if (!ref || String(ref).length < 4) return;
      const dedupeKey = 'cutup_referral_signup_sent:' + ref;
      if (localStorage.getItem(dedupeKey) === '1') return;
      if (typeof sendAnalyticsEvent !== 'function') return;
      sendAnalyticsEvent('referral_signup', { referrer: String(ref).slice(0, 64), sessionId: sid });
      try {
        localStorage.setItem(dedupeKey, '1');
      } catch (_e2) {
        /* noop */
      }
    } catch (_e) {
      /* noop */
    }
  }

  bootReferralFromUrl();

  if (typeof window !== 'undefined') {
    window.cutupShowViralReferralAfterResult = showViralReferralAfterResult;
    window.cutupMaybeTrackReferralSignup = maybeTrackReferralSignup;
    window.cutupBuildReferralUrl = buildReferralUrl;
  }
})();
