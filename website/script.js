// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

(function setupRootHashLinks() {
  function isHomePathname() {
    const p = (window.location.pathname || '/').replace(/\/$/, '') || '/';
    return p === '/';
  }
  function bindHomeHashNav(anchor) {
    anchor.addEventListener('click', function (e) {
      let hash = '';
      try {
        const u = new URL(this.getAttribute('href'), window.location.origin);
        if (u.origin !== window.location.origin) return;
        const path = (u.pathname || '/').replace(/\/$/, '') || '/';
        if (path !== '/') return;
        hash = u.hash;
      } catch (_err) {
        return;
      }
      if (!hash || !isHomePathname()) return;
      e.preventDefault();
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
          history.replaceState(null, '', hash);
        } catch (_e2) {
          /* ignore */
        }
      }
    });
  }
  document.querySelectorAll('a[href^="/#"]').forEach(bindHomeHashNav);
  document.querySelectorAll('a[href*="#"]').forEach((anchor) => {
    const h = anchor.getAttribute('href');
    if (!h || h.startsWith('/#')) return;
    try {
      const u = new URL(h, window.location.origin);
      if (u.origin !== window.location.origin) return;
      if (!u.hash) return;
      const path = (u.pathname || '/').replace(/\/$/, '') || '/';
      if (path !== '/') return;
    } catch (_e) {
      return;
    }
    bindHomeHashNav(anchor);
  });
})();

function initCutupFaqAccordion() {
  const root = document.getElementById('faqAccordion');
  if (!root) return;
  const items = Array.from(root.querySelectorAll('.faq-item'));
  items.forEach((item) => {
    const btn = item.querySelector('[data-faq-btn]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const opening = !item.classList.contains('active');
      items.forEach((i) => {
        i.classList.remove('active');
        const b = i.querySelector('[data-faq-btn]');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (opening) {
        item.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

// Add scroll animation
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Observe feature cards and steps
document.querySelectorAll('.feature-card, .step').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.6s, transform 0.6s';
  observer.observe(el);
});

// Auth functionality
const API_BASE_URL =
  typeof window !== 'undefined' && typeof window.CUTUP_API_BASE !== 'undefined' ? window.CUTUP_API_BASE : '';
const DASHBOARD_HISTORY_KEY = 'cutup_dashboard_history'; // Shared key for localStorage
let currentSession = null;

/** Backend still meters in minutes; users see video-sized chunks (~5–10 min typical). */
const AVG_VIDEO_MINUTES = 7;

function videosUsedEstimate(usedMinutes) {
  return Math.max(0, Math.ceil((Number(usedMinutes) || 0) / AVG_VIDEO_MINUTES));
}

function videosRemainingEstimate(usedMinutes, limitMinutes) {
  const remMin = Math.max(0, (Number(limitMinutes) || 0) - (Number(usedMinutes) || 0));
  return Math.floor(remMin / AVG_VIDEO_MINUTES);
}

/** Consistent user-facing error when we cannot complete an action (no raw stack traces). */
const USER_ERROR_GENERIC = 'We couldn\'t finish that. Wait a moment and try again.';

/** Plan verification failed (subscription check unreachable). */
const USER_PLAN_VERIFY_FAIL = 'We couldn\'t verify your plan. Check your connection, refresh the page, and try again.';

/** When limit API returns no reason string (should be rare). */
const LIMIT_UPGRADE_FALLBACK = 'You\'ve hit your plan limit. Upgrade to keep processing videos.';

/** Rewrite API limit strings — conversion-focused, no raw billing jargon. */
function humanizeLimitReason(reason) {
  if (!reason || typeof reason !== 'string') {
    return 'You\'re one step away from uninterrupted subtitles—upgrade to keep going.';
  }
  if (/Daily limit reached/i.test(reason)) {
    return 'You\'ve hit today\'s free preview cap. Upgrade now and finish this project today—or try again tomorrow.';
  }
  if (/Monthly limit reached/i.test(reason)) {
    return 'You\'re out of free video allowance this month. Unlock a paid plan and get full SRTs + deeper limits before your next deadline.';
  }
  if (/download limit/i.test(reason)) {
    return 'You\'ve used this month\'s download allowance. Upgrade to grab more files without waiting for reset.';
  }
  if (/not available on your current plan/i.test(reason)) {
    return 'This export needs a paid plan—you\'re one step away from full subtitles and pro workflows.';
  }
  if (/past due/i.test(reason)) {
    return 'Your subscription payment needs attention. Update your billing details to continue.';
  }
  if (/expired/i.test(reason)) {
    return 'Your subscription has expired. Renew to keep processing videos.';
  }
  if (/Billing system unavailable/i.test(reason)) {
    return USER_PLAN_VERIFY_FAIL;
  }
  if (/Unable to verify your plan/i.test(reason)) {
    return USER_PLAN_VERIFY_FAIL;
  }
  return 'We can\'t run that on your current plan. Upgrade to unlock the full workflow—or try again later.';
}

/** Lightweight viral line for SRT preview & exports (client-side only). */
const CUTUP_SRT_ATTRIBUTION = '\n# Generated by Cutup — https://cutup.shop\n';

/** Enable: localStorage.setItem('cutup_debug_lang','1'). Logs only language codes and lengths (no transcript text). */
function cutupLangDebug(payload) {
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem('cutup_debug_lang') !== '1') return;
    console.log('[Cutup/lang]', payload);
  } catch (e) {
    /* ignore */
  }
}

function getResultCopyText() {
  const active = document.querySelector('#resultSection .tab-content.active');
  if (!active) return '';
  const tabId = active.id;
  if (tabId === 'summary-tab') {
    return (document.getElementById('summaryText')?.innerText || '').trim();
  }
  if (tabId === 'fulltext-tab') {
    return (document.getElementById('fulltext')?.textContent || '').trim();
  }
  if (tabId === 'srt-tab') {
    return (document.getElementById('srtPreview')?.textContent || '').trim();
  }
  return '';
}

/* ========== Conversion layer (save CTA, soft lock, exit intent, sticky modes) ========== */
const CUTUP_LEAD_EMAIL_KEY = 'cutup_lead_email';
const CUTUP_SOFT_UNLOCK_KEY = 'cutup_soft_unlock';

function submitCutupLead(email, source) {
  const em = String(email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return;
  const src = source === 'save_action' ? 'save_action' : 'soft_unlock';
  try {
    fetch(`${API_BASE_URL}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: em, source: src }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
const CUTUP_EXIT_INTENT_KEY = 'cutup_exit_intent_once';
const CUTUP_SAVE_DISMISS_PREFIX = 'cutup_save_dismissed:';
const LONG_TRANSCRIPT_SOFT_LOCK_CHARS = 1700;

let cutupStickyGeneratedAt = 0;
let cutupStickyLastScrollAt = 0;
let cutupStickyPrimaryState = 'download';
let cutupExitIntentTimer = null;

function cutupIsLoggedIn() {
  try {
    return !!localStorage.getItem('cutup_session');
  } catch {
    return false;
  }
}

const CUTUP_PENDING_PLAN_AFTER_AUTH_KEY = 'cutup_pending_plan_after_auth';
const CUTUP_PAYMENT_RETRY_KEY = 'cutup_payment_retry';

function inferCutupPaymentProvider() {
  if (typeof window !== 'undefined' && window.CUTUP_PAYMENT_PROVIDER) {
    return window.CUTUP_PAYMENT_PROVIDER === 'yekpay' ? 'yekpay' : 'stripe';
  }
  try {
    const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
    if (lang.startsWith('fa')) return 'yekpay';
  } catch (_e) {
    /* noop */
  }
  return 'stripe';
}

async function cutupTriggerGoogleLogin() {
  if (cutupIsLoggedIn()) {
    console.log('[script] Already authenticated; skipping Google OAuth redirect');
    resetGoogleButtonState();
    return;
  }
  const btn = document.getElementById('loginBtn');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
    const label = btn.querySelector('.google-btn-label');
    if (label) label.textContent = 'Connecting...';
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/oauth/google/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[script] Auth error response:', response.status, errorText);
      throw new Error(`Server error: ${response.status}`);
    }
    const data = await response.json();
    if (!data?.authUrl) {
      console.error('[script] No authUrl in response:', data);
      throw new Error('No authUrl returned from server');
    }
    window.location.href = data.authUrl;
  } catch (error) {
    console.error('[script] Google login failed:', error);
    resetGoogleButtonState();
    alert('Google sign-in failed. Please try again.');
    throw error;
  }
}

const CUTUP_LANDING_PAID_PLANS = ['starter', 'pro', 'business', 'advanced'];

async function cutupRoutePricingToCheckout(planKey) {
  const sessionId = localStorage.getItem('cutup_session');
  if (!sessionId) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/user/profile`, {
      headers: { 'X-Session-Id': sessionId },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.profile) {
      window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(planKey)}`;
      return;
    }
    if (data.profile.incomplete) {
      window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(planKey)}`;
      return;
    }
    window.location.href = `/checkout.html?plan=${encodeURIComponent(planKey)}`;
  } catch (_e) {
    window.location.href = `/dashboard.html?checkoutPlan=${encodeURIComponent(planKey)}`;
  }
}

function setupLandingPricingCheckoutIntercept() {
  if (!document.getElementById('heroUrlInput')) return;
  document.addEventListener(
    'click',
    async (e) => {
      const a = e.target.closest && e.target.closest('a.pricing-dashboard-cta');
      if (!a) return;
      if (a.classList.contains('disabled-plan-btn')) return;
      if (a.getAttribute('aria-disabled') === 'true') return;

      let plan = (a.getAttribute('data-cutup-plan') || '').trim();
      if (a.id === 'monetizationUpgradeBtn' && !plan) {
        plan = 'pro';
      }
      if (!plan || !CUTUP_LANDING_PAID_PLANS.includes(plan)) return;

      e.preventDefault();
      e.stopPropagation();

      if (!cutupIsLoggedIn()) {
        try {
          sessionStorage.setItem(CUTUP_PENDING_PLAN_AFTER_AUTH_KEY, plan);
        } catch (_e) {
          /* noop */
        }
        try {
          await cutupTriggerGoogleLogin();
        } catch (_e) {
          try {
            sessionStorage.removeItem(CUTUP_PENDING_PLAN_AFTER_AUTH_KEY);
          } catch (_e2) {
            /* noop */
          }
        }
        return;
      }

      try {
        await cutupRoutePricingToCheckout(plan);
      } catch (err) {
        console.error('[script] checkout route from landing failed', err);
        alert('Could not continue to checkout. Please try again.');
      }
    },
    true
  );
}

function cutupSoftUnlockSet() {
  try {
    sessionStorage.setItem(CUTUP_SOFT_UNLOCK_KEY, '1');
  } catch {
    /* ignore */
  }
}

function cutupSoftUnlockActive() {
  try {
    if (cutupIsLoggedIn()) return true;
    return sessionStorage.getItem(CUTUP_SOFT_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function cutupConversionResultDismissKey() {
  const k = window.cutupLastTranscription?.cacheKey;
  return k ? `${CUTUP_SAVE_DISMISS_PREFIX}${k}` : '';
}

function refreshConversionSaveBlockUI() {
  const emailRow = document.getElementById('conversionSaveEmailRow');
  const hint = document.getElementById('conversionSaveHintLoggedIn');
  const emailInput = document.getElementById('conversionSaveEmail');
  if (cutupIsLoggedIn()) {
    if (emailRow) emailRow.hidden = true;
    if (hint) hint.hidden = false;
  } else {
    if (emailRow) emailRow.hidden = false;
    if (hint) hint.hidden = true;
    if (emailInput) {
      try {
        const saved = localStorage.getItem(CUTUP_LEAD_EMAIL_KEY);
        if (saved && !emailInput.value) emailInput.value = saved;
      } catch {
        /* ignore */
      }
    }
  }
}

function showConversionSaveBlock() {
  const block = document.getElementById('conversionSaveBlock');
  if (!block) return;
  const dismissKey = cutupConversionResultDismissKey();
  try {
    if (dismissKey && sessionStorage.getItem(dismissKey) === '1') {
      block.hidden = true;
      return;
    }
  } catch {
    /* ignore */
  }
  block.hidden = false;
  refreshConversionSaveBlockUI();
}

function hideConversionSaveBlockDismissed() {
  const block = document.getElementById('conversionSaveBlock');
  if (block) block.hidden = true;
  const dismissKey = cutupConversionResultDismissKey();
  if (dismissKey) {
    try {
      sessionStorage.setItem(dismissKey, '1');
    } catch {
      /* ignore */
    }
  }
}

function copyConversionTranscript() {
  const text = getResultCopyText();
  if (!text) {
    showMessage('Nothing to copy on this tab yet.', 'info');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showMessage('Copied to clipboard.', 'success');
  }).catch(() => {
    showMessage('Copy failed.', 'error');
  });
}

function runConversionSaveAction(source) {
  console.log('[conversion] save clicked', source || '');
  if (cutupIsLoggedIn()) {
    showMessage('You’re signed in—find this transcript in your dashboard history.', 'success');
    cutupSoftUnlockSet();
    updateFulltextSoftLockVeil();
    return;
  }
  const emailInput = document.getElementById('conversionSaveEmail');
  const email = String(emailInput?.value || '').trim().toLowerCase();
  if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showMessage('Add a valid email so we can remind you where to find this later.', 'info');
    emailInput?.focus();
    return;
  }
  try {
    localStorage.setItem(CUTUP_LEAD_EMAIL_KEY, email);
  } catch {
    /* ignore */
  }
  console.log('[conversion] email entered');
  cutupSoftUnlockSet();
  updateFulltextSoftLockVeil();
  submitCutupLead(email, 'soft_unlock');
  showMessage('Thanks—we saved your email on this device. Sign in anytime to sync history.', 'success');
}

function updateFulltextSoftLockVeil() {
  const veil = document.getElementById('fulltextSoftLockVeil');
  const wrap = document.getElementById('fulltextSoftLockWrap');
  if (!veil || !wrap) return;

  if (cutupSoftUnlockActive()) {
    veil.hidden = true;
    veil.setAttribute('aria-hidden', 'true');
    wrap.classList.remove('fulltext-soft-lock-wrap--locked');
    return;
  }

  const len = (document.getElementById('fulltext')?.textContent || '').trim().length;
  const previewBanner = document.getElementById('previewUpgradeBanner');
  const previewOn = previewBanner && previewBanner.style.display === 'block';
  const shouldLock =
    !previewOn &&
    !cutupIsLoggedIn() &&
    len >= LONG_TRANSCRIPT_SOFT_LOCK_CHARS;

  if (!shouldLock) {
    veil.hidden = true;
    veil.setAttribute('aria-hidden', 'true');
    wrap.classList.remove('fulltext-soft-lock-wrap--locked');
    return;
  }

  veil.hidden = false;
  veil.setAttribute('aria-hidden', 'false');
  wrap.classList.add('fulltext-soft-lock-wrap--locked');
}

function initConversionLayerAfterResults() {
  showConversionSaveBlock();
  updateFulltextSoftLockVeil();
  cutupStickyGeneratedAt = Date.now();
  cutupStickyLastScrollAt = Date.now();
  setStickyPrimaryMode('download');
}

function cutupResultSectionVisible() {
  const resultSection = document.getElementById('resultSection');
  return !!(resultSection && resultSection.style.display !== 'none');
}

function closeConversionExitModal() {
  const modal = document.getElementById('conversionExitModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  const prev = modal._cutupPrevFocus;
  if (prev && typeof prev.focus === 'function') {
    try {
      prev.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  modal._cutupPrevFocus = null;
}

function openConversionExitModal() {
  if (window.innerWidth < 768) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;
  if (!cutupResultSectionVisible()) return;
  try {
    if (sessionStorage.getItem(CUTUP_EXIT_INTENT_KEY) === '1') return;
  } catch {
    return;
  }
  const modal = document.getElementById('conversionExitModal');
  const panel = modal?.querySelector('.conversion-exit-modal__panel');
  if (!modal || !panel) return;
  try {
    sessionStorage.setItem(CUTUP_EXIT_INTENT_KEY, '1');
  } catch {
    /* ignore */
  }
  console.log('[conversion] exit intent shown');
  modal._cutupPrevFocus = document.activeElement;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  try {
    panel.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

function setStickyPrimaryMode(mode) {
  const allowed = ['download', 'tryAnother', 'saveResult'];
  if (!allowed.includes(mode)) return;
  cutupStickyPrimaryState = mode;
  const btn = document.getElementById('stickyDownloadBtn');
  if (!btn) return;
  const labels = {
    download: 'Download',
    tryAnother: 'Try another video',
    saveResult: 'Save your result',
  };
  btn.textContent = labels[mode];
  btn.setAttribute('aria-label', labels[mode]);
  btn.dataset.stickyPrimary = mode;
}

function refreshStickyPrimaryMode() {
  const resultSection = document.getElementById('resultSection');
  if (!resultSection) return;
  const hasResult = resultSection.style.display !== 'none' && resultSection.textContent.trim().length > 0;
  const isMobile = window.innerWidth < 640;
  if (!hasResult || !isMobile || !cutupStickyGeneratedAt) return;

  const now = Date.now();
  const sinceGen = now - cutupStickyGeneratedAt;
  const sinceScroll = now - cutupStickyLastScrollAt;

  if (sinceGen < 4000) {
    setStickyPrimaryMode('download');
  } else if (sinceScroll < 2200) {
    setStickyPrimaryMode('tryAnother');
  } else if (sinceScroll > 7500) {
    setStickyPrimaryMode('saveResult');
  } else {
    setStickyPrimaryMode('tryAnother');
  }
}

function setupConversionLayerInteractions() {
  document.getElementById('conversionSaveBtn')?.addEventListener('click', () => {
    runConversionSaveAction('save_block');
  });
  document.getElementById('conversionSkipSaveBtn')?.addEventListener('click', () => {
    hideConversionSaveBlockDismissed();
  });
  document.getElementById('fulltextSoftLockLoginBtn')?.addEventListener('click', () => {
    document.getElementById('loginBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('loginBtn')?.focus({ preventScroll: true }), 400);
  });
  document.getElementById('fulltextSoftLockSaveBtn')?.addEventListener('click', () => {
    document.getElementById('conversionSaveBlock')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      if (!cutupIsLoggedIn()) {
        document.getElementById('conversionSaveEmail')?.focus({ preventScroll: true });
      } else {
        document.getElementById('conversionSaveBtn')?.focus({ preventScroll: true });
      }
    }, 350);
  });

  document.getElementById('conversionExitBackdrop')?.addEventListener('click', closeConversionExitModal);
  document.getElementById('conversionExitCloseBtn')?.addEventListener('click', closeConversionExitModal);
  document.getElementById('conversionExitSaveBtn')?.addEventListener('click', () => {
    closeConversionExitModal();
    runConversionSaveAction('exit_modal');
    document.getElementById('conversionSaveBlock')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('conversionExitCopyBtn')?.addEventListener('click', () => {
    copyConversionTranscript();
    closeConversionExitModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('conversionExitModal');
    if (modal && !modal.hidden) {
      e.preventDefault();
      closeConversionExitModal();
    }
  });

  document.addEventListener(
    'mousemove',
    (e) => {
      if (window.innerWidth < 768) return;
      if (!window.matchMedia('(pointer: fine)').matches) return;
      if (!cutupResultSectionVisible()) return;
      try {
        if (sessionStorage.getItem(CUTUP_EXIT_INTENT_KEY) === '1') return;
      } catch {
        return;
      }
      if (e.clientY > 20) return;
      if (cutupExitIntentTimer) clearTimeout(cutupExitIntentTimer);
      cutupExitIntentTimer = setTimeout(() => {
        cutupExitIntentTimer = null;
        openConversionExitModal();
      }, 380);
    },
    { passive: true }
  );
}

/* ========== Retention: recent activity, usage stats, upgrade hint ========== */
const CUTUP_RECENT_ACTIVITY_KEY = 'cutup_recent_activity';
const CUTUP_USAGE_STATS_KEY = 'cutup_usage_stats';
const CUTUP_GUEST_ID_KEY = 'cutup_guest_id';

let retentionUpgradeHintLogged = false;
let retentionSyncRecentTimer = null;
let retentionSyncRecentDedupeKey = '';
let retentionSyncRecentDedupeAt = 0;
let retentionGuestModeLogged = false;

function ensureCutupGuestId() {
  try {
    let g = localStorage.getItem(CUTUP_GUEST_ID_KEY);
    if (g && /^[a-zA-Z0-9._-]{8,80}$/.test(g)) return g;
    g =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 24)
        : `g${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem(CUTUP_GUEST_ID_KEY, g);
    return g;
  } catch {
    return `g${Date.now()}`;
  }
}

function retentionSessionHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const sid = localStorage.getItem('cutup_session');
  if (sid) h['X-Session-Id'] = sid;
  return h;
}

function fireRetentionSync(body) {
  try {
    const payload = { ...body, timestamp: body.timestamp || Date.now() };
    if (!cutupIsLoggedIn()) {
      payload.guestId = ensureCutupGuestId();
      if (!retentionGuestModeLogged) {
        retentionGuestModeLogged = true;
        console.log('[retention-sync] guest mode');
      }
    }
    fetch(`${API_BASE_URL}/api/retention`, {
      method: 'POST',
      headers: retentionSessionHeaders(),
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then((r) => {
        if (r.ok) console.log('[retention-sync] sent', body.type);
      })
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Server sync: usage immediately; recent debounced + deduped (invalid http URLs skipped). */
function scheduleRetentionServerSync({ url, platform, title }) {
  const ts = Date.now();
  fireRetentionSync({ type: 'usage', timestamp: ts });

  if (!/^https?:\/\//i.test(String(url || ''))) return;

  const dedupeKey = `${String(platform || '')}|${String(url).trim()}`;
  if (dedupeKey === retentionSyncRecentDedupeKey && ts - retentionSyncRecentDedupeAt < 10000) {
    return;
  }

  clearTimeout(retentionSyncRecentTimer);
  retentionSyncRecentTimer = setTimeout(() => {
    retentionSyncRecentTimer = null;
    retentionSyncRecentDedupeKey = dedupeKey;
    retentionSyncRecentDedupeAt = Date.now();
    fireRetentionSync({
      type: 'recent',
      url: String(url).trim(),
      platform: String(platform || 'youtube').slice(0, 32),
      title: title != null ? String(title).slice(0, 500) : '',
      timestamp: ts,
    });
  }, 800);
}

async function retentionMergeGuestIfNeeded(sessionId) {
  const guestId = localStorage.getItem(CUTUP_GUEST_ID_KEY);
  if (!guestId || !sessionId) return;
  try {
    const r = await fetch(`${API_BASE_URL}/api/retention`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ type: 'merge', guestId, timestamp: Date.now() }),
      keepalive: true,
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      if (j.merged) {
        console.log('[retention-sync] merged');
        localStorage.removeItem(CUTUP_GUEST_ID_KEY);
        retentionGuestModeLogged = false;
      }
    }
  } catch {
    /* ignore */
  }
}

function readRecentActivity() {
  try {
    const raw = localStorage.getItem(CUTUP_RECENT_ACTIVITY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && x.url && /^https?:\/\//i.test(String(x.url)));
  } catch {
    return [];
  }
}

function readUsageStats() {
  try {
    const raw = localStorage.getItem(CUTUP_USAGE_STATS_KEY);
    if (!raw) return { totalUses: 0, lastUsedAt: 0, useTimestamps: [] };
    const o = JSON.parse(raw);
    return {
      totalUses: Number(o.totalUses) || 0,
      lastUsedAt: Number(o.lastUsedAt) || 0,
      useTimestamps: Array.isArray(o.useTimestamps) ? o.useTimestamps.map(Number).filter(Boolean) : [],
    };
  } catch {
    return { totalUses: 0, lastUsedAt: 0, useTimestamps: [] };
  }
}

function bumpUsageStats() {
  const s = readUsageStats();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const timestamps = [...s.useTimestamps.filter((t) => t > dayAgo), now];
  const next = {
    totalUses: (s.totalUses || 0) + 1,
    lastUsedAt: now,
    useTimestamps: timestamps.slice(-40),
  };
  try {
    localStorage.setItem(CUTUP_USAGE_STATS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function retentionUsesLast24h(stats) {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return (stats.useTimestamps || []).filter((t) => t > dayAgo).length;
}

function retentionShouldShowUpgrade(stats) {
  const n = stats.totalUses || 0;
  const u24 = retentionUsesLast24h(stats);
  return n >= 3 || u24 >= 2;
}

function retentionShortTitle(url, title) {
  const t = String(title || '').trim();
  if (t) return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const s = `${host}${path}`.slice(0, 64);
    return s.length < String(url).length ? s : String(url).slice(0, 64);
  } catch {
    return String(url).slice(0, 64);
  }
}

function recordRetentionAfterResults(opts) {
  const stats = bumpUsageStats();
  const url = String(opts.sourceUrl || '').trim();
  const platform = opts.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : 'youtube') || 'youtube';
  const title = retentionShortTitle(url, opts.title);

  if (/^https?:\/\//i.test(url)) {
    const list = readRecentActivity();
    const entry = { url, platform, title, ts: Date.now() };
    const filtered = list.filter((x) => !(x.url === url && x.platform === platform));
    filtered.unshift(entry);
    const trimmed = filtered.slice(0, 5);
    try {
      localStorage.setItem(CUTUP_RECENT_ACTIVITY_KEY, JSON.stringify(trimmed));
    } catch {
      /* ignore */
    }
    console.log('[retention] recent used', { platform, urlLen: url.length });
  }

  renderRetentionPanels(stats);
  scheduleRetentionServerSync({ url, platform, title });
}

function retentionSwitchPlatformWithUrl(platform, url) {
  const p = platform || 'youtube';
  currentPlatform = p;

  document.querySelectorAll('.platform-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === p);
  });

  document.querySelectorAll('#tool .download-box > .tab-content').forEach((content) => {
    content.classList.remove('active');
  });
  const activeTab = document.getElementById(`${p}-tab`);
  if (activeTab) activeTab.classList.add('active');

  const allOptions = ['downloadOptionsYoutube', 'downloadOptionsInstagram', 'downloadOptionsTiktok', 'downloadOptionsAudiofile'];
  allOptions.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if (p === 'youtube' || p === 'instagram' || p === 'tiktok') {
    const inputId = p === 'youtube' ? 'youtubeUrlInput' : `${p}UrlInput`;
    const urlInput = document.getElementById(inputId);
    if (urlInput && url) urlInput.value = url;
    checkInput();
    urlInput?.focus({ preventScroll: false });
  } else if (p === 'audiofile') {
    checkInput();
    document.getElementById('audioFileInput')?.focus({ preventScroll: true });
  } else {
    checkInput();
  }

  document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateRetentionStripVisibility(stats) {
  const strip = document.getElementById('retentionStrip');
  if (!strip) return false;
  const s = stats || readUsageStats();
  const hasUsage = (s.totalUses || 0) >= 1;
  const hasRecent = readRecentActivity().length > 0;
  const show = hasUsage || hasRecent;
  strip.hidden = !show;
  return show;
}

function renderUsageHint(stats) {
  const el = document.getElementById('retentionUsageHint');
  if (!el) return;
  const n = stats.totalUses || 0;
  if (n < 1) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = n === 1 ? 'You’ve used this once.' : `You’ve used this ${n} times.`;
  el.hidden = false;
}

function renderUpgradeHint(stats) {
  const wrap = document.getElementById('retentionUpgradeHint');
  if (!wrap) return;
  const show = retentionShouldShowUpgrade(stats);
  wrap.hidden = !show;
  if (show && !retentionUpgradeHintLogged) {
    retentionUpgradeHintLogged = true;
    console.log('[retention] upgrade shown');
  }
}

function renderRecentActivityList() {
  const wrap = document.getElementById('retentionRecentWrap');
  const ul = document.getElementById('retentionRecentList');
  if (!wrap || !ul) return;
  const list = readRecentActivity();
  ul.textContent = '';
  if (!list.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  list.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'retention-recent-item';
    const label = document.createElement('span');
    label.className = 'retention-recent-label';
    label.textContent = item.title || item.url || 'Link';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary retention-recent-continue';
    btn.textContent = 'Continue';
    btn.dataset.url = String(item.url || '');
    btn.dataset.platform = String(item.platform || 'youtube');
    btn.addEventListener('click', () => {
      console.log('[retention] recent used', { action: 'continue_row', platform: btn.dataset.platform });
      retentionSwitchPlatformWithUrl(btn.dataset.platform, btn.dataset.url);
    });
    li.appendChild(label);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function renderRetentionPanels(stats) {
  const s = stats || readUsageStats();
  if (!updateRetentionStripVisibility(s)) return;
  renderUsageHint(s);
  renderUpgradeHint(s);
  renderRecentActivityList();
}

function setupRetentionInteractions() {
  renderRetentionPanels();
}

/** ISO 639-1 code for API hints, or null if unknown. */
function normalizeLangCode(code) {
  if (code == null || code === '') return null;
  const s = String(code).toLowerCase().trim();
  if (s === 'unknown' || s === 'und') return null;
  const two = s.length >= 2 ? s.slice(0, 2) : s;
  if (!/^[a-z]{2}$/.test(two)) return null;
  return two;
}

function getLanguageName(code) {
  const normalized = normalizeLangCode(code);
  if (!normalized) return 'Original language';
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' });
    const label = dn.of(normalized);
    if (label && typeof label === 'string') return label;
  } catch (e) {
    /* ignore */
  }
  return 'Original language';
}

const TRANSLATION_LANGUAGE_OPTIONS = [
  // Required order by product request
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espanol' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'fa', label: 'فارسی' },

  // Then sorted broadly by global usage (high -> lower, >= ~2M speakers)
  { code: 'ar', label: 'العربية' },
  { code: 'fr', label: 'Francais' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'ru', label: 'Русский' },
  { code: 'pt', label: 'Portugues' },
  { code: 'ur', label: 'اردو' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'mr', label: 'मराठी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'tr', label: 'Turkce' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'vi', label: 'Tieng Viet' },
  { code: 'ko', label: '한국어' },
  { code: 'it', label: 'Italiano' },
  { code: 'th', label: 'ไทย' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'pl', label: 'Polski' },
  { code: 'uk', label: 'Українська' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'or', label: 'ଓଡ଼ିଆ' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'ro', label: 'Romana' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ps', label: 'پښتو' },
  { code: 'az', label: 'Azərbaycanca' },
  { code: 'am', label: 'Amharic' },
  { code: 'my', label: 'မြန်မာ' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ig', label: 'Igbo' },
  { code: 'sd', label: 'سنڌي' },
  { code: 'ne', label: 'नेपाली' },
  { code: 'si', label: 'සිංහල' },
  { code: 'km', label: 'ខ្មែរ' },
  { code: 'ku', label: 'Kurdi' },
  { code: 'uz', label: 'Ozbek' },
  { code: 'su', label: 'Sunda' },
  { code: 'ha', label: 'Hausa' },
  { code: 'ny', label: 'Chichewa' },
  { code: 'mg', label: 'Malagasy' },
  { code: 'xh', label: 'isiXhosa' },
  { code: 'zu', label: 'isiZulu' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'he', label: 'עברית' },
  { code: 'cs', label: 'Cestina' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'sv', label: 'Svenska' },
  { code: 'hu', label: 'Magyar' },
  { code: 'be', label: 'Беларуская' },
  { code: 'bg', label: 'Български' },
  { code: 'sr', label: 'Српски' },
  { code: 'da', label: 'Dansk' },
  { code: 'fi', label: 'Suomi' },
  { code: 'no', label: 'Norsk' },
  { code: 'sk', label: 'Slovencina' },
  { code: 'ka', label: 'ქართული' },
  { code: 'hy', label: 'Հայերեն' },
  { code: 'sq', label: 'Shqip' },
  { code: 'hr', label: 'Hrvatski' },
  { code: 'bs', label: 'Bosanski' },
  { code: 'sl', label: 'Slovenscina' },
  { code: 'lt', label: 'Lietuviu' },
  { code: 'lo', label: 'ລາວ' },
  { code: 'ht', label: 'Kreyol Ayisyen' },
  { code: 'ca', label: 'Catala' }
];

function getTranslationOriginalLabel() {
  const detectedLabel = getLanguageName(window.cutupDetectedSourceLanguage);
  return detectedLabel && detectedLabel !== 'Original language' ? `${detectedLabel} (Original)` : 'Original language';
}

function buildLanguageOptionsMarkup() {
  const originalLabel = getTranslationOriginalLabel();
  const dynamicOptions = TRANSLATION_LANGUAGE_OPTIONS.map((lang) => (
    `<option value="${lang.code}">${lang.label}</option>`
  )).join('');
  return `<option value="original">${originalLabel}</option>${dynamicOptions}`;
}

function populateLanguageSelects() {
  const languageSelectIds = [
    'fulltextLanguage',
    'summaryLanguage',
    'srtLanguage',
    'summaryLanguageSelect',
    'fullTextLanguageSelect',
    'srtLanguageSelect'
  ];
  const optionsMarkup = buildLanguageOptionsMarkup();
  languageSelectIds.forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const previousValue = sel.value;
    sel.innerHTML = optionsMarkup;
    const hasPreviousValue = previousValue && (previousValue === 'original' || TRANSLATION_LANGUAGE_OPTIONS.some((lang) => lang.code === previousValue));
    sel.value = hasPreviousValue ? previousValue : 'original';
  });
}

function setDetectedSourceLanguage(codeOrName) {
  window.cutupDetectedSourceLanguage = normalizeLangCode(codeOrName);
  updateTranslationOriginalLabel();
}

function updateTranslationOriginalLabel() {
  const label = getTranslationOriginalLabel();
  ['fulltextLanguage', 'summaryLanguage', 'srtLanguage', 'summaryLanguageSelect', 'fullTextLanguageSelect', 'srtLanguageSelect'].forEach((id) => {
    const sel = document.getElementById(id);
    const opt = sel && sel.querySelector('option[value="original"]');
    if (opt) opt.textContent = label;
  });
}

function normalizeSummaryLanguage(code) {
  return normalizeLangCode(code);
}

function getTranscriptionCacheKey() {
  try {
    const url = typeof getCurrentUrl === 'function' ? getCurrentUrl() : '';
    const file = typeof audioFileInput !== 'undefined' && audioFileInput && audioFileInput.files && audioFileInput.files[0];
    if (file && (currentPlatform === 'audiofile' || !url || (typeof url === 'string' && url.startsWith('📁')))) {
      return `file:${file.name}:${file.size}:${file.lastModified}`;
    }
    if (url && typeof url === 'string' && url.trim()) {
      return `url:${url.trim()}`;
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

function applyResultOutputMode(resultSection, outputMode) {
  if (!resultSection) return;
  const fulltextBtn = resultSection.querySelector('.tab-btn[data-tab="fulltext"]');
  const summaryBtn = resultSection.querySelector('.tab-btn[data-tab="summary"]');
  const srtBtn = resultSection.querySelector('.tab-btn[data-tab="srt"]');
  const fulltextContent = document.getElementById('fulltext-tab');
  const summaryContent = document.getElementById('summary-tab');
  const srtContent = document.getElementById('srt-tab');

  if (outputMode === 'srt') {
    if (fulltextBtn) {
      fulltextBtn.hidden = true;
      fulltextBtn.style.setProperty('display', 'none', 'important');
    }
    if (summaryBtn) {
      summaryBtn.hidden = true;
      summaryBtn.style.setProperty('display', 'none', 'important');
    }
    if (srtBtn) {
      srtBtn.hidden = false;
      srtBtn.style.removeProperty('display');
    }
    if (fulltextContent) {
      fulltextContent.style.display = 'none';
      fulltextContent.classList.remove('active');
    }
    if (summaryContent) {
      summaryContent.style.display = 'none';
      summaryContent.classList.remove('active');
    }
    if (srtContent) srtContent.style.display = '';
    resultSection.dataset.outputMode = 'srt';
  } else {
    if (fulltextBtn) {
      fulltextBtn.hidden = false;
      fulltextBtn.style.removeProperty('display');
    }
    if (summaryBtn) {
      summaryBtn.hidden = false;
      summaryBtn.style.removeProperty('display');
    }
    if (srtBtn) {
      srtBtn.hidden = true;
      srtBtn.style.setProperty('display', 'none', 'important');
    }
    if (srtContent) {
      srtContent.style.display = 'none';
      srtContent.classList.remove('active');
    }
    if (fulltextContent) fulltextContent.style.display = '';
    if (summaryContent) summaryContent.style.display = '';
    resultSection.dataset.outputMode = 'fulltext';
  }
}

async function shareResultOutput() {
  const text = getResultCopyText();
  const url = `${window.location.origin}${window.location.pathname}`;
  const title = 'Made with Cutup — subtitles & transcript';
  try {
    if (navigator.share) {
      await navigator.share({
        title,
        text: text
          ? (text.length > 3500 ? `${text.slice(0, 3500)}…` : text)
          : 'Generate subtitles & transcripts fast with Cutup.',
        url
      });
      showMessage('Thanks for sharing Cutup.', 'success');
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const fallback = text
    ? `${text.slice(0, 2000)}${text.length > 2000 ? '…' : ''}\n\nGenerated by Cutup — ${url}`
    : `Generate subtitles fast — ${url}`;
  try {
    await navigator.clipboard.writeText(fallback);
    showMessage('Copied to clipboard—paste into any app to share.', 'success');
  } catch {
    showMessage('Could not copy. Select text manually.', 'error');
  }
}

function reportClientError(tag, err) {
  console.error(`[script:${tag}]`, err);
}

// Check for auth callback
const urlParams = new URLSearchParams(window.location.search);
const authSuccess = urlParams.get('auth');
const sessionId = urlParams.get('session');
const authError = urlParams.get('error');

if (authSuccess === 'success' && sessionId) {
  // Save session to localStorage
  localStorage.setItem('cutup_session', sessionId);
  // Also notify extension if possible
  try {
    // Try to send message to extension
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({
        type: 'auth_success',
        session: sessionId
      });
    }
  } catch (e) {
    // Extension might not be available, that's okay
    console.log('Could not notify extension:', e);
  }
  // Check if we have a pending URL (user logged in after entering URL)
  const pendingUrl = localStorage.getItem('cutup_pending_url');
  const pendingPlatform = localStorage.getItem('cutup_pending_platform');
  
  // If we're on dashboard.html and have pending URL, redirect to main page
  if (window.location.pathname.includes('dashboard.html') && pendingUrl) {
    console.log('[script] Redirecting to main page with pending URL');
    window.location.href = `/?session=${encodeURIComponent(sessionId)}`;
    // Don't continue execution after redirect
  } else {
    // Remove query params from URL
    window.history.replaceState({}, document.title, window.location.pathname);
    // Load user profile
    loadUserProfile().then(() => {
      // After profile is loaded, restore pending URL if exists
      if (pendingUrl && pendingPlatform) {
        console.log('[script] Restoring pending URL:', pendingUrl, 'Platform:', pendingPlatform);
        restorePendingUrl(pendingUrl, pendingPlatform);
      }
    });
    
    // Scroll to download section after login
    setTimeout(() => {
      const downloadSection = document.querySelector('.download-section');
      if (downloadSection) {
        downloadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 500);
  }
} else if (authError) {
  console.error('Auth error:', authError);
  alert('Sign-in failed. Please try again.');
}

// Load user profile on page load
window.addEventListener('DOMContentLoaded', () => {
  console.log('[script] DOMContentLoaded event fired');
  const savedSession = localStorage.getItem('cutup_session');
  console.log('[script] Saved session from localStorage:', savedSession);
  
  const loginBtn = document.getElementById('loginBtn');
  const googleWrap = document.querySelector('.google-btn-wrapper');
  if (!savedSession) {
    if (loginBtn) loginBtn.style.display = '';
    if (googleWrap) googleWrap.style.display = '';
  }

  // Check if we have a pending URL (user logged in after entering URL)
  const pendingUrl = localStorage.getItem('cutup_pending_url');
  const pendingPlatform = localStorage.getItem('cutup_pending_platform');
  
  if (savedSession) {
    currentSession = savedSession;
    // Wait a bit to ensure DOM is fully ready
    setTimeout(() => {
      loadUserProfile().then(() => {
        // After profile is loaded, restore pending URL if exists
        if (pendingUrl && pendingPlatform) {
          console.log('[script] Restoring pending URL:', pendingUrl, 'Platform:', pendingPlatform);
          restorePendingUrl(pendingUrl, pendingPlatform);
        }
      });
    }, 100);
  } else {
    console.log('[script] No saved session, showing login button');
    showLoginButton();
  }

  applyCutupPricingPlanLocks(window.userSubscription || { plan: 'free' });
});

// Restore pending URL after login
async function restorePendingUrl(url, platform) {
  try {
    console.log('[script] Restoring pending URL:', url, 'Platform:', platform);
    
    // Switch to the correct platform tab (without clearing input)
    if (platform && platform !== currentPlatform) {
      currentPlatform = platform;
      
      // Update tab buttons
      document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.dataset.tab === platform) {
          tab.classList.add('active');
        }
      });
      
      // Update tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      
      const activeTab = document.getElementById(`${platform}-tab`);
      if (activeTab) {
        activeTab.classList.add('active');
      }
      
      // Update title and placeholder based on platform
      const downloadTitle = document.querySelector('.download-title');
      if (downloadTitle) {
        const titles = {
          'youtube': 'Paste a YouTube link',
          'instagram': 'Paste an Instagram link',
          'tiktok': 'Paste a TikTok link',
          'audiofile': 'Upload audio or video'
        };
        downloadTitle.textContent = titles[platform] || titles.youtube;
      }
    }
    
    // Wait for platform switch to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Set the URL in the input (don't clear it)
    const input = getCurrentUrlInput();
    if (input) {
      input.value = url;
      // Trigger input event to validate and show options
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Check input to show download options
    checkInput();
    
    // Update buttons based on subscription
    const sessionId = localStorage.getItem('cutup_session');
    if (sessionId) {
      await updateButtonsBasedOnSubscription(sessionId);
    }
    
    // Clear pending URL
    localStorage.removeItem('cutup_pending_url');
    localStorage.removeItem('cutup_pending_platform');
    
    // Scroll to download section
    setTimeout(() => {
      const downloadSection = document.querySelector('.download-section');
      if (downloadSection) {
        downloadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 500);
    
    console.log('[script] Pending URL restored successfully');
  } catch (error) {
    console.error('[script] Error restoring pending URL:', error);
  }
}

async function loadUserProfile() {
  const sessionId = localStorage.getItem('cutup_session');
  console.log('[script] loadUserProfile called, sessionId:', sessionId);
  
  if (!sessionId) {
    console.log('[script] No session found, showing login button');
    showLoginButton();
    return;
  }

  try {
    console.log('[script] Fetching user profile from API...');
    const response = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${sessionId}`);
    console.log('[script] Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('[script] User data received:', data);
      
      if (data.user) {
        console.log('[script] User found, showing profile');
        showUserProfile(data.user);
        currentSession = sessionId;
        // Load subscription info and update UI
        await updateButtonsBasedOnSubscription(sessionId);
        await retentionMergeGuestIfNeeded(sessionId);
        await monetizationRefreshPaywallPassive();
      } else {
        console.warn('[script] No user in response, showing login button');
        showLoginButton();
      }
    } else {
      // Session expired or invalid - but don't remove it immediately
      const errorText = await response.text().catch(() => '');
      console.error('[script] Failed to load user profile:', response.status, errorText);
      
      // Only remove session if it's a 401 (unauthorized) or 403 (forbidden)
      if (response.status === 401 || response.status === 403) {
        console.log('[script] Session expired, removing from localStorage');
        localStorage.removeItem('cutup_session');
      }
      showLoginButton();
    }
  } catch (error) {
    console.error('[script] Error loading user profile:', error);
    // Don't remove session on network errors
    showLoginButton();
  }
}

// Update buttons based on subscription plan
// Get usage from localStorage (same logic as dashboard)
function getLocalUsage() {
  try {
    const keys = Object.keys(localStorage);
    const resultKeys = keys.filter(k => k.startsWith('cutup_result_'));
    
    // Get current month boundaries
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    currentMonthStart.setHours(0, 0, 0, 0);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    currentMonthEnd.setHours(23, 59, 59, 999);
    
    let audio = 0;
    let video = 0;
    let minutes = 0;
    
    for (const key of resultKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      
      try {
        const item = JSON.parse(raw);
        
        // Check if item is from current month
        let itemDate = null;
        if (item.date) {
          itemDate = new Date(item.date);
        } else if (item.id) {
          itemDate = new Date(parseInt(item.id));
        }
        
        if (itemDate && (itemDate < currentMonthStart || itemDate > currentMonthEnd)) {
          continue;
        }
        
        if (item.type === 'downloadAudio') audio += 1;
        if (item.type === 'downloadVideo') video += 1;
        if ((item.type === 'summary' || item.type === 'summarization' || item.type === 'transcription') && typeof item.minutes === 'number') {
          minutes += item.minutes;
        }
      } catch (e) {
        // Skip invalid items
      }
    }
    
    return { audioDownloads: audio, videoDownloads: video, usedMinutes: minutes };
  } catch (e) {
    return { audioDownloads: 0, videoDownloads: 0, usedMinutes: 0 };
  }
}

const CUTUP_PLAN_RANK = {
  free: 0,
  starter: 1,
  pro: 2,
  advanced: 3,
  business: 3,
};

function normalizePlanKey(key) {
  if (!key) return 'free';
  key = String(key).toLowerCase();
  if (key === 'business') return 'business';
  return key;
}

function cutupIsTopTierPlan(key) {
  const k = normalizePlanKey(key);
  return k === 'advanced' || k === 'business';
}

function cutupPricingPreventClick(e) {
  e.preventDefault();
  e.stopPropagation();
  return false;
}

/**
 * Landing / index pricing: lock [data-cutup-plan] CTAs (no backend change).
 */
function applyCutupPricingPlanLocks(user) {
  const currentPlanKey = normalizePlanKey(user?.plan || 'free');
  const currentRank = CUTUP_PLAN_RANK[currentPlanKey] ?? 0;
  console.log('[plan-debug] currentPlanKey:', currentPlanKey, 'currentRank:', currentRank);

  document.querySelectorAll('[data-cutup-plan]').forEach((el) => {
    const planKeyRaw = el.getAttribute('data-cutup-plan');
    if (planKeyRaw == null) return;
    const trimmed = String(planKeyRaw).trim();
    if (trimmed === '') return;

    const planKey = normalizePlanKey(trimmed);
    const planRank = CUTUP_PLAN_RANK[planKey] ?? 0;

    const btn = el.matches('a, button') ? el : el.querySelector('a, button');
    if (!btn) return;

    const card = el.closest('.feature-card') || el.closest('.pricing-card') || el.parentElement;

    let disabled = false;
    if (cutupIsTopTierPlan(currentPlanKey)) {
      disabled = true;
    } else if (planRank <= currentRank) {
      disabled = true;
    }

    if (!btn.dataset.cutupOriginalLabel) {
      btn.dataset.cutupOriginalLabel = (btn.textContent || '').trim();
    }
    if (btn.tagName === 'A' && btn.dataset.cutupOriginalHref == null) {
      btn.dataset.cutupOriginalHref = btn.getAttribute('href') || '';
    }

    if (disabled) {
      if (card) card.classList.add('disabled-plan');
      btn.classList.add('disabled-plan-btn');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('tabindex', '-1');
      if (btn.tagName === 'A') {
        btn.setAttribute('href', '#');
      }
      if (!btn._cutupPricingLockBound) {
        btn.addEventListener('click', cutupPricingPreventClick, true);
        btn._cutupPricingLockBound = true;
      }
      btn.textContent = planRank === currentRank ? 'Current plan' : 'Not available';
    } else {
      if (card) card.classList.remove('disabled-plan');
      btn.classList.remove('disabled-plan-btn');
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('tabindex');
      if (btn._cutupPricingLockBound) {
        btn.removeEventListener('click', cutupPricingPreventClick, true);
        btn._cutupPricingLockBound = false;
      }
      if (btn.tagName === 'A' && btn.dataset.cutupOriginalHref != null) {
        btn.setAttribute('href', btn.dataset.cutupOriginalHref);
      }
      if (btn.dataset.cutupOriginalLabel) {
        btn.textContent = btn.dataset.cutupOriginalLabel;
      }
    }
  });

  const monetizationUpgrade = document.getElementById('monetizationUpgradeBtn');
  if (monetizationUpgrade) {
    const raw = monetizationUpgrade.getAttribute('data-cutup-plan');
    if (raw == null || String(raw).trim() === '') {
      const lock = cutupIsTopTierPlan(currentPlanKey);
      if (lock) {
        monetizationUpgrade.classList.add('disabled-plan-btn');
        monetizationUpgrade.setAttribute('aria-disabled', 'true');
        monetizationUpgrade.setAttribute('tabindex', '-1');
        if (!monetizationUpgrade._cutupPricingLockBound) {
          monetizationUpgrade.addEventListener('click', cutupPricingPreventClick, true);
          monetizationUpgrade._cutupPricingLockBound = true;
        }
      } else {
        monetizationUpgrade.classList.remove('disabled-plan-btn');
        monetizationUpgrade.removeAttribute('aria-disabled');
        monetizationUpgrade.removeAttribute('tabindex');
        if (monetizationUpgrade._cutupPricingLockBound) {
          monetizationUpgrade.removeEventListener('click', cutupPricingPreventClick, true);
          monetizationUpgrade._cutupPricingLockBound = false;
        }
      }
    }
  }
}

async function updateButtonsBasedOnSubscription(sessionId) {
  try {
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    if (!subResponse.ok) {
      // Default to free plan if can't fetch
      setButtonsForFreePlan();
      applyCutupPricingPlanLocks({ plan: 'free' });
      return;
    }
    
    const subData = await subResponse.json();
    const userPlan = subData.plan || 'free';
    const features = subData.features || {};
    
    // Use API usage data (not localStorage) for button state
    const apiUsage = subData.usage || {};
    const apiDownloads = apiUsage.downloads || {};
    const apiAudio = apiDownloads.audio || {};
    const apiVideo = apiDownloads.video || {};
    
    const monthlyLimit = apiUsage.monthlyLimit != null ? apiUsage.monthlyLimit : 15;
    const audioLimit = apiAudio.limit !== undefined ? apiAudio.limit : 3;
    const videoLimit = apiVideo.limit !== undefined ? apiVideo.limit : 3;
    const limits = { audio: audioLimit, video: videoLimit, minutes: monthlyLimit };
    
    const audioCount = apiAudio.count || 0;
    const videoCount = apiVideo.count || 0;
    const minutesUsed = apiUsage.monthly?.minutes || 0;
    const dailyLimit = apiUsage.dailyLimit != null ? apiUsage.dailyLimit : null;
    const dailyUsed = apiUsage.daily?.minutes || 0;
    const dailyExceeded =
      userPlan === 'free' &&
      dailyLimit != null &&
      dailyLimit > 0 &&
      dailyUsed >= dailyLimit;
    const monthlyCapExceeded =
      monthlyLimit != null && monthlyLimit > 0 && minutesUsed >= monthlyLimit;
    
    // Store subscription info globally
    window.userSubscription = {
      plan: userPlan,
      features: features,
      usage: {
        ...subData.usage,
        downloads: {
          audio: { count: audioCount, limit: audioLimit },
          video: { count: videoCount, limit: videoLimit }
        },
        monthly: { minutes: minutesUsed, limit: monthlyLimit }
      }
    };
    
    const audioExceeded = audioLimit !== null && audioCount >= audioLimit;
    const videoExceeded = videoLimit !== null && videoCount >= videoLimit;
    
    console.log('[script] Button state update:', {
      audioCount,
      audioLimit,
      audioExceeded,
      videoCount,
      videoLimit,
      videoExceeded
    });
    
    if (userPlan === 'free') {
      setButtonsForFreePlan(audioExceeded, videoExceeded, monthlyCapExceeded, dailyExceeded);
    } else {
      setButtonsForPaidPlan(audioExceeded, videoExceeded, monthlyCapExceeded, limits);
    }
    applyCutupPricingPlanLocks({ plan: userPlan });
  } catch (error) {
    console.error('Error loading subscription info:', error);
    // Default to free plan on error
    setButtonsForFreePlan();
    applyCutupPricingPlanLocks({ plan: 'free' });
  }
}

// Set buttons state for free plan
function setButtonsForFreePlan(audioExceeded = false, videoExceeded = false, monthlyCapExceeded = false, dailyCapExceeded = false) {
  // Free users can run subtitle preview; full export still gated in UI
  if (downloadSubtitleBtnMain) {
    downloadSubtitleBtnMain.style.opacity = '1';
    downloadSubtitleBtnMain.style.cursor = 'pointer';
    downloadSubtitleBtnMain.title = 'Generate subtitle preview (upgrade for full SRT download)';
    downloadSubtitleBtnMain.disabled = false;
  }
  
  // Audio button - check limit
  if (downloadAudioBtnMain) {
    if (audioExceeded) {
      downloadAudioBtnMain.style.opacity = '0.5';
      downloadAudioBtnMain.style.cursor = 'not-allowed';
      downloadAudioBtnMain.title = 'Monthly audio download limit reached. Upgrade for more.';
      downloadAudioBtnMain.disabled = true;
    } else {
      downloadAudioBtnMain.style.opacity = '1';
      downloadAudioBtnMain.style.cursor = 'pointer';
      downloadAudioBtnMain.title = '';
      downloadAudioBtnMain.disabled = false;
    }
  }
  
  // Video button - check limit
  if (downloadVideoBtnMain) {
    if (videoExceeded) {
      downloadVideoBtnMain.style.opacity = '0.5';
      downloadVideoBtnMain.style.cursor = 'not-allowed';
      downloadVideoBtnMain.title = 'Monthly video download limit reached. Upgrade for more.';
      downloadVideoBtnMain.disabled = true;
    } else {
      downloadVideoBtnMain.style.opacity = '1';
      downloadVideoBtnMain.style.cursor = 'pointer';
      downloadVideoBtnMain.title = '';
      downloadVideoBtnMain.disabled = false;
    }
  }
  
  const processingBlocked = monthlyCapExceeded || dailyCapExceeded;
  const processingTitle =
    dailyCapExceeded && !monthlyCapExceeded
      ? 'You have hit today\'s Free-plan allowance. Try again tomorrow—or upgrade to keep going.'
      : 'You have used your included videos for this month. Upgrade to process more without interruption.';

  if (summarizeBtnMain) {
    if (processingBlocked) {
      summarizeBtnMain.style.opacity = '0.5';
      summarizeBtnMain.style.cursor = 'not-allowed';
      summarizeBtnMain.title = processingTitle;
      summarizeBtnMain.disabled = true;
    } else {
      summarizeBtnMain.style.opacity = '1';
      summarizeBtnMain.style.cursor = 'pointer';
      summarizeBtnMain.title = '';
      summarizeBtnMain.disabled = false;
    }
  }
  
  if (fullTextBtnMain) {
    if (processingBlocked) {
      fullTextBtnMain.style.opacity = '0.5';
      fullTextBtnMain.style.cursor = 'not-allowed';
      fullTextBtnMain.title = processingTitle;
      fullTextBtnMain.disabled = true;
    } else {
      fullTextBtnMain.style.opacity = '1';
      fullTextBtnMain.style.cursor = 'pointer';
      fullTextBtnMain.title = '';
      fullTextBtnMain.disabled = false;
    }
  }
}

// Set buttons state for paid plan
function setButtonsForPaidPlan(audioExceeded = false, videoExceeded = false, monthlyCapExceeded = false, limits = null) {
  // All buttons enabled for paid users, but check limits
  if (downloadSubtitleBtnMain) {
    downloadSubtitleBtnMain.style.opacity = '1';
    downloadSubtitleBtnMain.style.cursor = 'pointer';
    downloadSubtitleBtnMain.disabled = false;
    downloadSubtitleBtnMain.title = '';
  }
  
  // Audio button - check limit (null = unlimited)
  if (downloadAudioBtnMain) {
    if (limits && limits.audio !== null && audioExceeded) {
      downloadAudioBtnMain.style.opacity = '0.5';
      downloadAudioBtnMain.style.cursor = 'not-allowed';
      downloadAudioBtnMain.title = 'Monthly audio download limit reached. Upgrade for more.';
      downloadAudioBtnMain.disabled = true;
    } else {
      downloadAudioBtnMain.style.opacity = '1';
      downloadAudioBtnMain.style.cursor = 'pointer';
      downloadAudioBtnMain.title = '';
      downloadAudioBtnMain.disabled = false;
    }
  }
  
  // Video button - check limit (null = unlimited)
  if (downloadVideoBtnMain) {
    if (limits && limits.video !== null && videoExceeded) {
      downloadVideoBtnMain.style.opacity = '0.5';
      downloadVideoBtnMain.style.cursor = 'not-allowed';
      downloadVideoBtnMain.title = 'Monthly video download limit reached. Upgrade for more.';
      downloadVideoBtnMain.disabled = true;
    } else {
      downloadVideoBtnMain.style.opacity = '1';
      downloadVideoBtnMain.style.cursor = 'pointer';
      downloadVideoBtnMain.title = '';
      downloadVideoBtnMain.disabled = false;
    }
  }
  
  const processingTitle =
    'You have used your included videos for this month. Upgrade to process more without interruption.';

  if (summarizeBtnMain) {
    if (monthlyCapExceeded) {
      summarizeBtnMain.style.opacity = '0.5';
      summarizeBtnMain.style.cursor = 'not-allowed';
      summarizeBtnMain.title = processingTitle;
      summarizeBtnMain.disabled = true;
    } else {
      summarizeBtnMain.style.opacity = '1';
      summarizeBtnMain.style.cursor = 'pointer';
      summarizeBtnMain.title = '';
      summarizeBtnMain.disabled = false;
    }
  }
  
  if (fullTextBtnMain) {
    if (monthlyCapExceeded) {
      fullTextBtnMain.style.opacity = '0.5';
      fullTextBtnMain.style.cursor = 'not-allowed';
      fullTextBtnMain.title = processingTitle;
      fullTextBtnMain.disabled = true;
    } else {
      fullTextBtnMain.style.opacity = '1';
      fullTextBtnMain.style.cursor = 'pointer';
      fullTextBtnMain.title = '';
      fullTextBtnMain.disabled = false;
    }
  }
}

function showLoginButton() {
  try {
    window.cutupUserEmail = '';
  } catch {
    /* ignore */
  }
  const lb = document.getElementById('loginBtn');
  const googleWrap = document.querySelector('.google-btn-wrapper');
  if (lb) lb.style.display = '';
  if (googleWrap) googleWrap.style.display = '';
  document.getElementById('userProfile').style.display = 'none';
  resetGoogleButtonState();
  try {
    if (window.userSubscription) window.userSubscription.plan = 'free';
  } catch (_e) {
    /* noop */
  }
  applyCutupPricingPlanLocks({ plan: 'free' });
}

function showUserProfile(user) {
  console.log('[script] showUserProfile called with:', user);
  try {
    window.cutupUserEmail = user && user.email ? String(user.email).trim() : '';
  } catch {
    window.cutupUserEmail = '';
  }

  const loginBtn = document.getElementById('loginBtn');
  const userProfile = document.getElementById('userProfile');
  const avatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userProfileTrigger = document.getElementById('userProfileTrigger');
  const dashboardLink = document.getElementById('dashboardLink');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (!loginBtn || !userProfile || !avatar || !userName || !userProfileTrigger) {
    console.error('[script] User profile elements not found!');
    // Retry after a short delay
    setTimeout(() => {
      showUserProfile(user);
    }, 100);
    return;
  }
  
  loginBtn.style.display = 'none';
  const googleBtnWrap = document.querySelector('.google-btn-wrapper');
  if (googleBtnWrap) googleBtnWrap.style.display = 'none';
  userProfile.style.display = 'flex';
  
  // Set avatar - use user picture or generate avatar
  if (user.picture) {
    avatar.src = user.picture;
    avatar.onerror = () => {
      // If image fails to load, use generated avatar
      avatar.src = generateAvatar(user.name || user.email);
    };
  } else {
    avatar.src = generateAvatar(user.name || user.email);
  }
  
  userName.textContent = user.name || user.email;
  
  // Setup dropdown menu
  const sessionId = localStorage.getItem('cutup_session');
  if (sessionId && dashboardLink) {
    dashboardLink.href = `/dashboard.html?session=${encodeURIComponent(sessionId)}`;
    dashboardLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `/dashboard.html?session=${encodeURIComponent(sessionId)}`;
    });
  }
  
  // Open dropdown on mouse enter
  userProfileTrigger.addEventListener('mouseenter', () => {
    userProfile.classList.add('active');
  });
  
  // Keep dropdown open when mouse is over dropdown menu
  const userDropdown = document.getElementById('userDropdown');
  if (userDropdown) {
    userDropdown.addEventListener('mouseenter', () => {
      userProfile.classList.add('active');
    });
  }
  
  // Close dropdown when mouse leaves the profile area
  userProfile.addEventListener('mouseleave', () => {
    userProfile.classList.remove('active');
  });
  
  // Setup logout button
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (sessionId) {
        try {
          await fetch(`${API_BASE_URL}/api/auth?action=logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Session-Id': sessionId
            },
            body: JSON.stringify({ session: sessionId })
          });
        } catch (error) {
          console.error('Error logging out:', error);
        }
      }
      localStorage.removeItem('cutup_session');
      currentSession = null;
      userProfile.classList.remove('active');
      showLoginButton();
      updateFulltextSoftLockVeil();
      refreshConversionSaveBlockUI();
    });
  }
  
  console.log('[script] User profile displayed successfully');
  updateFulltextSoftLockVeil();
  refreshConversionSaveBlockUI();
  if (typeof window.cutupMaybeTrackReferralSignup === 'function') {
    window.cutupMaybeTrackReferralSignup();
  }
  if (typeof window.cutupRunGrowthOrchestrator === 'function') {
    window.cutupRunGrowthOrchestrator('after_login');
  }
}

// Generate avatar from name/email
function generateAvatar(text) {
  // Use a simple avatar generator service or create initials
  const initials = text
    .split(' ')
    .map(word => word[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
  
  // Use UI Avatars or similar service
  const colors = ['6366f1', '8b5cf6', 'ec4899', 'f59e0b', '10b981', '3b82f6'];
  const color = colors[text.length % colors.length];
  
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=${color}&color=fff&size=128&bold=true&font-size=0.5`;
}

// Login button click - setup in DOMContentLoaded

function resetGoogleButtonState() {
  const btn = document.querySelector('.google-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('loading');
  const label = btn.querySelector('.google-btn-label');
  if (label) label.textContent = 'Continue with Google';
}

window.addEventListener('pageshow', () => {
  resetGoogleButtonState();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetGoogleButtonState();
});

// Logout button is now handled in showUserProfile function

// Download functionality - wait for DOM to be ready
let youtubeUrlInput, audioFileInput, downloadVideoBtnMain, downloadAudioBtnMain;
let downloadSubtitleBtnMain, summarizeBtnMain, fullTextBtnMain, downloadMessage;

document.addEventListener('DOMContentLoaded', () => {
  populateLanguageSelects();
  youtubeUrlInput = document.getElementById('youtubeUrlInput');
  audioFileInput = document.getElementById('audioFileInput');
  downloadVideoBtnMain = document.getElementById('downloadVideoBtnMain');
  downloadAudioBtnMain = document.getElementById('downloadAudioBtnMain');
  downloadSubtitleBtnMain = document.getElementById('downloadSubtitleBtnMain');
  downloadMessage = document.getElementById('downloadMessage');
  summarizeBtnMain = document.getElementById('summarizeBtnMain');
  fullTextBtnMain = document.getElementById('fullTextBtnMain');
  
  // Setup login button event listener using event delegation (simple and reliable)
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('#loginBtn');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    if (cutupIsLoggedIn()) {
      console.log('[script] Login click ignored — session already present');
      return;
    }

    console.log('[script] Login button clicked, fetching auth URL from /api/oauth/google/start...');
    try {
      await cutupTriggerGoogleLogin();
    } catch (_err) {
      /* cutupTriggerGoogleLogin already surfaced error */
    }
  });

  setupLandingPricingCheckoutIntercept();
  initCutupFaqAccordion();
  
  console.log('[script] Login button event listener attached (event delegation)');
  
  // Setup event listeners for YouTube buttons
  if (downloadVideoBtnMain) {
    downloadVideoBtnMain.addEventListener('click', async () => {
      await handleVideoDownload();
    });
  }
  
  if (downloadAudioBtnMain) {
    downloadAudioBtnMain.addEventListener('click', async () => {
      await handleAudioDownload();
    });
  }
  
  if (fullTextBtnMain) {
    fullTextBtnMain.addEventListener('click', async () => {
      await handleFullText('fulltext');
    });
  }
  
  if (downloadSubtitleBtnMain) {
    downloadSubtitleBtnMain.addEventListener('click', async () => {
      await handleSrtSubtitles();
    });
  }
  
  // Setup input event listeners
  if (youtubeUrlInput) {
    youtubeUrlInput.addEventListener('input', () => {
      checkInput();
    });
  }

  const instagramUrlInput = document.getElementById('instagramUrlInput');
  if (instagramUrlInput) {
    instagramUrlInput.addEventListener('input', () => {
      checkInput();
    });
  }

  const tiktokUrlInput = document.getElementById('tiktokUrlInput');
  if (tiktokUrlInput) {
    tiktokUrlInput.addEventListener('input', () => {
      checkInput();
    });
  }
});

// Check if YouTube URL is valid (accepts any subdomain)
function isYouTubeUrl(url) {
  if (!url || !url.trim()) return false;
  // Check if URL contains youtube.com or youtu.be (any subdomain)
  return /youtube\.com|youtu\.be/.test(url);
}

// Check if TikTok URL is valid (accepts any subdomain including short links)
function isTikTokUrl(url) {
  if (!url || !url.trim()) return false;
  // Check if URL contains tiktok.com (any subdomain like vt.tiktok.com, vm.tiktok.com, www.tiktok.com, etc.)
  return /tiktok\.com/.test(url);
}

// Check if Instagram URL is valid (accepts any subdomain)
function isInstagramUrl(url) {
  if (!url || !url.trim()) return false;
  // Check if URL contains instagram.com (any subdomain)
  return /instagram\.com/.test(url);
}

// Check URL based on current platform - strict validation
function isValidUrl(url) {
  if (!url || !url.trim()) {
    return false;
  }
  
  if (currentPlatform === 'youtube') {
    return isYouTubeUrl(url);
  } else if (currentPlatform === 'tiktok') {
    return isTikTokUrl(url);
  } else if (currentPlatform === 'instagram') {
    return isInstagramUrl(url);
  }
  return false;
}

function detectPlatformFromUrl(url) {
  if (!url || !url.trim()) return null;
  if (isYouTubeUrl(url)) return 'youtube';
  if (isInstagramUrl(url)) return 'instagram';
  if (isTikTokUrl(url)) return 'tiktok';
  return null;
}

function getActivePlatformFromTab() {
  const activeTab = document.querySelector('.platform-tab.active');
  return activeTab?.dataset?.tab || null;
}

function resolveRequestedPlatform(url, file) {
  if (file) return 'audiofile';
  const byUrl = detectPlatformFromUrl(url);
  if (byUrl) return byUrl;
  return getActivePlatformFromTab() || currentPlatform || 'youtube';
}

// Get platform name in Persian
function getPlatformName(platform) {
  const names = {
    'youtube': 'YouTube',
    'tiktok': 'TikTok',
    'instagram': 'Instagram'
  };
  return names[platform] || platform;
}

// Get example URL for platform
function getExampleUrl(platform) {
  const examples = {
    'youtube': 'https://youtube.com/watch?v=...',
    'tiktok': 'https://www.tiktok.com/@username/video/...',
    'instagram': 'https://www.instagram.com/p/...'
  };
  return examples[platform] || '';
}

// Show message (toast-style; timings tuned so errors are readable on mobile)
function showMessage(text, type = 'info') {
  if (!downloadMessage) return;
  downloadMessage.textContent = text;
  downloadMessage.className = `download-message ${type}`;
  downloadMessage.style.display = 'block';
  clearTimeout(downloadMessage._hideT);
  const ms = type === 'error' ? 10000 : type === 'info' ? 8000 : 5500;
  downloadMessage._hideT = setTimeout(() => {
    downloadMessage.style.display = 'none';
  }, ms);
}

function trackEvent(eventName, properties = {}) {
  try {
    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture(eventName, properties);
    }
    if (window.gtag && typeof window.gtag === 'function') {
      window.gtag('event', eventName, properties);
    }
  } catch (error) {
    console.warn('[tracking] failed to track event:', eventName, error);
  }
}

// Check if user is logged in
function checkLogin() {
  const sessionId = localStorage.getItem('cutup_session');
  if (!sessionId) {
    // Save current URL and platform before showing login message
    const url = getCurrentUrl();
    const platform = currentPlatform || 'youtube';
    
    if (url && url.trim()) {
      // Save URL and platform to localStorage
      localStorage.setItem('cutup_pending_url', url);
      localStorage.setItem('cutup_pending_platform', platform);
      console.log('[script] Saved pending URL:', url, 'Platform:', platform);
    }
    
    showMessage('Sign in to continue—we saved your link for right after you log in.', 'error');
    // Scroll to login button
    document.getElementById('loginBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight login button
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.style.animation = 'pulse 1s ease-in-out 3';
      setTimeout(() => {
        loginBtn.style.animation = '';
      }, 3000);
    }
    return false;
  }
  return sessionId;
}

// Handle paste button - common function for all paste buttons
async function handlePaste(inputElement) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      if (inputElement) {
        inputElement.value = text;
      checkInput();
        if (isValidUrl(text)) {
          showMessage('Link looks good. Choose Summarize, Subtitles, or Full Transcript above.', 'info');
        }
        // Error message is already shown in checkInput() if URL is invalid
      }
    } else {
      showMessage('Clipboard was empty—paste your link into the field.', 'error');
    }
  } catch (error) {
    console.error('Error reading clipboard:', error);
    showMessage('We couldn\'t read the clipboard. Paste the link manually.', 'error');
  }
}

// Setup paste buttons for all platforms
document.addEventListener('DOMContentLoaded', () => {
  // YouTube paste button
  const pasteBtnMain = document.getElementById('pasteBtnMain');
  if (pasteBtnMain) {
    pasteBtnMain.addEventListener('click', async () => {
      const input = getCurrentUrlInput();
      await handlePaste(input);
    });
  }
  
  // Instagram paste button
  const pasteInstagramBtn = document.getElementById('pasteInstagramBtn');
  if (pasteInstagramBtn) {
    pasteInstagramBtn.addEventListener('click', async () => {
      const input = document.getElementById('instagramUrlInput');
      await handlePaste(input);
    });
  }
  
  // TikTok paste button
  const pasteTiktokBtn = document.getElementById('pasteTiktokBtn');
  if (pasteTiktokBtn) {
    pasteTiktokBtn.addEventListener('click', async () => {
      const input = document.getElementById('tiktokUrlInput');
      await handlePaste(input);
    });
  }
});

// Setup event listeners for all platform buttons
document.addEventListener('DOMContentLoaded', () => {
  // YouTube buttons (already have listeners, but ensure they work)
  
  // Instagram buttons
  const downloadVideoBtnInstagram = document.getElementById('downloadVideoBtnInstagram');
  if (downloadVideoBtnInstagram) {
    downloadVideoBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleVideoDownload();
      currentPlatform = originalPlatform;
    });
  }
  
  const downloadAudioBtnInstagram = document.getElementById('downloadAudioBtnInstagram');
  if (downloadAudioBtnInstagram) {
    downloadAudioBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleAudioDownload();
      currentPlatform = originalPlatform;
    });
  }
  
  const downloadSubtitleBtnInstagram = document.getElementById('downloadSubtitleBtnInstagram');
  if (downloadSubtitleBtnInstagram) {
    downloadSubtitleBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleSrtSubtitles();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnInstagram = document.getElementById('fullTextBtnInstagram');
  if (fullTextBtnInstagram) {
    fullTextBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleFullText('fulltext');
      currentPlatform = originalPlatform;
    });
  }
  
  // TikTok buttons
  const downloadVideoBtnTiktok = document.getElementById('downloadVideoBtnTiktok');
  if (downloadVideoBtnTiktok) {
    downloadVideoBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleVideoDownload();
      currentPlatform = originalPlatform;
    });
  }
  
  const downloadAudioBtnTiktok = document.getElementById('downloadAudioBtnTiktok');
  if (downloadAudioBtnTiktok) {
    downloadAudioBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleAudioDownload();
      currentPlatform = originalPlatform;
    });
  }
  
  const downloadSubtitleBtnTiktok = document.getElementById('downloadSubtitleBtnTiktok');
  if (downloadSubtitleBtnTiktok) {
    downloadSubtitleBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleSrtSubtitles();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnTiktok = document.getElementById('fullTextBtnTiktok');
  if (fullTextBtnTiktok) {
    fullTextBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleFullText('fulltext');
      currentPlatform = originalPlatform;
    });
  }
  
  // Audio file buttons
  const downloadSubtitleBtnAudiofile = document.getElementById('downloadSubtitleBtnAudiofile');
  if (downloadSubtitleBtnAudiofile) {
    downloadSubtitleBtnAudiofile.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'audiofile';
      await handleSrtSubtitles();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnAudiofile = document.getElementById('fullTextBtnAudiofile');
  if (fullTextBtnAudiofile) {
    fullTextBtnAudiofile.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'audiofile';
      await handleFullText('fulltext');
      currentPlatform = originalPlatform;
    });
  }
  
  // Setup platform tabs
  document.querySelectorAll('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const platform = tab.dataset.tab;
      if (platform) {
        switchPlatform(platform);
      }
    });
  });

  wireHeroQuickStart();
});

function wireHeroQuickStart() {
  const heroInput = document.getElementById('heroUrlInput');
  const heroBtn = document.getElementById('heroGenerateBtn');
  const heroDemo = document.getElementById('heroSeeDemoBtn');
  if (!heroBtn || !heroInput) return;

  heroBtn.addEventListener('click', () => {
    const v = (heroInput.value || '').trim();
    if (!v) {
      heroInput.focus();
      showMessage('Paste a video link—your first preview runs without signup.', 'info');
      return;
    }
    let platform = 'youtube';
    if (isTikTokUrl(v)) platform = 'tiktok';
    else if (isInstagramUrl(v)) platform = 'instagram';
    else if (!isYouTubeUrl(v)) {
      showMessage('Use a YouTube, TikTok, or Instagram link—or scroll down and upload a file.', 'info');
      return;
    }

    switchPlatform(platform);
    const input = getCurrentUrlInput();
    if (input) input.value = v;
    checkInput();

    document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showMessage('Tap “Generate Subtitles” below—preview loads in seconds.', 'success');
  });

  heroInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      heroBtn.click();
    }
  });

  if (heroDemo) {
    heroDemo.addEventListener('click', () => {
      document.getElementById('demo-sample')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

// Extract common handlers
async function handleVideoDownload() {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = getCurrentUrl();
  if (!isValidUrl(url)) {
    const platformName = getPlatformName(currentPlatform);
    showMessage(`That doesn\'t look like a valid ${platformName} link. Double-check and try again.`, 'error');
    return;
  }
  
  try {
    const limitCheck = await checkSubscriptionLimit(sessionId, 'downloadVideo', 0);
    if (limitCheck && !limitCheck.allowed) {
      showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
      window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
      return;
    }
    
    showMessage('Loading quality options…', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url, platform: currentPlatform })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('Failed to fetch formats');
    }
    
    const formatsData = await formatsResponse.json();
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    const subData = await subResponse.ok ? await subResponse.json() : { plan: 'free' };
    const userPlan = subData.plan || 'free';
    const isPro = userPlan !== 'free' && userPlan !== 'starter';
    const isStarter = userPlan === 'starter';
    const maxQuality = subData.features?.maxVideoQuality || '480p';
    
    // For TikTok and Instagram, use simpler format list
    let availableFormats;
    if (currentPlatform === 'tiktok' || currentPlatform === 'instagram') {
      availableFormats = formatsData.available?.video || ['best', '1080p', '720p', '480p', '360p'];
    } else {
      availableFormats = formatsData.available?.video || ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
    }
    
    // For free plan, filter out high qualities (don't show them at all)
    // For starter plan, show all qualities but only enable 480p and 360p
    // For pro/business, show all and enable all
    if (userPlan === 'free' && maxQuality === '480p') {
      availableFormats = availableFormats.filter(q => {
        const qualityNum = parseInt(q.replace('p', ''));
        return qualityNum <= 480 || q === '480p';
      });
    }
    // For starter plan, keep all formats (they will be shown but locked)
    
    showQualityModal(availableFormats, url, sessionId, isPro, isStarter, userPlan, 'video');
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('qualities', error);
    showMessage(USER_ERROR_GENERIC, 'error');
    setTimeout(() => {
      const downloadMessage = document.getElementById('downloadMessage');
      if (downloadMessage && downloadMessage.textContent.includes('Loading quality options')) {
        downloadMessage.style.display = 'none';
  }
    }, 3000);
  }
}

async function handleAudioDownload() {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = getCurrentUrl();
  if (!isValidUrl(url)) {
    const platformName = getPlatformName(currentPlatform);
    showMessage(`That doesn\'t look like a valid ${platformName} link. Double-check and try again.`, 'error');
    return;
  }
  
  try {
    const limitCheck = await checkSubscriptionLimit(sessionId, 'downloadAudio', 0);
    if (limitCheck && !limitCheck.allowed) {
      showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
      window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
      return;
    }
    
    showMessage('Loading quality options…', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url, platform: currentPlatform })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('Failed to fetch formats');
    }
    
    const formatsData = await formatsResponse.json();
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    const subData = await subResponse.ok ? await subResponse.json() : { plan: 'free' };
    const userPlan = subData.plan || 'free';
    const isPro = userPlan !== 'free';
    
    // For TikTok and Instagram, use simpler format list
    let availableFormats;
    if (currentPlatform === 'tiktok' || currentPlatform === 'instagram') {
      availableFormats = formatsData.available?.audio || ['best', '320k', '256k', '192k', '128k'];
    } else {
      availableFormats = formatsData.available?.audio || ['best', '320k', '256k', '192k', '128k', '96k', '64k'];
    }
    showQualityModal(availableFormats, url, sessionId, isPro, false, userPlan, 'audio');
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('qualities', error);
    showMessage(USER_ERROR_GENERIC, 'error');
    // Dismiss quality-picker loading toast if still visible
    setTimeout(() => {
      const downloadMessage = document.getElementById('downloadMessage');
      if (downloadMessage && downloadMessage.textContent.includes('Loading quality options')) {
        downloadMessage.style.display = 'none';
  }
    }, 3000);
  }
}

async function handleSummarize() {
  const sessionId = localStorage.getItem('cutup_session');
  
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  const requestedPlatform = resolveRequestedPlatform(url, file);
  
  if (!url && !file) {
    if (currentPlatform === 'audiofile') {
      showMessage('Please select an audio/video file.', 'error');
    } else {
      showMessage('Please paste a valid link first.', 'error');
    }
      return;
    }

  const estMin = file ? Math.max(1, Math.ceil((file.size / 1024 / 1024) * 1.2)) : AVG_VIDEO_MINUTES;
  const monGate = await monetizationPreflightBeforeProcess(sessionId, estMin);
  if (!monGate.allowed) {
    showMessage(monGate.reason || LIMIT_UPGRADE_FALLBACK, 'error');
    return;
  }
    
  if (file && (currentPlatform === 'audiofile' || !url || url.startsWith('📁'))) {
    trackEvent('link_submitted', { platform: 'file', mode: 'summary', auth: !!sessionId });
    await processSummarizeFile(file, sessionId);
  } else if (requestedPlatform === 'youtube' && isYouTubeUrl(url)) {
    trackEvent('link_submitted', { platform: 'youtube', mode: 'summary', auth: !!sessionId });
    await processSummarize(url, sessionId, 'youtube');
  } else if ((requestedPlatform === 'instagram' && isInstagramUrl(url)) || (requestedPlatform === 'tiktok' && isTikTokUrl(url))) {
    trackEvent('link_submitted', { platform: requestedPlatform, mode: 'summary', auth: !!sessionId });
    await processSummarize(url, sessionId, requestedPlatform);
  } else {
    showMessage('Invalid URL for the selected platform.', 'error');
  }
}

async function handleFullText(activeTab = 'fulltext') {
  const sessionId = localStorage.getItem('cutup_session');
    
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  const requestedPlatform = resolveRequestedPlatform(url, file);
    
  if (!url && !file) {
    if (currentPlatform === 'audiofile') {
      showMessage('Please select an audio/video file.', 'error');
    } else {
      showMessage('Please paste a valid link first.', 'error');
    }
      return;
    }

  const estMin = file ? Math.max(1, Math.ceil((file.size / 1024 / 1024) * 1.2)) : AVG_VIDEO_MINUTES;
  const monGate = await monetizationPreflightBeforeProcess(sessionId, estMin);
  if (!monGate.allowed) {
    showMessage(monGate.reason || LIMIT_UPGRADE_FALLBACK, 'error');
    return;
  }
    
  if (file && (currentPlatform === 'audiofile' || !url || url.startsWith('📁'))) {
    trackEvent('link_submitted', { platform: 'file', mode: 'fulltext', auth: !!sessionId });
    await processFullTextFile(file, sessionId, activeTab);
  } else if (requestedPlatform === 'youtube' && isYouTubeUrl(url)) {
    trackEvent('link_submitted', { platform: 'youtube', mode: 'fulltext', auth: !!sessionId });
    await processFullText(url, sessionId, 'youtube', activeTab);
  } else if ((requestedPlatform === 'instagram' && isInstagramUrl(url)) || (requestedPlatform === 'tiktok' && isTikTokUrl(url))) {
    trackEvent('link_submitted', { platform: requestedPlatform, mode: 'fulltext', auth: !!sessionId });
    await processFullText(url, sessionId, requestedPlatform, activeTab);
  } else {
    showMessage('Invalid URL for the selected platform.', 'error');
  }
}

async function handleSrtSubtitles() {
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  if (!url && !file) {
    if (currentPlatform === 'audiofile') {
      showMessage('Please select an audio/video file.', 'error');
    } else {
      showMessage('Please paste a valid link first.', 'error');
    }
    return;
  }

  const key = getTranscriptionCacheKey();
  const cached = window.cutupLastTranscription;
  if (cached && key && cached.cacheKey === key) {
    const hasText = typeof cached.fullText === 'string' && cached.fullText.trim().length > 0;
    const hasSeg = Array.isArray(cached.segments) && cached.segments.length > 0;
    if (hasText || hasSeg) {
      displayResults(cached.summary, cached.fullText, cached.segments || [], {
        ...cached.lastDisplayOptions,
        outputMode: 'srt',
        activeTab: 'srt',
        cacheReplay: true
      });
      return;
    }
  }

  const hasSrt = !!(window.currentSrtContent && String(window.currentSrtContent).trim());
  const resultSection = document.getElementById('resultSection');
  if (hasSrt && resultSection && resultSection.style.display !== 'none' && cached && key && cached.cacheKey === key) {
    displayResults(cached.summary, cached.fullText, cached.segments || [], {
      ...cached.lastDisplayOptions,
      outputMode: 'srt',
      activeTab: 'srt',
      cacheReplay: true
    });
    return;
  }

  await handleFullText('srt');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractSocialAudio(url, platform, sessionId) {
  if (!sessionId) {
    throw new Error('Sign in required for Instagram/TikTok transcription. Uploading a file is available after login.');
  }
  if (platform !== 'instagram' && platform !== 'tiktok') {
    throw new Error('Unsupported platform for social extraction');
  }

  const response = await fetch(`${API_BASE_URL}/api/youtube-download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId
    },
    body: JSON.stringify({
      url,
      type: 'audio',
      quality: 'best',
      platform
    }),
    signal: AbortSignal.timeout(900000)
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    console.error(`SOCIAL_EXTRACT_${platform.toUpperCase()}:`, response.status, errBody);
    throw new Error('Instagram/TikTok transcription is not available yet. Download the audio/video and upload it here to transcribe.');
  }

  const audioBlob = await response.blob();
  if (!audioBlob || !audioBlob.size) {
    throw new Error('No audio was returned from downloader');
  }

  const audioUrl = await blobToDataUrl(audioBlob);
  return {
    audioUrl,
    language: null,
    subtitles: null,
    subtitleLanguage: null,
    availableLanguages: [],
    title: `${platform} video`,
    duration: null
  };
}

// Extract video ID
function extractVideoId(url) {
  const patterns = [
    /[?&]v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Generate SRT from subtitles
function generateSRTFromSubtitles(subtitles, language) {
  if (!subtitles || subtitles.length === 0) return '';
  
  let srtContent = '';
  subtitles.forEach((sub, index) => {
    const startTime = formatSRTTime(sub.start || sub.startTime || 0);
    const endTime = formatSRTTime(sub.end || sub.endTime || sub.start + 5);
    const text = sub.text || sub.content || '';
    
    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${text}\n\n`;
  });
  
  return srtContent;
}

// Format time for SRT
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/* ========== Monetization: preflight GET check + inline paywall ========== */
let monetizationNearLimitLogged = false;

function setMonetizationUpgradeHref() {
  const a = document.getElementById('monetizationUpgradeBtn');
  if (!a) return;
  const sid = localStorage.getItem('cutup_session');
  a.href = sid ? `/dashboard.html?session=${encodeURIComponent(sid)}` : '/dashboard.html';
}

function applyMonetizationPaywallFromServer(data) {
  const wrap = document.getElementById('monetizationPaywall');
  const msg = document.getElementById('monetizationPaywallMsg');
  if (!wrap || !msg) return;

  if (!data) {
    wrap.hidden = true;
    wrap.dataset.state = 'hidden';
    msg.textContent = '';
    return;
  }

  const blocked = data.allowed === false;
  const near = !!data.nearLimit && !blocked;

  if (blocked) {
    wrap.hidden = false;
    wrap.dataset.state = 'blocked';
    msg.textContent = 'You’ve reached your limit';
    setMonetizationUpgradeHref();
    return;
  }

  if (near) {
    wrap.hidden = false;
    wrap.dataset.state = 'near';
    msg.textContent = 'You’re almost out of free credits';
    setMonetizationUpgradeHref();
    return;
  }

  wrap.hidden = true;
  wrap.dataset.state = 'hidden';
  msg.textContent = '';
}

async function monetizationFetchCheckGET(sessionId, videoDurationMinutes) {
  if (!sessionId) return null;
  const params = new URLSearchParams({
    action: 'check',
    session: sessionId,
    feature: 'transcription',
    videoDurationMinutes: String(Math.max(0, Math.round(Number(videoDurationMinutes) || 0)))
  });
  const r = await fetch(`${API_BASE_URL}/api/subscription?${params.toString()}`, {
    headers: { 'X-Session-Id': sessionId }
  });
  if (!r.ok) return null;
  return r.json();
}

/** Before processing (logged-in): GET check; block without calling transcribe APIs. */
async function monetizationPreflightBeforeProcess(sessionId, estimatedMinutes) {
  if (!sessionId) {
    applyMonetizationPaywallFromServer(null);
    return { allowed: true };
  }

  const est = Math.max(1, Math.round(Number(estimatedMinutes) || AVG_VIDEO_MINUTES));
  const data = await monetizationFetchCheckGET(sessionId, est);
  if (!data) {
    applyMonetizationPaywallFromServer(null);
    return { allowed: false, reason: USER_PLAN_VERIFY_FAIL };
  }

  applyMonetizationPaywallFromServer(data);

  if (data.allowed === false) {
    console.log('[monetization] limit reached');
    const reason = data.reason ? humanizeLimitReason(String(data.reason)) : LIMIT_UPGRADE_FALLBACK;
    return { allowed: false, reason };
  }

  if (data.nearLimit && !monetizationNearLimitLogged) {
    monetizationNearLimitLogged = true;
    console.log('[monetization] near limit');
  }

  return { allowed: true };
}

/** Refresh paywall when plan usage changes (e.g. after login) — uses typical job size. */
async function monetizationRefreshPaywallPassive() {
  const sessionId = localStorage.getItem('cutup_session');
  if (!sessionId) {
    applyMonetizationPaywallFromServer(null);
    return;
  }
  const data = await monetizationFetchCheckGET(sessionId, AVG_VIDEO_MINUTES);
  if (data) applyMonetizationPaywallFromServer(data);
}

function setupMonetizationPaywallUi() {
  setMonetizationUpgradeHref();
  document.getElementById('monetizationUpgradeBtn')?.addEventListener('click', () => {
    console.log('[monetization] upgrade clicked');
  });
  document.getElementById('monetizationPricingLink')?.addEventListener('click', () => {
    console.log('[monetization] upgrade clicked');
  });
}

// Check subscription limit before processing
async function checkSubscriptionLimit(sessionId, feature, videoDurationMinutes = 0) {
  try {
    if (!sessionId) {
      return { allowed: true, reason: 'Preview mode: no auth' };
    }

    const response = await fetch(`${API_BASE_URL}/api/subscription?action=check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ feature, videoDurationMinutes })
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn('Subscription check failed with status:', response.status, errorText);
      return { allowed: false, reason: USER_PLAN_VERIFY_FAIL };
    }
    
    const data = await response.json();
    if (data && data.allowed === false && data.reason) {
      data.reason = humanizeLimitReason(data.reason);
    }
    return data;
  } catch (error) {
    console.error('Error checking subscription limit:', error);
    return { allowed: false, reason: 'Unable to verify your plan. Please try again.' };
  }
}

// Event listeners are now set up in DOMContentLoaded above

// Process summarize for file
async function processSummarizeFile(file, sessionId) {
  const isPreviewMode = !sessionId;
  try {
    // Show progress bar
    showProgressBar('Processing your file…', false);
    updateProgressBar(0, 0, 0, 'Checking file…');
    
    // Check file size (limit to 100MB like extension)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxFileSize) {
      showMessage(`File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max size is ${maxFileSize / 1024 / 1024}MB.`, 'error');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 5, 'File validated');
    
    // Estimate duration for limit check
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    
    // Check subscription limit
    updateProgressBar(0, 0, 8, sessionId ? 'Checking your plan…' : 'Running free preview…');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', estimatedDurationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
      window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 10, 'Preparing transcription…');
    
    // Transcribe using transcribeAudio (like extension)
    const estimatedTranscriptionTime = estimateTranscriptionDuration(file.size, null);
    startProgressTracking(10, 70, estimatedTranscriptionTime, 'Reading your file…', 'Transcribing…');
    const transcription = await transcribeAudio(file, null, sessionId, {
      platform: 'upload',
      filename: file.name || 'uploaded-file',
      sourceUrl: 'upload://local-file'
    });
    stopProgressTracking(70, 'Transcription complete');
    
    // Summarize (unlimited for all tiers)
    const estimatedSummaryTime = estimateSummarizationDuration(transcription.text.length);
    startProgressTracking(70, 99, estimatedSummaryTime, 'Writing summary…', 'Writing summary…');
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, normalizeSummaryLanguage(transcription.language), sessionId, {
        platform: 'upload',
        title: file.name || 'Uploaded file',
        sourceUrl: 'upload://local-file'
      });
      stopProgressTracking(99, 'Summary generated');
    } catch (error) {
      console.error('Error in summarization:', error);
      stopProgressTracking(99, 'Summary generated');
      // Continue without summary if check fails
      summary = {
        keyPoints: ['Summary fallback'],
        summary: 'We saved your transcript, but the AI summary is temporarily unavailable. Try again in a moment.'
      };
    }
    
    // Final update to 100%
    setTimeout(() => {
      updateProgressBar(0, 0, 100, 'All set');
    }, 350);
    
    // Display results in result section — summary tab active by default
    displayResults(summary, transcription.text, transcription.segments || [], {
      originalLanguage: transcription.language,
      activeTab: 'summary',
      outputMode: 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: estimatedDurationMinutes * 60,
      title: file.name || 'Uploaded file',
      platform: 'upload',
      sourceUrl: 'upload://local-file'
    });
    trackEvent('transcript_generated', { mode: 'summary', source: 'file', auth: !!sessionId, preview: isPreviewMode });
    
    if (sessionId) {
    // Save to dashboard
      await saveToDashboard(sessionId, {
        title: file.name,
        type: 'summarize',
        transcription: transcription.text,
        summary,
        keyPoints: summary.keyPoints || [],
        duration: estimatedDurationMinutes * 60
      });
    
    // Update buttons after usage
      await updateButtonsBasedOnSubscription(sessionId);
    }
    
    // Hide progress bar
    hideProgressBar();
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('process', error);
    showMessage(USER_ERROR_GENERIC, 'error');
    hideProgressBar();
  }
}

// Process full text for file
async function processFullTextFile(file, sessionId, activeTab = 'fulltext') {
  const isPreviewMode = !sessionId;
  try {
    // Show progress bar
    showProgressBar('Processing your file…', false);
    updateProgressBar(0, 0, 0, 'Checking file…');
    
    // Check file size (limit to 100MB like extension)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxFileSize) {
      showMessage(`File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max size is ${maxFileSize / 1024 / 1024}MB.`, 'error');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 5, 'File validated');
    
    // Estimate duration for limit check
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    
    // Check subscription limit
    updateProgressBar(0, 0, 8, sessionId ? 'Checking your plan…' : 'Running free preview…');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', estimatedDurationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
      window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 10, 'Preparing transcription…');
    
    // Transcribe using transcribeAudio (like extension)
    const estimatedTranscriptionTime = estimateTranscriptionDuration(file.size, null);
    startProgressTracking(10, 99, estimatedTranscriptionTime, 'Reading your file…', 'Transcribing…');
    const transcription = await transcribeAudio(file, null, sessionId, {
      platform: 'upload',
      filename: file.name || 'uploaded-file',
      sourceUrl: 'upload://local-file'
    });
    stopProgressTracking(99, 'Transcription complete');
    
    // Summary is best-effort; transcript/SRT should still succeed if it fails
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, normalizeSummaryLanguage(transcription.language), sessionId, {
        platform: 'upload',
        title: file.name || 'Uploaded file',
        sourceUrl: 'upload://local-file'
      });
    } catch (summaryErr) {
      console.warn('Summary generation failed for file flow:', summaryErr);
      summary = { unavailable: true, message: 'Summary could not be generated for this file.' };
    }

    // Final update to 100%
    setTimeout(() => {
      updateProgressBar(0, 0, 100, 'All set');
    }, 350);
    
    // Display results and keep all useful tabs available
    displayResults(summary, transcription.text, transcription.segments || [], {
      originalLanguage: transcription.language,
      activeTab,
      outputMode: activeTab === 'srt' ? 'srt' : 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: estimatedDurationMinutes * 60,
      title: file.name || 'Uploaded file',
      platform: 'upload',
      sourceUrl: 'upload://local-file'
    });
    trackEvent('transcript_generated', { mode: 'fulltext', source: 'file', auth: !!sessionId, preview: isPreviewMode });
    
    if (sessionId) {
    // Save to dashboard
      await saveToDashboard(sessionId, {
        title: file.name,
        type: 'transcription',
        transcription: transcription.text,
        segments: transcription.segments || [],
        duration: estimatedDurationMinutes * 60
      });
    
    // Update buttons after usage
      await updateButtonsBasedOnSubscription(sessionId);
    }
    
    // Hide progress bar
    hideProgressBar();
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('process', error);
    showMessage(USER_ERROR_GENERIC, 'error');
    hideProgressBar();
  }
}

// Extract YouTube audio (like extension)
async function extractYouTubeAudio(url, sessionId = null) {
    const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }
  
  console.log('YOUTUBE: Extracting audio for video ID:', videoId);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/youtube`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-Id': sessionId } : {})
      },
      body: JSON.stringify({ videoId, url }),
      signal: AbortSignal.timeout(300000) // 5 minutes timeout
    });

    console.log('YOUTUBE: Response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('YOUTUBE: Error:', error);
      
      let errorMessage = USER_ERROR_GENERIC;
      if (error.error === 'FILE_TOO_LARGE') {
        errorMessage = 'Video is too large. Try a shorter clip.';
      }
      console.error('YOUTUBE: Server error body', error);
      throw new Error(errorMessage);
    }

    const result = await response.json();
    console.log('YOUTUBE: Success, audio URL received, language hint:', result.language);
    console.log('YOUTUBE: Subtitles available:', !!result.subtitles, 'Language:', result.subtitleLanguage);
    console.log('YOUTUBE: Available languages:', result.availableLanguages);
    console.log('YOUTUBE: Video title:', result.title);
    
    // Return in same format as extension
    if (typeof result === 'string') {
      return { 
        audioUrl: result, 
        language: null, 
        subtitles: null, 
        subtitleLanguage: null, 
        availableLanguages: [], 
        title: null,
        duration: null
      };
    }
    return {
      audioUrl: result.audioUrl,
      language: result.language || null,
      subtitles: result.subtitles || null,
      subtitleLanguage: result.subtitleLanguage || null,
      availableLanguages: result.availableLanguages || [],
      title: result.title || null,
      duration: result.duration || null
    };
    
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error('YOUTUBE: Request timeout');
      throw new Error('Request timed out. Retry with a shorter video.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('YOUTUBE: Network error', error);
      throw new Error('Network error. Check your connection and retry.');
    } else {
      throw error;
    }
  }
}

// Transcribe audio (like extension)
async function transcribeAudio(audioUrlOrFile, languageHint = null, sessionId = null, contextMeta = {}) {
  try {
    let response;
    
    // If it's a File object, send to upload endpoint
    if (audioUrlOrFile instanceof File) {
      const formData = new FormData();
      formData.append('file', audioUrlOrFile);
      
      console.log('TRANSCRIBE: Sending file to upload endpoint, size:', audioUrlOrFile.size, 'bytes');
      
      response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: {
          ...(sessionId ? { 'X-Session-Id': sessionId } : {})
        },
        body: formData,
        signal: AbortSignal.timeout(900000) // 15 minutes timeout
      });
    } else {
      // Handle JSON request (audioUrl)
      console.log('TRANSCRIBE: Sending request to', `${API_BASE_URL}/api/transcribe`);
      
      const body = { audioUrl: audioUrlOrFile, languageHint, metadata: contextMeta };
      
      console.log('TRANSCRIBE: Body size:', JSON.stringify(body).length, 'bytes');
      
      response = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          ...(sessionId ? { 'X-Session-Id': sessionId } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(900000) // 15 minutes timeout
      });
    }

    console.log('TRANSCRIBE: Response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Transcribe error:', {
        status: response.status,
        statusText: response.statusText,
        error: error
      });
      
      let errorMessage = USER_ERROR_GENERIC;
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'This action is not allowed. Check your plan or sign in again.';
      }
      console.error('TRANSCRIBE: Server error body', error);
      throw new Error(errorMessage);
    }
    
    const result = await response.json();
    
    console.log('TRANSCRIBE: Response parsed:', {
      hasText: !!result.text,
      textLength: result.text?.length || 0,
      hasSegments: !!result.segments,
      segmentsCount: result.segments?.length || 0,
      hasError: !!result.error
    });
    
    if (!result || !result.text || result.text.trim().length === 0) {
      console.error('TRANSCRIBE: No text in result:', result);
      throw new Error(`No transcript returned. ${result.error ? result.message : 'Please retry.'}`);
    }
    
    console.log('TRANSCRIBE: Success, text length:', result.text.length);
    console.log('TRANSCRIBE: Segments count:', result.segments?.length || 0);
    
    cutupLangDebug({
      phase: 'transcribeAudio:response',
      language: result.language ?? null,
      textChars: result.text?.length ?? 0,
      segmentCount: Array.isArray(result.segments) ? result.segments.length : 0,
      hadLanguageHint: languageHint != null && languageHint !== ''
    });
    return {
      text: result.text,
      language: result.language ?? null,
      segments: (result.segments && Array.isArray(result.segments)) ? result.segments : []
    };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error('TRANSCRIBE: Request timeout');
      throw new Error('Transcription timed out. Try a smaller file.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('TRANSCRIBE: Network error', error);
      throw new Error('Network error. Check your connection and retry.');
    } else {
      throw error;
    }
  }
}

// Summarize text (like extension)
async function summarizeText(text, language = null, sessionId = null, contextMeta = {}) {
  console.log('SUMMARIZE: Sending request, text length:', text.length, 'language:', language);
  
  try {
    const payload = { text, metadata: contextMeta };
    if (language != null && language !== '') {
      payload.language = language;
    }
    cutupLangDebug({ phase: 'summarize:request', language: payload.language ?? null, textChars: text.length });
    const response = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-Id': sessionId } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000) // 2 minutes timeout
    });

    console.log('SUMMARIZE: Response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Summarize error:', {
        status: response.status,
        statusText: response.statusText,
        error: error
      });
      console.error('SUMMARIZE: Server error body', error);
      throw new Error(USER_ERROR_GENERIC);
    }

    const result = await response.json();
    console.log('SUMMARIZE: Success');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error('SUMMARIZE: Request timeout');
      throw new Error('Summarization timed out. Please retry.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('SUMMARIZE: Network error', error);
      throw new Error('Network error. Check your connection and retry.');
    } else {
      throw error;
    }
  }
}

// Parse YouTube VTT subtitles to segments (like extension)
async function parseYouTubeSubtitles(vttContent, language) {
  // Convert VTT to SRT format
  const srtContent = vttToSRT(vttContent);
  
  // Parse SRT to segments
  const segments = parseSRTToSegments(srtContent);
  
  // Extract full text
  const fullText = segments.map(s => s.text).join(' ');
  
  return {
    text: fullText,
    language: language ?? null,
    segments: segments
  };
}

// Convert VTT to SRT format
function vttToSRT(vttContent) {
  // Remove VTT header and WEBVTT line
  let srt = vttContent.replace(/WEBVTT[\s\S]*?\n\n/, '');
  
  // Process each line to clean up HTML tags and inline timestamps
  const lines = srt.split('\n');
  const cleanedLines = lines.map(line => {
    // Skip timestamp lines (they start with time format)
    if (line.match(/^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/)) {
      return line;
    }
    
    // For text lines, remove HTML tags and inline timestamps
    let cleaned = line;
    // Remove inline timestamps like <00:00:02,000> or <00:00:02.000>
    cleaned = cleaned.replace(/<\d{2}:\d{2}:\d{2}[,\.]\d{3}>/g, '');
    // Remove HTML tags like <c>, </c>, <i>, </i>, <b>, </b>, etc.
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  });
  
  srt = cleanedLines.join('\n');
  
  // Replace VTT timestamp format with SRT format
  srt = srt.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, '$1:$2:$3,$4');
  
  // Add segment numbers
  const blocks = srt.trim().split(/\n\s*\n/);
  let srtContent = '';
  blocks.forEach((block, index) => {
    if (block.trim()) {
      srtContent += `${index + 1}\n${block}\n\n`;
    }
  });
  
  return srtContent;
}

// Parse SRT content to segments array
function parseSRTToSegments(srtContent) {
  const rawSegments = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);
  
  // First pass: collect all segments with cleaned text
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    
    const timeLine = lines[1];
    const textLines = lines.slice(2);
    
    const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timeMatch) continue;
    
    const startTime = parseSRTTimeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endTime = parseSRTTimeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    let text = textLines.join(' ').trim();
    
    // Clean up text: remove any remaining HTML tags and inline timestamps
    text = text.replace(/<[^>]+>/g, ''); // Remove HTML tags
    text = text.replace(/<\d{2}:\d{2}:\d{2}[,\.]\d{3}>/g, ''); // Remove inline timestamps
    text = text.replace(/\s+/g, ' ').trim(); // Normalize whitespace
    
    if (text.length > 0) {
      rawSegments.push({ start: startTime, end: endTime, text });
    }
  }
  
  // Second pass: remove incremental duplicates (YouTube VTT format)
  const segments = [];
  let previousText = '';
  
  for (let i = 0; i < rawSegments.length; i++) {
    const current = rawSegments[i];
    const currentText = current.text.trim();
    
    if (currentText.length > previousText.length && currentText.startsWith(previousText)) {
      // Extract only new text
      const newText = currentText.substring(previousText.length).trim();
      if (newText) {
        segments.push({ start: current.start, end: current.end, text: newText });
      }
    } else if (currentText !== previousText) {
      // Completely different text
      segments.push({ start: current.start, end: current.end, text: currentText });
    }
    
    previousText = currentText;
  }
  
  return segments;
}

// Parse SRT time to seconds
function parseSRTTimeToSeconds(hours, minutes, seconds, milliseconds) {
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(milliseconds) / 1000;
}

// Process summarize (using extension logic)
async function processSummarize(url, sessionId, platform = 'youtube') {
  const isPreviewMode = !sessionId;
  try {
    // Show progress bar
    showProgressBar('Working on your video…', false);
    updateProgressBar(0, 0, 0, platform === 'youtube' ? 'Preparing audio…' : 'Preparing media…');
    
    // Extract audio by platform
    startProgressTracking(0, 20, 10, platform === 'youtube' ? 'Preparing audio…' : 'Extracting audio…');
    const youtubeResult = platform === 'youtube'
      ? await extractYouTubeAudio(url, sessionId)
      : await extractSocialAudio(url, platform, sessionId);
    const audioUrl = youtubeResult.audioUrl;
    
    if (!audioUrl) {
      stopProgressTracking(0, 'Audio extraction failed');
      throw new Error('Audio extraction failed');
    }
    
    stopProgressTracking(20, 'Audio extracted');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    if (sessionId) {
      // Check subscription limit with actual duration
      updateProgressBar(0, 0, 22, 'Checking your plan…');
      const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
      if (!limitCheck.allowed) {
        showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
        hideProgressBar();
        return;
      }
      updateProgressBar(0, 0, 25, 'Plan check complete');
    } else {
      updateProgressBar(0, 0, 25, 'Running free preview…');
    }
    
    // Check if YouTube subtitles are available (like extension)
    let transcription = null;
    if (youtubeResult.subtitles) {
      // Use YouTube subtitles if available
      console.log('YOUTUBE: Using YouTube subtitles');
      // Subtitle parsing is usually fast (~5 seconds)
      startProgressTracking(25, 70, 5, 'Reading captions…', 'Reading captions…');
      transcription = await parseYouTubeSubtitles(youtubeResult.subtitles, youtubeResult.subtitleLanguage);
      stopProgressTracking(70, 'Subtitles parsed');
    } else {
      // Fallback to audio transcription
      console.log(`${platform.toUpperCase()}: No subtitles available, transcribing audio`);
      // Transcription takes longer: estimate based on video duration
      const estimatedTranscriptionTime = estimateTranscriptionDuration(null, durationSeconds);
      startProgressTracking(25, 70, estimatedTranscriptionTime, platform === 'youtube' ? 'Preparing audio…' : 'Preparing media…', 'Transcribing…');
      transcription = await transcribeAudio(audioUrl, null, sessionId, {
        platform,
        title: youtubeResult.title || `${getPlatformName(platform)} video`,
        sourceUrl: url
      });
      stopProgressTracking(70, 'Transcription complete');
    }
    
    // Summarize (unlimited for all tiers)
    const estimatedSummaryTime = estimateSummarizationDuration(transcription.text.length);
    startProgressTracking(70, 99, estimatedSummaryTime, 'Writing summary…', 'Writing summary…');
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, normalizeSummaryLanguage(transcription.language), sessionId, {
        platform,
        title: youtubeResult.title || `${getPlatformName(platform)} video`,
        sourceUrl: url
      });
      stopProgressTracking(99, 'Summary generated');
    } catch (error) {
      console.error('Error in summarization:', error);
      stopProgressTracking(99, 'Summary generated');
      // Continue without summary if check fails
      summary = {
        keyPoints: ['Summary fallback'],
        summary: 'We saved your transcript, but the AI summary is temporarily unavailable. Try again in a moment.'
      };
    }
    
    // Final update to 100%
    setTimeout(() => {
      updateProgressBar(0, 0, 100, 'All set');
    }, 350);
    
    // Display results in result section — summary tab active
    displayResults(summary, transcription.text, transcription.segments || [], {
      isYouTubeSubtitle: !!youtubeResult.subtitles,
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      activeTab: 'summary',
      outputMode: 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: youtubeResult.duration || 0,
      title: youtubeResult.title || `${getPlatformName(platform)} video`,
      platform,
      sourceUrl: url
    });
    trackEvent('transcript_generated', { mode: 'summary', source: 'url', auth: !!sessionId, preview: isPreviewMode });
    
    if (sessionId) {
      // Save to dashboard
      await saveToDashboard(sessionId, {
        title: youtubeResult.title || 'YouTube video',
        type: 'summarize',
        transcription: transcription.text,
        summary,
        keyPoints: summary.keyPoints || [],
        duration: youtubeResult.duration || 0
      });
    
      // Update buttons after usage
      await updateButtonsBasedOnSubscription(sessionId);
    }
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('process', error);
    const knownMessage = (error && typeof error.message === 'string') ? error.message : '';
    if (knownMessage.includes('Instagram/TikTok transcription is not available yet') || knownMessage.includes('Sign in required for Instagram/TikTok transcription')) {
      showMessage(knownMessage, 'error');
    } else {
      showMessage(USER_ERROR_GENERIC, 'error');
    }
  } finally {
    hideProgressBar();
  }
}

// Process full text (using extension logic)
async function processFullText(url, sessionId, platform = 'youtube', activeTab = 'fulltext') {
  const isPreviewMode = !sessionId;
  try {
    // Show progress bar
    showProgressBar('Working on your video…', false);
    updateProgressBar(0, 0, 0, platform === 'youtube' ? 'Preparing audio…' : 'Preparing media…');
    
    // Extract audio by platform
    startProgressTracking(0, 20, 10, platform === 'youtube' ? 'Preparing audio…' : 'Extracting audio…');
    const youtubeResult = platform === 'youtube'
      ? await extractYouTubeAudio(url, sessionId)
      : await extractSocialAudio(url, platform, sessionId);
    const audioUrl = youtubeResult.audioUrl;
    
    if (!audioUrl) {
      stopProgressTracking(0, 'Audio extraction failed');
      throw new Error('Audio extraction failed');
    }
    
    stopProgressTracking(20, 'Audio extracted');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    if (sessionId) {
      // Check subscription limit with actual duration
      updateProgressBar(0, 0, 22, 'Checking your plan…');
      const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
      if (!limitCheck.allowed) {
        showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
        hideProgressBar();
        return;
      }
      updateProgressBar(0, 0, 25, 'Plan check complete');
    } else {
      updateProgressBar(0, 0, 25, 'Running free preview…');
    }
    
    // Check if YouTube subtitles are available (like extension)
    let transcription = null;
    if (youtubeResult.subtitles) {
      // Use YouTube subtitles if available
      console.log('YOUTUBE: Using YouTube subtitles');
      startProgressTracking(25, 99, 5, 'Reading captions…', 'Reading captions…');
      transcription = await parseYouTubeSubtitles(youtubeResult.subtitles, youtubeResult.subtitleLanguage);
      stopProgressTracking(99, 'Subtitles parsed');
    } else {
      // Fallback to audio transcription
      console.log(`${platform.toUpperCase()}: No subtitles available, transcribing audio`);
      const estimatedTranscriptionTime = estimateTranscriptionDuration(null, durationSeconds);
      startProgressTracking(25, 99, estimatedTranscriptionTime, platform === 'youtube' ? 'Preparing audio…' : 'Preparing media…', 'Transcribing…');
      transcription = await transcribeAudio(audioUrl, null, sessionId, {
        platform,
        title: youtubeResult.title || `${getPlatformName(platform)} video`,
        sourceUrl: url
      });
      stopProgressTracking(99, 'Transcription complete');
    }
    
    // Summary is best-effort; transcript/SRT should still succeed if it fails
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, normalizeSummaryLanguage(transcription.language), sessionId, {
        platform,
        title: youtubeResult.title || `${getPlatformName(platform)} video`,
        sourceUrl: url
      });
    } catch (summaryErr) {
      console.warn('Summary generation failed for URL flow:', summaryErr);
      summary = { unavailable: true, message: 'Summary could not be generated for this file.' };
    }

    // Final update to 100%
    setTimeout(() => {
      updateProgressBar(0, 0, 100, 'All set');
    }, 350);
    
    // Display results and keep all useful tabs available
    displayResults(summary, transcription.text, transcription.segments || [], {
      isYouTubeSubtitle: !!youtubeResult.subtitles,
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      activeTab,
      outputMode: activeTab === 'srt' ? 'srt' : 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: youtubeResult.duration || 0,
      title: youtubeResult.title || `${getPlatformName(platform)} video`,
      platform,
      sourceUrl: url
    });
    trackEvent('transcript_generated', { mode: 'fulltext', source: 'url', auth: !!sessionId, preview: isPreviewMode });
    
    if (sessionId) {
      // Save to dashboard
      await saveToDashboard(sessionId, {
        title: youtubeResult.title || 'YouTube video',
        type: 'transcription',
        transcription: transcription.text,
        segments: transcription.segments || [],
        duration: youtubeResult.duration || 0
      });
    
      // Update buttons after usage
      await updateButtonsBasedOnSubscription(sessionId);
    }
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('process', error);
    const knownMessage = (error && typeof error.message === 'string') ? error.message : '';
    if (knownMessage.includes('Instagram/TikTok transcription is not available yet') || knownMessage.includes('Sign in required for Instagram/TikTok transcription')) {
      showMessage(knownMessage, 'error');
    } else {
      showMessage(USER_ERROR_GENERIC, 'error');
    }
  } finally {
    hideProgressBar();
  }
}

// Display Results (like extension) - replaces modal approach
function displayResults(summary, fullText, segments = null, options = {}) {
  const resultSection = document.getElementById('resultSection');
  if (!resultSection) {
    console.error('resultSection not found in DOM');
    return;
  }
  
  // Determine user plan / subtitle access (for gating SRT tab)
  const subscription = window.userSubscription || {};
  const features = subscription.features || {};
  const previewMode = !!options.previewMode;
  const durationSec = Number(options.videoDurationSeconds) || 0;
  const previewMaxSeconds = previewMode
    ? Math.min(120, Math.max(45, durationSec > 0 ? Math.floor(durationSec * 0.12) : 90))
    : 0;
  const hasTranscription = typeof fullText === 'string' && fullText.trim().length > 0;
  const hasSubtitleFeature = !!(previewMode || features.srt || features.subtitles || hasTranscription);
  const requestedTab = options.activeTab || (summary ? 'summary' : 'fulltext');
  const outputMode =
    options.outputMode != null ? options.outputMode : requestedTab === 'srt' ? 'srt' : 'fulltext';

  let previewFullText = fullText;
  let previewSegments = segments;
  if (previewMode && typeof fullText === 'string') {
    if (Array.isArray(segments) && segments.length > 0) {
      const capped = segments.filter(s => s && typeof s.end === 'number' && s.end <= previewMaxSeconds);
      if (capped.length > 0) {
        previewSegments = capped;
        previewFullText = capped.map(s => s.text).join(' ').trim();
        if (segments.some(s => s && s.end > previewMaxSeconds)) {
          previewFullText += `\n\n[You're seeing ~${previewMaxSeconds}s free—you're one step away from the full transcript & SRT.]`;
        }
      } else {
        const previewTextLimit = durationSec > 0
          ? Math.min(2500, Math.floor(fullText.length * (previewMaxSeconds / Math.max(durationSec, 1))))
          : 1200;
        previewFullText = `${fullText.slice(0, previewTextLimit)}${fullText.length > previewTextLimit ? '\n\n[Preview ends here. Unlock to capture every word—deadlines don\'t wait.]' : ''}`;
        previewSegments = segments;
      }
    } else {
      const previewTextLimit = durationSec > 0
        ? Math.min(2500, Math.floor(fullText.length * (previewMaxSeconds / Math.max(durationSec, 120))))
        : 1200;
      previewFullText = `${fullText.slice(0, previewTextLimit)}${fullText.length > previewTextLimit ? '\n\n[Preview ends here. Unlock to capture every word—deadlines don\'t wait.]' : ''}`;
    }
  }

  // Display summary - handle both object and string formats
  // Format summary as beautiful paragraphs (at least 2 paragraphs)
  let summaryTextContent = '';
  let keyPointsArray = [];
  let summaryUnavailableNotice = '';
  
  if (summary) {
    if (typeof summary === 'string') {
      summaryTextContent = summary;
    } else if (typeof summary === 'object' && summary.summary) {
      summaryTextContent = summary.summary;
      keyPointsArray = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
    } else if (typeof summary === 'object' && summary.keyPoints) {
      keyPointsArray = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
      summaryTextContent = summary.summary || '';
    } else if (typeof summary === 'object' && summary.unavailable) {
      summaryUnavailableNotice = summary.message || 'Summary could not be generated for this file.';
      summaryTextContent = '';
      } else {
      summaryTextContent = JSON.stringify(summary);
    }
  }
  
  // Format summary into paragraphs (at least 2 paragraphs)
  let formattedSummary = '';
  if (summaryTextContent) {
    // First, try to split by double newlines (if already formatted)
    let paragraphs = summaryTextContent.split(/\n\s*\n/).filter(p => p.trim());
    
    // If no double newlines, split by sentences
    if (paragraphs.length < 2) {
      // Split by sentence endings
      const sentences = summaryTextContent.split(/([.!?]\s+)/).filter(s => s.trim());
      
      // Group sentences into paragraphs (aim for 2-3 paragraphs)
      const targetParagraphs = Math.max(2, Math.min(3, Math.ceil(sentences.length / 4)));
      const sentencesPerParagraph = Math.ceil(sentences.length / targetParagraphs);
      
      paragraphs = [];
      for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
        const paragraph = sentences.slice(i, i + sentencesPerParagraph).join(' ').trim();
        if (paragraph) {
          paragraphs.push(paragraph);
        }
      }
    }
    
    // If still only one paragraph, split it intelligently
    if (paragraphs.length === 1 && paragraphs[0].length > 150) {
      const text = paragraphs[0];
      const midPoint = Math.floor(text.length / 2);
      
      // Try to find a good split point (sentence ending near the middle)
      let splitPoint = text.lastIndexOf('.', midPoint);
      if (splitPoint === -1) splitPoint = text.lastIndexOf('!', midPoint);
      if (splitPoint === -1) splitPoint = text.lastIndexOf('?', midPoint);
      if (splitPoint === -1) splitPoint = text.lastIndexOf('،', midPoint);
      if (splitPoint === -1) splitPoint = text.lastIndexOf(' ', midPoint);
      
      if (splitPoint > text.length * 0.3 && splitPoint < text.length * 0.7) {
        paragraphs[0] = text.substring(0, splitPoint + 1).trim();
        paragraphs.push(text.substring(splitPoint + 1).trim());
    } else {
        // Force split at middle
        paragraphs[0] = text.substring(0, midPoint).trim();
        paragraphs.push(text.substring(midPoint).trim());
      }
    }
    
    // Ensure at least 2 paragraphs
    if (paragraphs.length < 2 && summaryTextContent.length > 50) {
      const text = summaryTextContent;
      const midPoint = Math.floor(text.length / 2);
      const splitPoint = text.lastIndexOf('.', midPoint) || text.lastIndexOf(' ', midPoint) || midPoint;
      paragraphs = [
        text.substring(0, splitPoint + 1).trim(),
        text.substring(splitPoint + 1).trim()
      ];
    }
    
    // Format paragraphs with beautiful styling
    formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
  }
  if (!summaryTextContent && (previewFullText || '').trim().length > 0) {
    summaryUnavailableNotice = summaryUnavailableNotice || 'Summary could not be generated for this file.';
  }
  if (summaryUnavailableNotice) {
    formattedSummary += `<p class="summary-notice">${summaryUnavailableNotice}</p>`;
  }
  
  // Add key points if available
  if (keyPointsArray.length > 0) {
    formattedSummary += '<div class="key-points-container"><h4 class="key-points-title">Key takeaways</h4><ul class="key-points-list">';
    keyPointsArray.forEach((kp, i) => {
      formattedSummary += `<li class="key-point-item">${kp}</li>`;
    });
    formattedSummary += '</ul></div>';
  }
  
  const summaryTextEl = document.getElementById('summaryText');
  if (summaryTextEl) {
    summaryTextEl.innerHTML = formattedSummary || '<p class="summary-notice">Summary could not be generated for this file.</p>';
  }
  window.originalSummaryHtml = summaryTextEl ? summaryTextEl.innerHTML : '';

  // Store original texts for translation (transcript = Whisper output; no client-side translation)
  window.originalFullText = fullText;
  window.originalSummary = typeof summary === 'string' ? summary : (summary?.summary || summaryTextContent);
  setDetectedSourceLanguage(options && options.originalLanguage);
  window.originalTextLanguage = window.cutupDetectedSourceLanguage;
  window.originalSrtLanguage = window.cutupDetectedSourceLanguage;
  ['fulltextLanguage', 'summaryLanguage', 'srtLanguage'].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) sel.value = 'original';
  });

  // Display full text
  const fulltextEl = document.getElementById('fulltext');
  if (fulltextEl) {
    fulltextEl.textContent = previewFullText;
  }

  // Generate and display SRT whenever transcription data exists
  if (hasTranscription || (previewSegments && Array.isArray(previewSegments) && previewSegments.length > 0)) {
    if (previewSegments && Array.isArray(previewSegments) && previewSegments.length > 0) {
      const validSegments = previewSegments.filter(s => 
        s && 
        typeof s.start === 'number' && 
        typeof s.end === 'number' && 
        s.start >= 0 && 
        s.end > s.start &&
        s.text && 
        s.text.trim().length > 0
      );
      
      if (validSegments.length > 0) {
        const srtContent = generateSRT(validSegments);
        const srtPreviewEl = document.getElementById('srtPreview');
        if (srtPreviewEl) {
          srtPreviewEl.textContent = previewMode
            ? `${srtContent}\n\n[Preview only—you're one step away from the full, downloadable SRT.]${CUTUP_SRT_ATTRIBUTION}`
            : `${srtContent}${CUTUP_SRT_ATTRIBUTION}`;
        }
        window.currentSrtContent = srtContent;
      } else {
        // Create simple SRT with full text
        const wordCount = previewFullText.split(/\s+/).length;
        const estimatedDuration = Math.max(wordCount / 2.5, 10);
        const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${previewFullText}\n\n`;
        const srtPreviewEl = document.getElementById('srtPreview');
        if (srtPreviewEl) {
          srtPreviewEl.textContent = previewMode
            ? `${simpleSrt}\n[Preview only—upgrade for the complete timed file.]${CUTUP_SRT_ATTRIBUTION}`
            : `${simpleSrt}${CUTUP_SRT_ATTRIBUTION}`;
        }
        window.currentSrtContent = simpleSrt;
      }
    } else {
      // If no segments, create a simple SRT with full text
      const wordCount = previewFullText.split(/\s+/).length;
      const estimatedDuration = Math.max(wordCount / 2.5, 10);
      const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${previewFullText}\n\n`;
      const srtPreviewEl = document.getElementById('srtPreview');
      if (srtPreviewEl) {
        srtPreviewEl.textContent = previewMode
          ? `${simpleSrt}\n[Preview only—upgrade for the complete timed file.]${CUTUP_SRT_ATTRIBUTION}`
          : `${simpleSrt}${CUTUP_SRT_ATTRIBUTION}`;
      }
      window.currentSrtContent = simpleSrt;
    }

    // Store original SRT for translation
    window.originalSrtContent = window.currentSrtContent;
    window.originalSrtSegments = segments;
    window.availableLanguages = (options && options.availableLanguages) || [];
  } else {
    // Clear SRT-related state when user has no subtitle access
    window.currentSrtContent = null;
    window.originalSrtContent = null;
    window.originalSrtSegments = null;
  }

  if (outputMode === 'srt' && !window.currentSrtContent) {
    const srtPreviewEl = document.getElementById('srtPreview');
    if (srtPreviewEl) {
      srtPreviewEl.textContent = 'SRT subtitles could not be generated for this media.';
    }
  }

  cutupLangDebug({
    phase: 'displayResults',
    outputMode,
    displayOriginalLanguage: options.originalLanguage ?? null,
    storedSourceIso: window.cutupDetectedSourceLanguage,
    transcriptCharsShown: (previewFullText || '').length,
    transcriptCharsRaw: (fullText || '').length,
    segmentCount: Array.isArray(segments) ? segments.length : 0,
    srtChars: window.currentSrtContent ? String(window.currentSrtContent).length : 0
  });

  const previewUpgradeBanner = document.getElementById('previewUpgradeBanner');
  if (previewUpgradeBanner) {
    previewUpgradeBanner.style.display = previewMode ? 'block' : 'none';
  }
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  if (downloadSrtBtn) {
    downloadSrtBtn.style.display = window.currentSrtContent ? '' : 'none';
    downloadSrtBtn.disabled = !window.currentSrtContent;
    downloadSrtBtn.textContent = 'Download SRT';
    downloadSrtBtn.title = window.currentSrtContent ? '' : 'SRT will appear after transcription is ready.';
  }
  if (previewMode && hasSubtitleFeature && outputMode === 'srt') {
    trackEvent('subtitle_preview_shown', {
      activeTab: 'srt',
      auth: !!localStorage.getItem('cutup_session'),
      platform: typeof currentPlatform !== 'undefined' ? currentPlatform : 'unknown'
    });
  }

  // Show result section
  resultSection.style.display = 'block';

  applyResultOutputMode(resultSection, outputMode);

  let targetTab = requestedTab;
  if (outputMode === 'srt') {
    targetTab = 'srt';
  } else if (targetTab === 'srt') {
    targetTab = summary ? 'summary' : 'fulltext';
  }
  switchTab(targetTab);

  window.cutupLastTranscription = {
    cacheKey: getTranscriptionCacheKey(),
    summary,
    fullText,
    segments: segments || [],
    title: options.title || null,
    platform: options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : null),
    sourceUrl: options.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : null),
    lastDisplayOptions: {
      originalLanguage: options.originalLanguage,
      isYouTubeSubtitle: options.isYouTubeSubtitle,
      availableLanguages: options.availableLanguages || [],
      previewMode: options.previewMode,
      videoDurationSeconds: options.videoDurationSeconds
    }
  };

  const habitHint = document.getElementById('retentionHabitHint');
  if (habitHint) habitHint.hidden = false;

  initConversionLayerAfterResults();

  if (!options.cacheReplay) {
    recordRetentionAfterResults({
      sourceUrl: options.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : ''),
      platform: options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : 'youtube'),
      title: options.title || null,
    });
  } else {
    renderRetentionPanels();
  }

  if (typeof window.cutupRunGrowthOrchestrator === 'function') {
    window.cutupRunGrowthOrchestrator('after_result');
  }

  if (!previewMode) {
    const sessionId = localStorage.getItem('cutup_session');
    if (sessionId) {
      persistSavedOutputs(sessionId, {
        title: options.title || null,
        platform: options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : null),
        sourceUrl: options.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : null),
        language: options.originalLanguage || null,
        transcript: previewFullText || '',
        summary,
        srt: window.currentSrtContent || ''
      }).catch((err) => {
        console.warn('Could not persist saved outputs:', err?.message || err);
      });
    }
  }

  // Clear processing message
  const downloadMessage = document.getElementById('downloadMessage');
  if (downloadMessage) {
    downloadMessage.style.display = 'none';
    downloadMessage.textContent = '';
  }
  
  // Scroll result section into view
  setTimeout(() => {
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

async function persistSavedOutputs(sessionId, payload) {
  if (!sessionId || !payload) return;
  const baseMeta = {
    platform: payload.platform || 'unknown',
    sourceUrl: payload.sourceUrl || '',
    title: payload.title || null
  };
  const queue = [];
  if (payload.transcript && payload.transcript.trim()) {
    queue.push({
      type: 'transcript',
      title: payload.title || null,
      platform: payload.platform || null,
      sourceUrl: payload.sourceUrl || null,
      language: payload.language || null,
      content: payload.transcript,
      metadata: { ...baseMeta, outputType: 'transcript' }
    });
  }
  const summaryText = (() => {
    if (!payload.summary) return '';
    if (typeof payload.summary === 'string') return payload.summary;
    if (typeof payload.summary === 'object' && payload.summary.summary) return payload.summary.summary;
    return '';
  })();
  if (summaryText.trim()) {
    queue.push({
      type: 'summary',
      title: payload.title || null,
      platform: payload.platform || null,
      sourceUrl: payload.sourceUrl || null,
      language: payload.language || null,
      content: summaryText,
      metadata: { ...baseMeta, outputType: 'summary' }
    });
  }
  if (payload.srt && payload.srt.trim()) {
    queue.push({
      type: 'srt',
      title: payload.title || null,
      platform: payload.platform || null,
      sourceUrl: payload.sourceUrl || null,
      language: payload.language || null,
      content: payload.srt,
      metadata: { ...baseMeta, outputType: 'srt' }
    });
  }

  let submittedLeadForTranscript = false;
  for (const item of queue) {
    const res = await fetch(`${API_BASE_URL}/api/subscription?action=saveOutput`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify(item)
    });
    if (!res.ok) continue;
    if (item.type === 'transcript' && !submittedLeadForTranscript) {
      const em = typeof window.cutupUserEmail === 'string' ? window.cutupUserEmail.trim() : '';
      if (em) {
        submitCutupLead(em, 'save_action');
        submittedLeadForTranscript = true;
      }
    }
  }
}

function getTranslationMetadata(outputType = 'srt') {
  const last = window.cutupLastTranscription || {};
  const sourceUrl = last.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : '');
  const platform = last.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : 'unknown');
  return {
    outputType,
    platform,
    title: last.title || null,
    sourceUrl: sourceUrl || null
  };
}

// Switch tab function (result section tabs only)
function switchTab(tabName) {
  const resultSection = document.getElementById('resultSection');
  if (!resultSection) return;

  // Remove active class from result tabs and contents inside resultSection only
  resultSection.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  resultSection.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Add active class to selected tab and content
  const tabBtn = resultSection.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (tabBtn && tabBtn.hidden) return;
  const tabContent = document.getElementById(`${tabName}-tab`);
  
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.add('active');

  if (tabName === 'fulltext') {
    updateFulltextSoftLockVeil();
  }
}

// Generate SRT from segments
function generateSRT(segments) {
  return segments.map((segment, index) => {
    const start = formatSRTTime(segment.start);
    const end = formatSRTTime(segment.end);
    return `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
  }).join('');
}

// Setup tab switching
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.hidden) return;
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Copy / share (active result tab)
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = getResultCopyText();
      if (!text) {
        showMessage('Nothing to copy on this tab yet.', 'info');
        return;
      }
      navigator.clipboard.writeText(text).then(() => {
        showMessage('Copied to clipboard.', 'success');
      }).catch(() => {
        showMessage('Copy failed.', 'error');
      });
    });
  }

  const shareResultBtn = document.getElementById('shareResultBtn');
  if (shareResultBtn) {
    shareResultBtn.addEventListener('click', () => {
      shareResultOutput();
    });
  }
  
  // Download buttons
  setupDownloadButtons();
  
  // Translate buttons
  setupTranslateButtons();
  updateTranslationOriginalLabel();

  const unlockPreviewBtn = document.getElementById('unlockPreviewBtn');
  if (unlockPreviewBtn) {
    unlockPreviewBtn.addEventListener('click', () => {
      const sessionId = localStorage.getItem('cutup_session');
      trackEvent('upgrade_clicked', {
        source: 'preview_banner',
        destination: sessionId ? 'dashboard' : 'pricing'
      });
      if (sessionId) {
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
      } else {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showMessage('Pick a plan below—then sign in to unlock the full file while momentum is hot.', 'info');
      }
    });
  }
});

// Setup translate buttons
function setupTranslateButtons() {
  // Translate fulltext button
  const translateFulltextBtn = document.getElementById('translateFulltextBtn');
  if (translateFulltextBtn) {
    translateFulltextBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('Sign in to translate and use pro exports.', 'error');
        return;
      }
      
      const originalLanguage = window.cutupDetectedSourceLanguage || 'auto';
      await translateFulltextContent(sessionId, originalLanguage);
    });
  }
  
  // Translate summary button
  const translateSummaryBtn = document.getElementById('translateSummaryBtn');
  if (translateSummaryBtn) {
    translateSummaryBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('Sign in to translate and use pro exports.', 'error');
        return;
      }
      
      const originalLanguage = window.cutupDetectedSourceLanguage || 'auto';
      await translateSummaryContent(sessionId, originalLanguage);
    });
  }
  
  // Translate SRT button
  const translateSrtBtn = document.getElementById('translateSrtBtn');
  if (translateSrtBtn) {
    translateSrtBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('Sign in to translate and use pro exports.', 'error');
        return;
      }
      
      const originalLanguage = window.cutupDetectedSourceLanguage || 'auto';
      await translateSrtContent(sessionId, originalLanguage);
    });
  }
}

// Translate fulltext content
async function translateFulltextContent(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('fulltextLanguage')?.value;
  if (!targetLanguage || targetLanguage === 'original') {
    const fulltextEl = document.getElementById('fulltext');
    if (fulltextEl && window.originalFullText) {
      fulltextEl.textContent = window.originalFullText;
    }
    return;
  }
  
  const btn = document.getElementById('translateFulltextBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Translating...';
  }
  
  try {
    const fulltext = window.originalFullText || '';
    if (!fulltext) {
      throw new Error('No text to translate');
    }
    
    // Use translate-srt API for translation
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        srtContent: `1\n00:00:00,000 --> 00:00:10,000\n${fulltext}\n\n`,
        targetLanguage: targetLanguage,
        sourceLanguage: originalLanguage || 'auto',
        metadata: getTranslationMetadata('transcript')
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const data = await response.json();
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    
    const fulltextEl = document.getElementById('fulltext');
    if (fulltextEl) {
      fulltextEl.textContent = translatedText;
    }
    updateFulltextSoftLockVeil();
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Translate';
    }
  }
}

// Translate summary content
async function translateSummaryContent(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('summaryLanguage')?.value;
  if (!targetLanguage || targetLanguage === 'original') {
    const summaryTextEl = document.getElementById('summaryText');
    if (summaryTextEl && window.originalSummaryHtml) {
      summaryTextEl.innerHTML = window.originalSummaryHtml;
      return;
    }
    if (summaryTextEl && window.originalSummary) {
      const summary = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary.summary || '');
      const paragraphs = summary.split(/\n\s*\n/).filter(p => p.trim());
      const formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
      summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">No summary available</p>';
    }
    return;
  }
  
  const btn = document.getElementById('translateSummaryBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Translating...';
  }
  
  try {
    const summary = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary?.summary || '');
    if (!summary) {
      throw new Error('No summary to translate');
    }
    
    // Use translate-srt API for translation
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        srtContent: `1\n00:00:00,000 --> 00:00:10,000\n${summary}\n\n`,
        targetLanguage: targetLanguage,
        sourceLanguage: originalLanguage || 'auto',
        metadata: getTranslationMetadata('summary')
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const data = await response.json();
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    
    // Format translated summary
    const paragraphs = translatedText.split(/\n\s*\n/).filter(p => p.trim());
    const formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
    
    const summaryTextEl = document.getElementById('summaryText');
    if (summaryTextEl) {
      summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">No summary available</p>';
    }
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Translate';
    }
  }
}

// Translate SRT content
async function translateSrtContent(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('srtLanguage')?.value;
  if (!targetLanguage || targetLanguage === 'original') {
    const srtPreviewEl = document.getElementById('srtPreview');
    if (srtPreviewEl && window.originalSrtContent) {
      srtPreviewEl.textContent = window.originalSrtContent;
      window.currentSrtContent = window.originalSrtContent;
    }
    return;
  }
  
  const btn = document.getElementById('translateSrtBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Translating...';
  }
  
  try {
    const srtContent = window.originalSrtContent || '';
    if (!srtContent) {
      throw new Error('No subtitles to translate');
    }
    
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        srtContent: srtContent,
        targetLanguage: targetLanguage,
        sourceLanguage: originalLanguage || 'auto',
        metadata: getTranslationMetadata('srt')
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const data = await response.json();
    window.currentSrtContent = data.srtContent;
    
    const srtPreviewEl = document.getElementById('srtPreview');
    if (srtPreviewEl) {
      srtPreviewEl.textContent = data.srtContent;
    }
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Translate';
    }
  }
}

// Setup progress bar close button
document.addEventListener('DOMContentLoaded', () => {
  const progressClose = document.getElementById('progressClose');
  if (progressClose) {
    progressClose.addEventListener('click', () => {
      hideProgressBar();
    });
  }
});

// Platform tabs functionality
let currentPlatform = 'youtube';

function switchPlatform(platform) {
  currentPlatform = platform;
  
  // Update tab buttons
  document.querySelectorAll('.platform-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.tab === platform) {
      tab.classList.add('active');
    }
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  
  const activeTab = document.getElementById(`${platform}-tab`);
  if (activeTab) {
    activeTab.classList.add('active');
  }
  
  // Hide all download options first
  const allOptions = ['downloadOptionsYoutube', 'downloadOptionsInstagram', 'downloadOptionsTiktok', 'downloadOptionsAudiofile'];
  allOptions.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  
  // Clear inputs
  if (platform !== 'audiofile') {
    const urlInput = document.getElementById(`${platform}UrlInput`) || document.getElementById('youtubeUrlInput');
    if (urlInput) {
      urlInput.value = '';
    }
  }
  
  checkInput();
}

// Setup download buttons for TXT and DOCX
function setupDownloadButtons() {
  // Download fulltext as TXT
  const downloadFulltextTxtBtn = document.getElementById('downloadFulltextTxtBtn');
  if (downloadFulltextTxtBtn) {
    downloadFulltextTxtBtn.addEventListener('click', () => {
      const fulltext = document.getElementById('fulltext')?.textContent || '';
      if (fulltext) {
        downloadAsTxt(fulltext, 'full_transcript');
      }
    });
  }
  
  // Download fulltext as DOCX
  const downloadFulltextDocxBtn = document.getElementById('downloadFulltextDocxBtn');
  if (downloadFulltextDocxBtn) {
    downloadFulltextDocxBtn.addEventListener('click', () => {
      const fulltext = document.getElementById('fulltext')?.textContent || '';
      if (fulltext) {
        downloadAsDocx(fulltext, 'full_transcript');
      }
    });
  }
  
  // Download summary as TXT
  const downloadSummaryTxtBtn = document.getElementById('downloadSummaryTxtBtn');
  if (downloadSummaryTxtBtn) {
    downloadSummaryTxtBtn.addEventListener('click', () => {
      const summary = document.getElementById('summaryText')?.textContent || '';
      if (summary) {
        downloadAsTxt(summary, 'summary');
      }
    });
  }
  
  // Download summary as DOCX
  const downloadSummaryDocxBtn = document.getElementById('downloadSummaryDocxBtn');
  if (downloadSummaryDocxBtn) {
    downloadSummaryDocxBtn.addEventListener('click', () => {
      const summary = document.getElementById('summaryText')?.textContent || '';
      if (summary) {
        downloadAsDocx(summary, 'summary');
      }
    });
  }
  
  // Download SRT
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  if (downloadSrtBtn) {
    downloadSrtBtn.addEventListener('click', () => {
      const srtContent = (window.currentSrtContent || '').trimEnd();
      if (srtContent) {
        downloadAsTxt(`${srtContent}${CUTUP_SRT_ATTRIBUTION}`, 'subtitles', 'srt');
      }
    });
  }
}

// Download as TXT
function downloadAsTxt(content, filename, extension = 'txt') {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Download as DOCX using API endpoint
async function downloadAsDocx(content, filename) {
  try {
    showMessage('Preparing your DOCX…', 'info');
    const sessionId = localStorage.getItem('cutup_session');
    if (!sessionId) {
      showMessage('Sign in to download DOCX files.', 'error');
      return;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/generate-docx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ content, filename })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `DOCX generation failed (${response.status})`;
      throw new Error(errorMessage);
    }
    
    // Get blob from response
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showMessage('DOCX saved to your device.', 'success');
  } catch (error) {
    console.error('Error downloading DOCX:', error);
    reportClientError('docx', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  }
}

// OLD: Show summary modal (kept for backward compatibility but not used)
function showSummaryModal(summary, keyPoints, fullText, title, sessionId, originalLanguage) {
  let modal = document.getElementById('summaryModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'summaryModal';
    modal.className = 'quality-modal';
    modal.innerHTML = `
      <div class="quality-modal-content" style="max-width: 900px;">
        <div class="quality-modal-header">
          <h3 class="quality-modal-title">Summary</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="summary-modal-body">
          <div class="srt-controls">
            <label for="summaryLanguageSelect" class="srt-language-label">Translate to</label>
            <select id="summaryLanguageSelect" class="srt-language-select">
              <option value="original">Original language</option>
              <option value="fa">Persian (fa)</option>
              <option value="en">English</option>
              <option value="ar">Arabic (ar)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="ru">Русский</option>
              <option value="tr">Türkçe</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
            <button class="translate-srt-btn" id="translateSummaryBtnMain">🔄 Translate</button>
          </div>
          <div class="summary-content">
            <div class="key-points-section" style="margin-bottom: 20px;">
              <h4 style="margin-bottom: 10px;">Key takeaways</h4>
              <ul id="keyPointsList" style="list-style: none; padding: 0;"></ul>
            </div>
            <div class="summary-text-section">
              <h4 style="margin-bottom: 10px;">Summary</h4>
              <div id="summaryTextMain" style="line-height: 1.8; text-align: right;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    populateLanguageSelects();
    
    // Close modal
    modal.querySelector('.quality-modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
    
    // Translate button
    document.getElementById('translateSummaryBtnMain').addEventListener('click', async () => {
      await translateSummary(sessionId, originalLanguage);
    });
  }
  
  // Set initial content
  window.originalSummary = summary;
  window.originalKeyPoints = keyPoints;
  window.originalSummaryLanguage = originalLanguage;
  
  // Display key points
  const keyPointsList = document.getElementById('keyPointsList');
  keyPointsList.innerHTML = '';
  if (Array.isArray(keyPoints) && keyPoints.length > 0) {
    keyPoints.forEach(point => {
      const li = document.createElement('li');
      li.textContent = `• ${point}`;
      li.style.padding = '8px 0';
      keyPointsList.appendChild(li);
    });
  } else {
    keyPointsList.innerHTML = '<li>No key points available.</li>';
  }
  
  // Display summary
  document.getElementById('summaryTextMain').textContent = typeof summary === 'string' ? summary : (summary.summary || 'No summary available');
  
  modal.classList.add('active');
}

// Translate summary
async function translateSummary(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('summaryLanguageSelect').value;
  if (targetLanguage === 'original') {
    document.getElementById('summaryTextMain').textContent = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary.summary || '');
    return;
  }
  
  const btn = document.getElementById('translateSummaryBtnMain');
  btn.disabled = true;
  btn.textContent = '⏳ Translating...';
  
  try {
    const summaryText = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary.summary || '');
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        srtContent: `1\n00:00:00,000 --> 00:00:10,000\n${summaryText}\n\n`,
        targetLanguage: targetLanguage,
        sourceLanguage: originalLanguage || window.cutupDetectedSourceLanguage || 'auto',
        metadata: getTranslationMetadata('summary')
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const data = await response.json();
    // Extract text from SRT
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    document.getElementById('summaryTextMain').textContent = translatedText;
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Translate';
  }
}

// Show full text modal
function showFullTextModal(fullText, title, sessionId, originalLanguage) {
  let modal = document.getElementById('fullTextModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fullTextModal';
    modal.className = 'quality-modal';
    modal.innerHTML = `
      <div class="quality-modal-content" style="max-width: 900px;">
        <div class="quality-modal-header">
          <h3 class="quality-modal-title">Full transcript</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="summary-modal-body">
          <div class="srt-controls">
            <label for="fullTextLanguageSelect" class="srt-language-label">Translate to</label>
            <select id="fullTextLanguageSelect" class="srt-language-select">
              <option value="original">Original language</option>
              <option value="fa">Persian (fa)</option>
              <option value="en">English</option>
              <option value="ar">Arabic (ar)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="ru">Русский</option>
              <option value="tr">Türkçe</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
            <button class="translate-srt-btn" id="translateFullTextBtnMain">🔄 Translate</button>
          </div>
          <div class="fulltext-content" id="fullTextMain" style="max-height: 500px; overflow-y: auto; margin-top: 20px; padding: 16px; background: #f5f5f5; border-radius: 8px; line-height: 1.8; text-align: right;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    populateLanguageSelects();
    
    // Close modal
    modal.querySelector('.quality-modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
    
    // Translate button
    document.getElementById('translateFullTextBtnMain').addEventListener('click', async () => {
      await translateFullText(sessionId, originalLanguage);
    });
  }
  
  // Set initial content
  window.originalFullText = fullText;
  window.originalFullTextLanguage = originalLanguage;
  document.getElementById('fullTextMain').textContent = fullText;
  
  modal.classList.add('active');
}

// Translate full text
async function translateFullText(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('fullTextLanguageSelect').value;
  if (targetLanguage === 'original') {
    document.getElementById('fullTextMain').textContent = window.originalFullText;
    return;
  }
  
  const btn = document.getElementById('translateFullTextBtnMain');
  btn.disabled = true;
  btn.textContent = '⏳ Translating...';
  
  try {
    // Split text into chunks for translation (SRT format)
    const chunks = window.originalFullText.split(/\n\n+/);
    let translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (!chunk) continue;
      
      const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({
          srtContent: `1\n00:00:00,000 --> 00:00:10,000\n${chunk}\n\n`,
          targetLanguage: targetLanguage,
          sourceLanguage: originalLanguage || window.cutupDetectedSourceLanguage || 'auto',
          metadata: getTranslationMetadata('transcript')
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        const translatedChunk = data.srtContent.split('\n').slice(2).join('\n').trim();
        translatedChunks.push(translatedChunk);
      } else {
        translatedChunks.push(chunk); // Keep original if translation fails
      }
    }
    
    document.getElementById('fullTextMain').textContent = translatedChunks.join('\n\n');
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Translate';
  }
}

// Save to dashboard
async function saveToDashboard(sessionId, data) {
  try {
    if (!sessionId || !data) return;
    const platform = data.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : 'unknown');
    const sourceUrl = data.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : '');
    const title = data.title || null;

    await persistSavedOutputs(sessionId, {
      title,
      platform,
      sourceUrl,
      language: data.language || null,
      transcript: data.transcription || '',
      summary: data.summary || null,
      srt: data.srtContent || ''
    });
  } catch (error) {
    console.error('[script] Error saving to dashboard:', error);
  }
}

// Show quality modal
function showQualityModal(formats, url, sessionId, isPro, isStarter, userPlan, type) {
  // Create modal if doesn't exist
  let modal = document.getElementById('qualityModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qualityModal';
    modal.className = 'quality-modal';
    modal.innerHTML = `
      <div class="quality-modal-content">
        <div class="quality-modal-header">
          <h3 class="quality-modal-title">Choose quality</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="quality-list" id="qualityList"></div>
      </div>
    `;
    document.body.appendChild(modal);
    populateLanguageSelects();
    
    // Close modal handlers
    modal.querySelector('.quality-modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }
  
  const qualityList = modal.querySelector('#qualityList');
  qualityList.innerHTML = '';
  
  // Formats is now an array of quality strings
  if (!Array.isArray(formats) || formats.length === 0) {
    qualityList.innerHTML = '<p style="text-align: center; padding: 20px;">No qualities available.</p>';
    modal.classList.add('active');
    return;
  }
  
  formats.forEach(quality => {
    // Check if quality is locked
    // For starter plan: only 480p and 360p are enabled
    // For free plan: only up to 480p (already filtered)
    // For pro/business: all enabled
    let isLocked = false;
    if (type === 'video') {
      if (isStarter) {
        // For starter, only 480p and 360p are enabled
        isLocked = quality !== '480p' && quality !== '360p';
      } else if (!isPro && userPlan === 'free') {
        // For free, lock anything above 480p (shouldn't happen as we filter, but just in case)
      const qualityMatch = quality.match(/(\d+)p/);
      if (qualityMatch) {
        const qualityNum = parseInt(qualityMatch[1]);
        isLocked = qualityNum > 480;
      } else {
        isLocked = quality === '720p' || quality === '1080p' || quality === '1440p' || quality === '2160p' || quality === '4K';
        }
      }
    }
    
    const item = document.createElement('div');
    item.className = `quality-item ${isLocked ? 'locked' : ''}`;
    
    // Create lock icon for locked qualities
    const lockIcon = isLocked ? '<span class="lock-icon" title="Upgrade your plan to use this quality">🔒</span>' : '';
    
    item.innerHTML = `
      <span class="quality-text">${type === 'video' ? quality : quality === 'best' ? 'Best quality' : quality + ' kbps'}</span>
      ${lockIcon}
    `;
    
    if (!isLocked) {
      item.addEventListener('click', async () => {
        modal.classList.remove('active');
        await downloadFile(url, { quality: quality }, sessionId, type);
      });
      item.style.cursor = 'pointer';
    } else {
      // For locked items, clicking the lock icon should go to subscription page
      const lockIconEl = item.querySelector('.lock-icon');
      if (lockIconEl) {
        lockIconEl.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}#subscription`, '_blank');
        });
        lockIconEl.style.cursor = 'pointer';
      }
      item.addEventListener('click', () => {
        showMessage('This quality requires a higher plan. Upgrade to unlock.', 'info');
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}#subscription`, '_blank');
      });
      item.style.cursor = 'not-allowed';
      item.style.opacity = '0.6';
    }
    
    qualityList.appendChild(item);
  });
  
  modal.classList.add('active');
}

// Show progress bar
function showProgressBar(title = 'Working on it…', showFileSize = true) {
  const habitHint = document.getElementById('retentionHabitHint');
  if (habitHint) habitHint.hidden = true;

  const progressContainer = document.getElementById('downloadProgressContainer');
  const progressTitle = document.getElementById('progressTitle');
  const progressFill = document.getElementById('progressFill');
  const progressPercent = document.getElementById('progressPercent');
  const fileSize = document.getElementById('fileSize');
  const progressDownloaded = document.getElementById('progressDownloaded');
  const progressTotal = document.getElementById('progressTotal');
  
  if (progressContainer) {
    progressContainer.style.display = 'block';
    progressTitle.textContent = title;
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    
    if (showFileSize) {
      fileSize.textContent = 'Sizing file…';
      progressDownloaded.textContent = '0 MB';
      progressTotal.textContent = '0 MB';
      if (progressDownloaded.parentElement) {
        progressDownloaded.parentElement.style.display = '';
      }
    } else {
      fileSize.textContent = '';
      if (progressDownloaded.parentElement) {
        progressDownloaded.parentElement.style.display = 'none';
      }
    }
  }
}

// Update progress bar
function updateProgressBar(downloaded = 0, total = 0, percent = 0, statusText = '') {
  const progressFill = document.getElementById('progressFill');
  const progressPercent = document.getElementById('progressPercent');
  const fileSize = document.getElementById('fileSize');
  const progressDownloaded = document.getElementById('progressDownloaded');
  const progressTotal = document.getElementById('progressTotal');
  const progressTitle = document.getElementById('progressTitle');
  
  if (progressFill) {
    progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
  if (progressPercent) {
    progressPercent.textContent = `${Math.round(Math.min(100, Math.max(0, percent)))}%`;
  }
  
  // Update status text if provided
  if (statusText && progressTitle) {
    const normalizedStatus = (() => {
      const value = String(statusText).toLowerCase();
      if (value.includes('download')) return 'Downloading...';
      if (value.includes('audio') || value.includes('extract')) return 'Extracting audio...';
      if (value.includes('transcrib')) return 'Transcribing...';
      return statusText;
    })();
    progressTitle.textContent = normalizedStatus;
  }
  
  // Only show file size if total > 0 (download operation)
  if (total > 0) {
    if (fileSize) {
      const totalMB = (total / 1024 / 1024).toFixed(2);
      fileSize.textContent = `File size: ${totalMB} MB`;
    }
    if (progressDownloaded) {
      const downloadedMB = (downloaded / 1024 / 1024).toFixed(2);
      progressDownloaded.textContent = `${downloadedMB} MB`;
    }
    if (progressTotal) {
      const totalMB = (total / 1024 / 1024).toFixed(2);
      progressTotal.textContent = `${totalMB} MB`;
    }
    if (progressDownloaded.parentElement) {
      progressDownloaded.parentElement.style.display = '';
    }
  }
}

// Progress tracking system - smooth incremental progress
let progressInterval = null;
let progressStartTime = null;
let progressEstimatedDuration = null; // in milliseconds
let progressCurrentPercent = 0;
let progressTargetPercent = 0;
let progressStatusText = '';
let progressStatusTextAt50 = null; // Text to show after 50%
let progressAnimateToFinalInterval = null;

// Easing function for smooth progress (ease-out)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Start progress tracking for an async operation
function startProgressTracking(startPercent, endPercent, estimatedDurationSeconds, statusText, statusTextAt50 = null) {
  // Clear any existing intervals
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  if (progressAnimateToFinalInterval) {
    clearInterval(progressAnimateToFinalInterval);
    progressAnimateToFinalInterval = null;
  }
  
  progressStartTime = Date.now();
  progressEstimatedDuration = estimatedDurationSeconds * 1000; // Convert to milliseconds
  progressCurrentPercent = startPercent;
  progressTargetPercent = endPercent;
  progressStatusText = statusText;
  progressStatusTextAt50 = statusTextAt50;
  
  // Update status text immediately
  const progressTitle = document.getElementById('progressTitle');
  if (statusText && progressTitle) {
    progressTitle.textContent = statusText;
  }
  
  // Set initial progress
  updateProgressBar(0, 0, startPercent, statusText);
  
  // Calculate how much progress we need to make
  const progressRange = endPercent - startPercent;
  const midPoint = startPercent + (progressRange * 0.5);
  
  // Start interval to update progress smoothly and incrementally
  progressInterval = setInterval(() => {
    const elapsed = Date.now() - progressStartTime;
    const timeRatio = Math.min(0.99, elapsed / progressEstimatedDuration); // Cap at 99% until operation completes
    
    // Use easing for smoother progress
    const easedRatio = easeOutCubic(timeRatio);
    const targetProgress = startPercent + (easedRatio * progressRange);
    
    // Incrementally move towards target (smooth animation)
    if (progressCurrentPercent < targetProgress) {
      // Move forward smoothly (max 2% per update for smoothness)
      const increment = Math.min(2, (targetProgress - progressCurrentPercent) * 0.3);
      progressCurrentPercent = Math.min(targetProgress, progressCurrentPercent + increment);
      
      // Update status text at 50% if specified
      if (progressStatusTextAt50 && progressTitle && progressCurrentPercent >= midPoint) {
        if (progressTitle.textContent !== progressStatusTextAt50) {
          progressTitle.textContent = progressStatusTextAt50;
          progressStatusText = progressStatusTextAt50;
        }
      }
      
      updateProgressBar(0, 0, progressCurrentPercent, progressStatusText);
    }
  }, 50); // Update every 50ms for very smooth progress
}

// Stop progress tracking and smoothly animate to final percent
function stopProgressTracking(finalPercent, statusText) {
  // Clear the main progress interval
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  
  // Get current progress
  const startPercent = progressCurrentPercent;
  const targetPercent = Math.max(startPercent, finalPercent); // Don't go backwards
  
  // If we're already at or past target, just update
  if (startPercent >= targetPercent) {
    updateProgressBar(0, 0, targetPercent, statusText);
    progressCurrentPercent = targetPercent;
    progressStartTime = null;
    progressEstimatedDuration = null;
    progressStatusTextAt50 = null;
    return;
  }
  
  // Smoothly animate from current to final
  const duration = 300; // 300ms animation (faster)
  const startTime = Date.now();
  
  progressAnimateToFinalInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1, elapsed / duration);
    const easedProgress = easeOutCubic(progress);
    const currentProgress = startPercent + (easedProgress * (targetPercent - startPercent));
    
    progressCurrentPercent = currentProgress;
    updateProgressBar(0, 0, currentProgress, statusText);
    
    if (progress >= 1) {
      clearInterval(progressAnimateToFinalInterval);
      progressAnimateToFinalInterval = null;
      progressCurrentPercent = targetPercent;
      updateProgressBar(0, 0, targetPercent, statusText);
    }
  }, 30); // Update every 30ms for very smooth final animation
  
  progressStartTime = null;
  progressEstimatedDuration = null;
  progressStatusTextAt50 = null;
}

// Estimate duration for transcription based on file size or video duration
function estimateTranscriptionDuration(fileSizeBytes = null, videoDurationSeconds = null) {
  if (videoDurationSeconds) {
    // Transcription typically takes 1.5x the video duration
    return videoDurationSeconds * 1.5;
  } else if (fileSizeBytes) {
    // Estimate: ~1MB per minute, transcription takes 1.5x audio duration
    const estimatedMinutes = (fileSizeBytes / 1024 / 1024) * 1.2;
    return estimatedMinutes * 60 * 1.5; // Convert to seconds and multiply by 1.5
  }
  // Default: 30 seconds for small files
  return 30;
}

// Estimate duration for audio extraction
function estimateAudioExtractionDuration(videoDurationSeconds = null) {
  if (videoDurationSeconds) {
    // Audio extraction is usually fast: ~0.1x video duration
    return Math.max(5, videoDurationSeconds * 0.1);
  }
  return 10; // Default: 10 seconds
}

// Estimate duration for summarization
function estimateSummarizationDuration(textLength = 0) {
  // Summarization is usually fast: ~1 second per 1000 characters
  return Math.max(5, textLength / 1000);
}

// Hide progress bar
function hideProgressBar() {
  // Clear all intervals
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  if (progressAnimateToFinalInterval) {
    clearInterval(progressAnimateToFinalInterval);
    progressAnimateToFinalInterval = null;
  }
  
  // Reset all progress tracking variables
  progressStartTime = null;
  progressEstimatedDuration = null;
  progressCurrentPercent = 0;
  progressTargetPercent = 0;
  progressStatusText = '';
  progressStatusTextAt50 = null;
  
  const progressContainer = document.getElementById('downloadProgressContainer');
  if (progressContainer) {
    setTimeout(() => {
      progressContainer.style.display = 'none';
    }, 1000);
  }
}

// Download file
async function downloadFile(url, format, sessionId, type) {
  try {
    // Show progress bar
    showProgressBar('Downloading…');
    
    // Extract video ID based on platform
    let videoId = null;
    if (currentPlatform === 'youtube') {
      videoId = extractVideoId(url);
    } else if (currentPlatform === 'tiktok') {
      // Extract TikTok video ID from URL
      const tiktokMatch = url.match(/\/(video|@[\w.]+)\/(\d+)/);
      if (tiktokMatch) {
        videoId = tiktokMatch[2] || tiktokMatch[1];
      }
    } else if (currentPlatform === 'instagram') {
      // Extract Instagram shortcode from URL (supports posts, reels, TV, and stories)
      // Stories format: /stories/username/story_id/
      // Posts/Reels format: /p/... or /reel/... or /tv/...
      let instaMatch = url.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (!instaMatch) {
        // Try to match stories format: /stories/username/story_id/
        instaMatch = url.match(/\/stories\/([A-Za-z0-9_.]+)\/(\d+)/);
        if (instaMatch) {
          videoId = `story_${instaMatch[2]}`;
        }
      } else {
        videoId = instaMatch[2];
      }
    }
    
    const quality = format.quality || format.format_id || format.itag;
    
    // Get video title first for better filename
    let videoTitle = `${currentPlatform}_${videoId || 'video'}`;
    try {
      // Try to get title (works for YouTube, may need separate endpoints for TikTok/Instagram)
      if (currentPlatform === 'youtube' && videoId) {
      const titleResponse = await fetch(`${API_BASE_URL}/api/youtube-title`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
        body: JSON.stringify({ videoId, url })
      });
      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        if (titleData.title) {
          // Clean title for filename (remove invalid characters)
          videoTitle = titleData.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
          }
        }
      }
    } catch (e) {
      console.warn('Could not get video title:', e);
    }
    
    updateProgressBar(0, 0, 5);
    
    // Use appropriate API endpoint based on platform
    // For now, use youtube-download for all platforms (yt-dlp supports TikTok and Instagram)
    const apiEndpoint = `${API_BASE_URL}/api/youtube-download`;
    
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        url,
        videoId: videoId,
        quality: quality,
        type: type,
        platform: currentPlatform // Pass platform info
      })
    });
    
    if (!response.ok) {
      hideProgressBar();
      // Get error response text first for logging
        const errorText = await response.text();
      console.error('[script] Download failed:', response.status, errorText);
      
      // Try to parse as JSON
      try {
        const errorData = JSON.parse(errorText);
        console.error('[script] Error details:', {
          error: errorData.error,
          message: errorData.message,
          stderr: errorData.stderr,
          stdout: errorData.stdout,
          code: errorData.code
        });
        throw new Error(errorData.error || errorData.message || 'Download failed');
      } catch (parseError) {
        // If not JSON, use text as error message
        throw new Error(errorText || 'Download failed');
      }
    }
    
    // Get content length for progress tracking
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    if (totalBytes > 0) {
      updateProgressBar(0, totalBytes, 10);
    }
    
    // Get filename from Content-Disposition header if available
    const contentDisposition = response.headers.get('content-disposition');
    let filename = `${videoTitle}_${quality}`;
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }
    
    // Download with progress tracking
    if (!response.body) {
      throw new Error('Response body is not available');
    }
    
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;
    
    // Show initial progress
    if (totalBytes > 0) {
      updateProgressBar(0, totalBytes, 5);
    } else {
      updateProgressBar(0, 0, 5);
    }
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      if (totalBytes > 0) {
        const percent = Math.min(95, 5 + (receivedLength / totalBytes) * 90);
        updateProgressBar(receivedLength, totalBytes, percent);
      } else {
        // If we don't know total size, estimate based on received data
        const estimatedTotal = receivedLength * 1.1; // Estimate 10% more
        const percent = Math.min(90, 5 + (receivedLength / 1024 / 1024) * 2);
        updateProgressBar(receivedLength, estimatedTotal, percent);
      }
    }
    
    // Final update
    const finalTotal = totalBytes > 0 ? totalBytes : receivedLength;
    updateProgressBar(receivedLength, finalTotal, 100);
    
    // Combine chunks into blob
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    
    const blob = new Blob([allChunks], { 
      type: type === 'video' ? 'video/mp4' : 'audio/mpeg' 
    });
    const extension = type === 'video' ? 'mp4' : 'mp3';
    const fullFilename = filename.endsWith(extension) ? filename : `${filename}.${extension}`;
    
    // Create download link with proper attributes
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fullFilename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    
    // Clean up after a delay
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }, 100);
    
    // Hide progress bar after download completes
    hideProgressBar();
    
    // videoTitle already fetched above
    
    // NOTE: Download recording is now done atomically in /api/youtube-download endpoint
    // No need to call recordDownload separately - it's already recorded before download started
    
    // Get updated usage from API to show toast message
    try {
      const usageResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`, {
        headers: { 'X-Session-Id': sessionId }
      });
      if (usageResponse.ok) {
        const usageData = await usageResponse.json();
        const downloadType = type === 'audio' ? 'audio' : 'video';
        const audioCount = usageData.usage?.downloads?.audio?.count || 0;
        const audioLimit = usageData.usage?.downloads?.audio?.limit || null;
        const videoCount = usageData.usage?.downloads?.video?.count || 0;
        const videoLimit = usageData.usage?.downloads?.video?.limit || null;
        
        // Show toast with usage info
        if (type === 'audio' && audioLimit !== null) {
          showMessage(`${downloadType} download recorded: ${audioCount} of ${audioLimit}`, 'success');
        } else if (type === 'video' && videoLimit !== null) {
          showMessage(`${downloadType} download recorded: ${videoCount} of ${videoLimit}`, 'success');
        } else {
          showMessage(`${downloadType} download recorded!`, 'success');
        }
      }
    } catch (e) {
      console.warn('Could not get usage info for toast:', e);
    }
    
    // Signal dashboard to refresh by updating localStorage
    localStorage.setItem('cutup_last_activity', Date.now().toString());
    
    // Dispatch event for dashboard refresh (if dashboard is open in another tab)
    window.dispatchEvent(new CustomEvent('cutupDownloadRecorded', {
      detail: {
        type: type === 'video' ? 'downloadVideo' : 'downloadAudio',
        videoId: videoId,
        url: url
      }
    }));
    
    // Save to dashboard (for history display)
    // NOTE: Downloads don't count as minutes, so minutes is 0
    await saveToDashboard(sessionId, {
      title: videoTitle,
      type: type === 'video' ? 'downloadVideo' : 'downloadAudio',
      quality: quality,
      url: url,
      videoId: videoId,
      minutes: 0, // Downloads don't count as minutes for transcription/summarization limits
      duration: 0 // No duration for downloads
    });
    
    // Update buttons after download
    await updateButtonsBasedOnSubscription(sessionId);
    
  } catch (error) {
    console.error('Download error:', error);
    reportClientError('download', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  }
}

// Allow Enter key to check URL
function setupEnterKeyHandler(input) {
  if (input) {
    input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
        const url = input.value.trim();
        checkInput(); // This will validate and show appropriate message
        if (url && isValidUrl(url)) {
          showMessage('Link looks good. Choose Summarize, Subtitles, or Full Transcript above.', 'info');
        }
        // Error message is already shown in checkInput() if URL is invalid
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEnterKeyHandler(document.getElementById('youtubeUrlInput'));
  setupEnterKeyHandler(document.getElementById('instagramUrlInput'));
  setupEnterKeyHandler(document.getElementById('tiktokUrlInput'));
  applyCutupPricingPlanLocks(window.userSubscription || { plan: 'free' });
});

// Handle audio file input (like extension)
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) {
    // If no file selected, clear input and reset
    checkInput();
    return;
  }
  
  // Check file size (max 100MB)
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    showMessage(`File is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum allowed is ${maxSize / 1024 / 1024} MB.`, 'error');
    audioFileInput.value = ''; // Clear selection
    checkInput();
    return;
  }
  
  // Check if it's audio or video file
  const isAudio = file.type.startsWith('audio/');
  const isVideo = file.type.startsWith('video/');
  
  if (!isAudio && !isVideo) {
    showMessage('Please select an audio or video file.', 'error');
    audioFileInput.value = ''; // Clear selection
    checkInput();
    return;
  }
  
  // Store file for later use
  window.selectedFile = file;
  
  // Show success message
  showMessage(`File "${file.name}" selected (${(file.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
  
  // Check input to show/hide buttons
  checkInput();
}

// Get current URL input based on active tab
function getCurrentUrlInput() {
  if (currentPlatform === 'youtube') {
    return document.getElementById('youtubeUrlInput');
  } else if (currentPlatform === 'instagram') {
    return document.getElementById('instagramUrlInput');
  } else if (currentPlatform === 'tiktok') {
    return document.getElementById('tiktokUrlInput');
  }
  return null;
}

// Get current URL value
function getCurrentUrl() {
  const input = getCurrentUrlInput();
  return input ? input.value.trim() : '';
}

// Get download options container for current platform
function getDownloadOptions() {
  if (currentPlatform === 'youtube') {
    return document.getElementById('downloadOptionsYoutube');
  } else if (currentPlatform === 'instagram') {
    return document.getElementById('downloadOptionsInstagram');
  } else if (currentPlatform === 'tiktok') {
    return document.getElementById('downloadOptionsTiktok');
  } else if (currentPlatform === 'audiofile') {
    return document.getElementById('downloadOptionsAudiofile');
  }
  return null;
}

// Check input and show/hide appropriate buttons
function checkInput() {
  // Hide all download options first
  const allOptions = ['downloadOptionsYoutube', 'downloadOptionsInstagram', 'downloadOptionsTiktok', 'downloadOptionsAudiofile'];
  allOptions.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
    }
  });
  
  if (currentPlatform === 'audiofile') {
    // For audio file tab, show options when file is selected
    const hasFile = audioFileInput && audioFileInput.files.length > 0;
    const options = getDownloadOptions();
    if (hasFile && options) {
      options.style.display = 'block';
    }
    return;
  }
  
  const url = getCurrentUrl();
  
  // Check if URL is for the correct platform
  if (url && url.trim()) {
    // Check if URL matches current platform
    const isYouTube = isYouTubeUrl(url);
    const isTikTok = isTikTokUrl(url);
    const isInstagram = isInstagramUrl(url);
    
    // If URL is for a different platform, show error
    if (currentPlatform === 'youtube' && !isYouTube && (isTikTok || isInstagram)) {
      const wrongPlatform = isTikTok ? 'TikTok' : 'Instagram';
      showMessage(`This link is from ${wrongPlatform}. Please enter a YouTube URL. Example: ${getExampleUrl('youtube')}`, 'error');
      return;
    } else if (currentPlatform === 'instagram' && !isInstagram && (isYouTube || isTikTok)) {
      const wrongPlatform = isYouTube ? 'YouTube' : 'TikTok';
      showMessage(`This link is from ${wrongPlatform}. Please enter an Instagram URL. Example: ${getExampleUrl('instagram')}`, 'error');
      return;
    } else if (currentPlatform === 'tiktok' && !isTikTok && (isYouTube || isInstagram)) {
      const wrongPlatform = isYouTube ? 'YouTube' : 'Instagram';
      showMessage(`This link is from ${wrongPlatform}. Please enter a TikTok URL. Example: ${getExampleUrl('tiktok')}`, 'error');
      return;
    } else if (!isYouTube && !isTikTok && !isInstagram) {
      // URL is not from any known platform
      const platformName = getPlatformName(currentPlatform);
      showMessage(`Invalid link. Please enter a ${platformName} URL. Example: ${getExampleUrl(currentPlatform)}`, 'error');
      return;
    }
  }
  
  const isValid = url && isValidUrl(url);
  const options = getDownloadOptions();
  
  // Show download options if we have valid URL
  if (isValid && options) {
    options.style.display = 'block';
  } else {
    // Hide options if URL is invalid or empty
    if (options) {
      options.style.display = 'none';
    }
  }
}

// Handle audio file input (event listener already set up above)
if (audioFileInput) {
  audioFileInput.addEventListener('change', handleFileSelect);
}

// Show subtitle modal (like extension)
function showSubtitleModal(srtContent, originalLanguage, videoId, sessionId) {
  let modal = document.getElementById('subtitleModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'subtitleModal';
    modal.className = 'quality-modal';
    modal.innerHTML = `
      <div class="quality-modal-content" style="max-width: 800px;">
        <div class="quality-modal-header">
          <h3 class="quality-modal-title">Subtitles</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="subtitle-modal-body">
          <div class="srt-controls">
            <label for="srtLanguageSelect" class="srt-language-label">Subtitle language</label>
            <select id="srtLanguageSelect" class="srt-language-select">
              <option value="original">Original language</option>
              <option value="fa">Persian (fa)</option>
              <option value="en">English</option>
              <option value="ar">Arabic (ar)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="it">Italiano</option>
              <option value="ru">Русский</option>
              <option value="tr">Türkçe</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
            </select>
            <button class="translate-srt-btn" id="translateSrtBtnMain">🔄 Translate</button>
          </div>
          <button class="download-srt-btn" id="downloadSrtBtnMain">📥 Download SRT</button>
          <div class="srt-preview" id="srtPreviewMain" style="max-height: 400px; overflow-y: auto; margin-top: 20px; padding: 16px; background: #f5f5f5; border-radius: 8px; font-family: monospace; font-size: 12px; white-space: pre-wrap; text-align: right;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Close modal
    modal.querySelector('.quality-modal-close').addEventListener('click', () => {
      modal.classList.remove('active');
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
    
    // Translate button
    document.getElementById('translateSrtBtnMain').addEventListener('click', async () => {
      await translateSRT(sessionId);
    });
    
    // Download button
    document.getElementById('downloadSrtBtnMain').addEventListener('click', () => {
      downloadSRTFile(window.currentSrtContent || srtContent, videoId);
    });
  }
  
  // Set initial content
  window.currentSrtContent = srtContent;
  window.originalSrtContent = srtContent;
  window.originalSrtLanguage = originalLanguage;
  document.getElementById('srtPreviewMain').textContent = srtContent;
  
  modal.classList.add('active');
}

// Translate SRT
async function translateSRT(sessionId) {
  const targetLanguage = document.getElementById('srtLanguageSelect').value;
  if (targetLanguage === 'original') {
    document.getElementById('srtPreviewMain').textContent = window.originalSrtContent;
    window.currentSrtContent = window.originalSrtContent;
    return;
  }
  
  const btn = document.getElementById('translateSrtBtnMain');
  btn.disabled = true;
  btn.textContent = '⏳ Translating...';
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        srtContent: window.originalSrtContent,
        targetLanguage: targetLanguage,
        sourceLanguage: window.originalSrtLanguage || window.cutupDetectedSourceLanguage || 'auto',
        metadata: getTranslationMetadata('srt')
      })
    });
    
    if (!response.ok) {
      throw new Error('Translation failed');
    }
    
    const data = await response.json();
    window.currentSrtContent = data.srtContent;
    document.getElementById('srtPreviewMain').textContent = data.srtContent;
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(USER_ERROR_GENERIC, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Translate';
  }
}

// Download SRT file
function downloadSRTFile(srtContent, videoId) {
  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `subtitles_${videoId || Date.now()}.srt`;
  link.click();
  URL.revokeObjectURL(url);
  showMessage('Subtitles downloaded successfully.', 'success');
}

// Features slider for mobile
let currentFeatureIndex = 0;
let featureSliderInterval = null;

function initFeaturesSlider() {
  if (window.innerWidth > 768) return; // Only on mobile
  
  const featuresGrid = document.querySelector('.features-grid');
  if (!featuresGrid) return;
  
  // Wrap features in slider
  const features = Array.from(featuresGrid.children);
  if (features.length === 0) return;
  
  const slider = document.createElement('div');
  slider.className = 'features-slider';
  features.forEach(feature => {
    slider.appendChild(feature);
  });
  
  featuresGrid.innerHTML = '';
  featuresGrid.appendChild(slider);
  
  // Create dots
  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'features-dots';
  for (let i = 0; i < features.length; i++) {
    const dot = document.createElement('div');
    dot.className = `features-dot ${i === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToFeature(i));
    dotsContainer.appendChild(dot);
  }
  featuresGrid.appendChild(dotsContainer);
  
  // Auto-play
  featureSliderInterval = setInterval(() => {
    currentFeatureIndex = (currentFeatureIndex + 1) % features.length;
    goToFeature(currentFeatureIndex);
  }, 2000);
  
  // Touch swipe
  let touchStartX = 0;
  let touchEndX = 0;
  
  slider.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  });
  
  slider.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  });
  
  function handleSwipe() {
    if (touchEndX < touchStartX - 50) {
      // Swipe left
      currentFeatureIndex = (currentFeatureIndex + 1) % features.length;
      goToFeature(currentFeatureIndex);
    }
    if (touchEndX > touchStartX + 50) {
      // Swipe right
      currentFeatureIndex = (currentFeatureIndex - 1 + features.length) % features.length;
      goToFeature(currentFeatureIndex);
    }
  }
}

function goToFeature(index) {
  const slider = document.querySelector('.features-slider');
  const dots = document.querySelectorAll('.features-dot');
  
  if (slider) {
    slider.style.transform = `translateX(-${index * 100}%)`;
  }
  
  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
  
  currentFeatureIndex = index;
  
  // Reset auto-play timer
  if (featureSliderInterval) {
    clearInterval(featureSliderInterval);
    featureSliderInterval = setInterval(() => {
      currentFeatureIndex = (currentFeatureIndex + 1) % dots.length;
      goToFeature(currentFeatureIndex);
    }, 2000);
  }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  initFeaturesSlider();
});

// Reinitialize on resize
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    initFeaturesSlider();
  }
});

function setupMobileHeaderMenu() {
  if (document.querySelector('.main-header, .simple-header')) return;
  const toggle = document.getElementById('navMenuToggle');
  const links = document.getElementById('navLinks');
  if (!toggle || !links) return;

  const closeMenu = () => {
    links.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', () => {
    const nextState = !links.classList.contains('is-open');
    links.classList.toggle('is-open', nextState);
    toggle.setAttribute('aria-expanded', String(nextState));
  });

  links.querySelectorAll('a, button').forEach((item) => {
    item.addEventListener('click', () => {
      if (window.innerWidth < 640) closeMenu();
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 640) closeMenu();
  });
}

function setupMobileStickyActions() {
  const stickyBar = document.getElementById('mobileStickyActions');
  const resultSection = document.getElementById('resultSection');
  const fullBtn = document.getElementById('stickyFullTranscriptBtn');
  const srtBtn = document.getElementById('stickySrtBtn');
  const downloadBtn = document.getElementById('stickyDownloadBtn');
  if (!stickyBar || !resultSection || !fullBtn || !srtBtn || !downloadBtn) return;

  const updateStickyVisibility = () => {
    const hasResult = resultSection.style.display !== 'none' && resultSection.textContent.trim().length > 0;
    const isMobile = window.innerWidth < 640;
    stickyBar.classList.toggle('visible', isMobile && hasResult);
    document.body.classList.toggle('has-mobile-sticky-actions', isMobile && hasResult);
    stickyBar.setAttribute('aria-hidden', String(!(isMobile && hasResult)));
  };

  fullBtn.addEventListener('click', () => {
    switchTab('fulltext');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  srtBtn.addEventListener('click', () => {
    const activePlatformTab = document.querySelector('.platform-tab.active')?.dataset.tab || 'youtube';
    const map = {
      youtube: 'downloadSubtitleBtnMain',
      instagram: 'downloadSubtitleBtnInstagram',
      tiktok: 'downloadSubtitleBtnTiktok',
      audiofile: 'downloadSubtitleBtnAudiofile'
    };
    const srtActionButton = document.getElementById(map[activePlatformTab] || map.youtube);
    if (srtActionButton) {
      srtActionButton.click();
      return;
    }
    switchTab('srt');
  });

  downloadBtn.addEventListener('click', () => {
    if (cutupStickyPrimaryState === 'tryAnother') {
      document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => document.getElementById('youtubeUrlInput')?.focus(), 450);
      cutupStickyLastScrollAt = Date.now();
      refreshStickyPrimaryMode();
      return;
    }
    if (cutupStickyPrimaryState === 'saveResult') {
      document.getElementById('conversionSaveBlock')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        if (!cutupIsLoggedIn()) {
          document.getElementById('conversionSaveEmail')?.focus({ preventScroll: true });
        } else {
          document.getElementById('conversionSaveBtn')?.focus({ preventScroll: true });
        }
      }, 400);
      return;
    }
    const active = document.querySelector('#resultSection .tab-content.active');
    if (!active) return;
    if (active.id === 'summary-tab') {
      document.getElementById('downloadSummaryTxtBtn')?.click();
      return;
    }
    if (active.id === 'srt-tab') {
      document.getElementById('downloadSrtBtn')?.click();
      return;
    }
    document.getElementById('downloadFulltextTxtBtn')?.click();
  });

  const observer = new MutationObserver(() => {
    updateStickyVisibility();
    refreshStickyPrimaryMode();
  });
  observer.observe(resultSection, { attributes: true, childList: true, subtree: true });

  window.addEventListener('scroll', () => {
    cutupStickyLastScrollAt = Date.now();
    refreshStickyPrimaryMode();
  }, { passive: true });

  window.addEventListener('resize', () => {
    updateStickyVisibility();
    refreshStickyPrimaryMode();
  });
  document.addEventListener('visibilitychange', () => {
    updateStickyVisibility();
    refreshStickyPrimaryMode();
  });
  setInterval(() => {
    refreshStickyPrimaryMode();
  }, 900);
  updateStickyVisibility();
  refreshStickyPrimaryMode();
}

window.addEventListener('DOMContentLoaded', () => {
  setupMobileHeaderMenu();
  setupMobileStickyActions();
  setupConversionLayerInteractions();
  setupRetentionInteractions();
  setupMonetizationPaywallUi();
});

