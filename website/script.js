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
window.CutupApp = window.CutupApp || {
  activePlatform: 'youtube',
  currentUrl: '',
  pendingAction: null,
  processingState: 'idle',
  authState: 'anonymous',
  /** idle | pending | ready | error — subscription fetch vs session */
  subscriptionHydration: 'idle',
  /** true only after /api/auth?action=me succeeds — not just localStorage */
  sessionVerified: false
};

/**
 * Single source of truth for Cutup session id (localStorage + in-memory mirror).
 * OAuth and some flows set localStorage; keep currentSession in sync to avoid guest UI drift.
 */
function getCutupSessionId() {
  try {
    const ls = localStorage.getItem('cutup_session');
    if (ls && String(ls).trim()) return String(ls).trim();
  } catch (_e) {
    /* ignore */
  }
  return currentSession && String(currentSession).trim() ? String(currentSession).trim() : '';
}

function cutupSessionIsVerified() {
  return window.CutupApp?.sessionVerified === true;
}

function cutupMarkSessionVerified(verified, source) {
  try {
    window.CutupApp.sessionVerified = Boolean(verified);
    console.log('[session-sync] verified', { verified: Boolean(verified), source: source || '' });
  } catch (_e) {
    /* ignore */
  }
}

function setCutupSession(sessionId, source) {
  const sid = sessionId && String(sessionId).trim() ? String(sessionId).trim() : '';
  if (!sid) return;
  try {
    localStorage.setItem('cutup_session', sid);
  } catch (_e) {
    /* ignore */
  }
  currentSession = sid;
  cutupMarkSessionVerified(false, source ? `${source}_pending_verify` : 'pending_verify');
  try {
    window.CutupApp.authState = 'authenticated';
  } catch (_e2) {
    /* ignore */
  }
  try {
    console.log('[session-sync]', source || 'set', { hasSession: true });
  } catch (_e3) {
    /* ignore */
  }
}

function clearCutupSession(reason) {
  try {
    localStorage.removeItem('cutup_session');
  } catch (_e) {
    /* ignore */
  }
  window.CutupWorkspaceAutosave?.clear?.();
  currentSession = null;
  cutupMarkSessionVerified(false, reason || 'cleared');
  try {
    window.CutupApp.authState = 'anonymous';
    window.CutupApp.subscriptionHydration = 'idle';
  } catch (_e2) {
    /* ignore */
  }
  try {
    console.log('[session-sync] cleared', reason || '');
  } catch (_e3) {
    /* ignore */
  }
}

function cutupResumeModeActive() {
  try {
    return new URLSearchParams(window.location.search).get('resume') === '1';
  } catch (_e) {
    return false;
  }
}

/** Default duration estimate for quota pre-checks when duration is unknown (not shown as “~N videos” to users). */
const AVG_VIDEO_MINUTES = 7;

/** Bump when deploying script.js — forces browsers/CDN to fetch fresh asset. */
const CUTUP_SCRIPT_BUILD = '20260521-fix-youtube-after';
if (typeof window !== 'undefined') {
  window.CUTUP_SCRIPT_BUILD = CUTUP_SCRIPT_BUILD;
  console.log('[cutup-script-build]', CUTUP_SCRIPT_BUILD);
}

const YT_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function safeParseUrlClient(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return new URL(s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`);
  } catch {
    return null;
  }
}

/** Strip tracking params before parse/validate (YouTube, Instagram, TikTok). */
function stripTrackingQueryParamsClient(url) {
  const u = safeParseUrlClient(url);
  if (!u) return String(url || '').trim();
  const drop = new Set([
    'si', 'feature', 'fbclid', 'igsh', 'igshid',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
  ]);
  for (const key of [...u.searchParams.keys()]) {
    if (drop.has(key.toLowerCase())) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

/** Canonical YouTube ID parser — keep in sync with api/media-url.js */
function parseYouTubeVideoIdCanonical(urlOrId) {
  const raw = stripTrackingQueryParamsClient(urlOrId);
  if (!raw) return null;
  if (YT_VIDEO_ID_RE.test(raw)) return raw;

  const u = safeParseUrlClient(raw);
  if (u) {
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return YT_VIDEO_ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        return v && YT_VIDEO_ID_RE.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/i);
      if (m && YT_VIDEO_ID_RE.test(m[2])) return m[2];
    }
  }

  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/watch\?[^#]*v=([a-zA-Z0-9_-]{11})/i,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/i,
    /[?&]v=([a-zA-Z0-9_-]{11})/i
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && YT_VIDEO_ID_RE.test(m[1])) return m[1];
  }
  return null;
}

function normalizeYouTubeWatchUrlCanonical(url) {
  const id = parseYouTubeVideoIdCanonical(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function isInstagramStoryUrl(url) {
  const u = safeParseUrlClient(stripTrackingQueryParamsClient(url));
  if (!u || !u.hostname.toLowerCase().includes('instagram.com')) return false;
  return /^\/stories\/[^/]+\/\d+\/?$/i.test(u.pathname);
}

function normalizeInstagramUrlCanonical(url) {
  const u = safeParseUrlClient(stripTrackingQueryParamsClient(url));
  if (!u || !u.hostname.toLowerCase().includes('instagram.com')) return null;
  let path = u.pathname.replace(/\/+$/, '') || '/';
  path = path.replace(/^\/reels\//i, '/reel/');
  if (/^\/(reel|p|tv)\/[A-Za-z0-9_-]+\/?$/i.test(path)) {
    return `https://www.instagram.com${path}${path.endsWith('/') ? '' : '/'}`;
  }
  return null;
}

/** Normalize YouTube URL for API calls; returns { original, cleaned, normalizedUrl, videoId }. */
function resolveYouTubeUrlForPipeline(inputUrl) {
  const original = String(inputUrl || '').trim();
  const cleaned = stripTrackingQueryParamsClient(original);
  const videoId = parseYouTubeVideoIdCanonical(cleaned);
  const normalizedUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  console.log('[shorts-debug] original', original);
  console.log('[shorts-debug] normalized', normalizedUrl || cleaned);
  console.log('[shorts-debug] videoId', videoId);
  return { original, cleaned, normalizedUrl, videoId };
}

/** Legacy generic — prefer categorized messages from mapErrorCodeToUserMessage. */
const USER_ERROR_GENERIC = 'We hit a temporary processing issue. Please try again in a few seconds.';

/** Pipeline step labels — progress bar + trust-preserving orchestration copy. */
const CUTUP_PIPELINE = {
  DOWNLOAD: '✓ Downloading video',
  EXTRACT_AUDIO: '✓ Extracting audio',
  CHECK_SUBTITLES: '✓ Checking subtitles',
  SWITCH_ENGINE: '✓ Switching transcription engine',
  GENERATE_TRANSCRIPT: '✓ Generating transcript',
  READ_CAPTIONS: '✓ Reading captions',
  WRITING_SUMMARY: '✓ Writing summary'
};

/** Shown while transcription runs long (server may be using backup providers). */
const USER_TRANSCRIPTION_BACKUP_MSG = 'High demand detected. Switching AI engine…';
const USER_TRANSCRIPTION_FALLBACK_MSG = 'Trying alternative transcription provider…';
const USER_TRANSCRIPTION_STILL_WORKING_MSG = 'Still processing your video…';

function cutupPulseTranscriptionOrchestration(stage = 0) {
  const msgs = [
    USER_TRANSCRIPTION_STILL_WORKING_MSG,
    USER_TRANSCRIPTION_BACKUP_MSG,
    USER_TRANSCRIPTION_FALLBACK_MSG
  ];
  const text = msgs[Math.min(Math.max(0, stage), msgs.length - 1)];
  showMessage(text, 'info');
  const bar = document.getElementById('downloadProgressContainer');
  if (bar && bar.style.display !== 'none') {
    const pct = Math.max(typeof progressCurrentPercent === 'number' ? progressCurrentPercent : 0, 32);
    updateProgressBar(
      0,
      0,
      pct,
      stage >= 1 ? CUTUP_PIPELINE.SWITCH_ENGINE : CUTUP_PIPELINE.GENERATE_TRANSCRIPT
    );
  }
}

function makeRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeTraceId() {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `tr_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getPipelineFetchTimeoutMs(kind) {
  const mobile = isMobileBrowser();
  if (kind === 'extract') return mobile ? 420000 : 300000;
  if (kind === 'transcribe') return mobile ? 1080000 : 900000;
  return mobile ? 600000 : 480000;
}

let cutupPipelineInFlight = false;
let cutupLastPipelineRetry = null;

function mapErrorCodeToUserMessage(errorCode) {
  switch (String(errorCode || '').toUpperCase()) {
    case 'OPENAI_QUOTA_EXCEEDED':
      return USER_TRANSCRIPTION_BACKUP_MSG;
    case 'TRANSCRIPTION_FAILED':
    case 'ALL_PROVIDERS_FAILED':
      return `${USER_TRANSCRIPTION_STILL_WORKING_MSG} Our backup engines could not finish this run — please retry in a moment.`;
    case 'INVALID_AUDIO':
      return 'We could not read this audio. Try another format or a shorter clip.';
    case 'QUOTA_EXCEEDED':
      return "You've reached your monthly limit.";
    case 'VIDEO_UNAVAILABLE':
      return 'This video could not be processed.';
    case 'FILE_TOO_LARGE':
      return 'This clip is too large for one run. Try a shorter video.';
    case 'DOWNLOAD_FAILED':
      return 'The platform temporarily rejected the request.';
    case 'TRANSCRIPTION_TIMEOUT':
    case 'PROVIDER_ERROR':
    case 'UNKNOWN_ERROR':
      return 'We hit a temporary processing issue. Please try again in a few seconds.';
    case 'NETWORK_ERROR':
      return 'Connection issue detected. Please try again.';
    case 'SESSION_EXPIRED':
      return 'Your session expired. Please sign in again and retry.';
    case 'INVALID_URL':
      return 'This link format is not supported yet.';
    case 'SHORTS_PARSE_ERROR':
      return "We couldn't recognize this Shorts link.";
    case 'PLATFORM_ERROR':
      return "We couldn't access this video.";
    case 'INSTAGRAM_STORY_UNSUPPORTED':
      return 'Instagram Stories are not publicly downloadable. Please use a Reel or Post URL.';
    case 'TRANSCRIPT_MISSING':
      return 'No transcript available. Generate subtitles first, then translate.';
    case 'TRANSLATION_UNAVAILABLE':
      return 'Translation is temporarily unavailable. Please try again in a few minutes.';
    case 'TRANSLATION_TIMEOUT':
      return 'Translation timed out. Please try again.';
    case 'TRANSLATION_PROVIDER_UNAVAILABLE':
      return 'Translation service is not configured. Please contact support.';
    case 'TRANSLATION_SAME_LANGUAGE':
      return 'Source and target language are the same. Choose a different target language.';
    case 'TRANSLATION_MALFORMED':
    case 'TRANSLATION_TIMESTAMP_MISMATCH':
      return 'Translated subtitles came back in an invalid format. Please try again.';
    case 'TRANSLATION_UNCHANGED':
      return 'Translation did not change the text — try again or pick another language.';
    case 'TRANSLATION_EMPTY_RESPONSE':
      return 'The translation service returned empty lines. Please retry.';
    case 'FEATURE_NOT_AVAILABLE':
      return 'This action is not available on your current plan.';
    case 'INVALID_TRANSCRIPT_PAYLOAD':
      return 'Invalid transcript payload. Please regenerate this output and try again.';
    default:
      return USER_ERROR_GENERIC;
  }
}

function isRetryableErrorCode(errorCode) {
  const c = String(errorCode || '').toUpperCase();
  if (['DOWNLOAD_FAILED', 'PLATFORM_ERROR', 'NETWORK_ERROR', 'PROVIDER_ERROR', 'UNKNOWN_ERROR'].includes(c)) {
    return true;
  }
  return ![
    'OPENAI_QUOTA_EXCEEDED',
    'INVALID_AUDIO',
    'QUOTA_EXCEEDED',
    'VIDEO_UNAVAILABLE',
    'FILE_TOO_LARGE',
    'INVALID_URL',
    'SHORTS_PARSE_ERROR',
    'SESSION_EXPIRED',
    'TRANSCRIPT_MISSING',
    'TRANSLATION_SAME_LANGUAGE',
    'INSTAGRAM_STORY_UNSUPPORTED',
    'FEATURE_NOT_AVAILABLE'
  ].includes(c);
}

async function fetchWithRetry(url, options = {}, { maxAttempts = 2 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (attempt < maxAttempts && res.status >= 502 && res.status <= 504) {
        console.warn('[fetch-retry]', { attempt, status: res.status, url });
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      const retryableNet =
        err?.name === 'TypeError' ||
        (err?.name === 'AbortError' && attempt === 1);
      if (attempt < maxAttempts && retryableNet) {
        console.warn('[fetch-retry]', { attempt, message: err?.message });
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function buildPipelineErrorFromApi(data, response, traceId) {
  if (data && data.errorCode) {
    const errorCode = String(data.errorCode).toUpperCase();
    const e = new Error(data.message || mapErrorCodeToUserMessage(errorCode));
    e.errorCode = errorCode;
    e.pipelineCode = errorCode;
    e.retryable = data.retryable === true || (data.retryable !== false && isRetryableErrorCode(errorCode));
    e.traceId = data.traceId || traceId;
    e.requestId = data.requestId || traceId;
    e.pipelineStage = data.phase || data.stage || null;
    if (data.debug && typeof data.debug === 'object') {
      e.debug = data.debug;
    }
    return e;
  }
  const legacy = String(data?.error || data?.code || '').toUpperCase();
  const e = new Error(data?.message || USER_ERROR_GENERIC);
  e.pipelineCode = legacy || `HTTP_${response?.status || 500}`;
  e.requestId = data?.requestId || traceId;
  e.traceId = traceId;
  if (response?.status === 504 || response?.status === 503) {
    e.errorCode = 'TRANSCRIPTION_TIMEOUT';
    e.retryable = true;
    e.message =
      'Video download took too long and the server timed out. Please retry in a minute — shorter clips work best.';
  } else if (response?.status === 401) e.errorCode = 'SESSION_EXPIRED';
  else if (response?.status === 403 && legacy.includes('LIMIT')) e.errorCode = 'QUOTA_EXCEEDED';
  else if (legacy.includes('TIMEOUT')) e.errorCode = 'TRANSCRIPTION_TIMEOUT';
  else if (legacy.includes('UNAVAILABLE') || legacy.includes('PRIVATE')) e.errorCode = 'VIDEO_UNAVAILABLE';
  else if (legacy.includes('SHORTS_PARSE')) e.errorCode = 'SHORTS_PARSE_ERROR';
  else if (legacy.includes('UNSUPPORTED') || legacy.includes('MALFORMED') || legacy.includes('INVALID')) e.errorCode = 'INVALID_URL';
  else if (legacy.includes('NETWORK') || legacy.includes('ECONNRESET')) e.errorCode = 'NETWORK_ERROR';
  else if (legacy.includes('YOUTUBE') || legacy.includes('YTDLP') || legacy.includes('DOWNLOAD')) e.errorCode = 'DOWNLOAD_FAILED';
  if (e.errorCode) {
    e.retryable = isRetryableErrorCode(e.errorCode);
    if (response?.status !== 504 && response?.status !== 503) {
      e.message = mapErrorCodeToUserMessage(e.errorCode);
    }
  }
  return e;
}

function beginPipelineRun() {
  if (cutupPipelineInFlight) {
    showMessage('A transcript is already in progress. Please wait…', 'info');
    return false;
  }
  cutupPipelineInFlight = true;
  clearPipelineRetryUi();
  return true;
}

function endPipelineRun() {
  cutupPipelineInFlight = false;
}

function clearPipelineRetryUi() {
  const btn = document.getElementById('pipelineRetryBtn');
  if (btn) btn.style.display = 'none';
}

function clearProgressBarFailureState() {
  const progressContainer = document.getElementById('downloadProgressContainer');
  const progressFill = document.getElementById('progressFill');
  if (progressContainer) progressContainer.classList.remove('progress-failed');
  if (progressFill) progressFill.style.removeProperty('background');
}

function markProgressBarFailed(shortLabel = 'Could not finish') {
  const progressTitle = document.getElementById('progressTitle');
  const progressFill = document.getElementById('progressFill');
  const progressContainer = document.getElementById('downloadProgressContainer');
  if (progressTitle) progressTitle.textContent = shortLabel;
  if (progressFill) {
    progressFill.style.background = 'linear-gradient(90deg, #e74c3c, #c0392b)';
  }
  if (progressContainer) {
    progressContainer.classList.add('progress-failed');
    progressContainer.style.display = 'block';
    if (progressContainer._hideT) {
      clearTimeout(progressContainer._hideT);
      progressContainer._hideT = null;
    }
  }
}

function showPipelineError(error, retryFn) {
  const errorCode = error?.errorCode || error?.pipelineCode;
  const retryable = error?.retryable === true || (error?.retryable !== false && isRetryableErrorCode(errorCode));
  const traceId = error?.traceId || error?.requestId;
  if (traceId) console.warn('[transcript-trace]', traceId, { errorCode, retryable, stage: error?.pipelineStage || error?.phase });
  const text = formatPipelineErrorForUi(error);
  markProgressBarFailed('Download failed');
  showMessage(text, 'error', { persistMs: 30000 });
  if (downloadMessage?.scrollIntoView) {
    downloadMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const btn = document.getElementById('pipelineRetryBtn');
  if (!btn) return;
  if (retryable && typeof retryFn === 'function') {
    cutupLastPipelineRetry = retryFn;
    btn.style.display = 'inline-block';
    btn.onclick = () => {
      btn.style.display = 'none';
      clearProgressBarFailureState();
      if (typeof cutupLastPipelineRetry === 'function') cutupLastPipelineRetry();
    };
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    clearPipelineRetryUi();
  }
}

function mapPipelineErrorToUserMessage(error, fallback = USER_ERROR_GENERIC) {
  const canonical = String(error?.errorCode || '').toUpperCase();
  const msg = String(error?.message || '').trim();

  if (canonical === 'OPENAI_QUOTA_EXCEEDED') {
    return mapErrorCodeToUserMessage(canonical);
  }

  // Prefer server detail for transcription failures (quota / missing backup provider).
  if (canonical === 'TRANSCRIPTION_FAILED' || canonical === 'INVALID_AUDIO') {
    const boilerplate = mapErrorCodeToUserMessage(canonical);
    if (msg && msg !== USER_ERROR_GENERIC && msg !== boilerplate) {
      return msg.length > 720 ? `${msg.slice(0, 717)}…` : msg;
    }
    return boilerplate;
  }

  // Show API-provided detail when it differs from boilerplate (otherwise Shorts/Whisper failures always looked "generic").
  if (canonical && msg && msg !== USER_ERROR_GENERIC) {
    const boilerplate = mapErrorCodeToUserMessage(canonical);
    if (msg !== boilerplate) {
      return msg.length > 720 ? `${msg.slice(0, 717)}…` : msg;
    }
  }

  if (canonical) return mapErrorCodeToUserMessage(canonical);
  const code = String(error?.pipelineCode || error?.code || '').toUpperCase();
  if (code.includes('LIMIT_EXCEEDED') || /included generations this month/i.test(msg)) {
    return humanizeLimitReason(msg) || 'You’ve reached your monthly limit.';
  }
  if (code.includes('FEATURE_NOT_AVAILABLE') || code.includes('SUBSCRIPTION_INACTIVE')) {
    return msg || 'This feature isn’t available on your current plan.';
  }
  if (code.includes('AUTH_OR_PLAN') || code.includes('NO_SESSION') || code.includes('INVALID_SESSION')) {
    return 'Your session expired or we couldn’t verify your plan. Sign in again and retry.';
  }
  if (code.includes('QUOTA_ERROR') && /openai/i.test(msg)) {
    return 'Our transcription service is temporarily at capacity. Please try again in a few minutes.';
  }
  if (code.includes('CONNECTION_ERROR') || code.includes('ECONNRESET')) {
    return 'Connection issue detected. Please try again.';
  }
  if (code.includes('OPENAI_ERROR') || code.includes('TRANSCRIBE_FAILED') || code.includes('TRANSCRIBE_ERROR')) {
    if (/timeout|timed out/i.test(msg)) {
      return 'Processing took longer than expected. Please retry.';
    }
    if (msg && !/^transcription failed$/i.test(msg)) {
      return msg;
    }
    return 'Processing took longer than expected. Please retry.';
  }
  if (code.includes('FILE_TOO_LARGE')) {
    return 'This file is too large for one run. Try a shorter clip.';
  }
  if (code.includes('DOWNLOAD_FAILED') || /could not extract video stream/i.test(msg)) {
    return 'We could not download audio from YouTube right now. Wait a minute and tap Retry, or try another public video.';
  }
  if (code.includes('PLATFORM_ERROR') || code.includes('SOCIAL_DOWNLOAD_EMPTY') || code.includes('AUDIO_EXTRACTION')) {
    return "We couldn't access this video.";
  }
  if (code.includes('EMPTY') || /no transcript returned/i.test(msg)) {
    return 'We couldn’t get usable text from this video. Try another link or file.';
  }
  if (code.includes('INSTAGRAM_STORY')) {
    return 'Instagram Stories are not publicly downloadable. Please use a Reel or Post URL.';
  }
  if (code.includes('UNSUPPORTED_INSTAGRAM_URL')) {
    return 'Please paste a direct Instagram Reel, Post, or Video link.';
  }
  if (code.includes('UNSUPPORTED_TIKTOK_URL')) {
    return 'Please paste a direct TikTok video link.';
  }
  if (code.includes('UNSUPPORTED_YOUTUBE_URL')) {
    return 'Please paste a direct YouTube video link.';
  }
  if (code.includes('MALFORMED_URL') || code.includes('UNSUPPORTED_URL')) {
    return 'The link format is not supported. Please paste a direct video URL.';
  }
  if (code.includes('SOCIAL_LOGIN_REQUIRED') || code.includes('INSTAGRAM_COOKIES_MISSING')) {
    return 'Instagram session is not set up on the server yet. Please contact support or try again after cookies are configured.';
  }
  if (code.includes('YTDLP_TIMEOUT')) {
    return 'Extraction timed out on the media provider. Please try again shortly.';
  }
  if (code.includes('YTDLP_SPAWN_FAILED') || code.includes('FFMPEG_MISSING')) {
    return 'Server dependency error during extraction. Please retry and share the request ID.';
  }
  if (code.includes('INSTAGRAM') || code.includes('SOCIAL_DOWNLOAD')) {
    return 'Instagram blocked this download. If the link is a public Reel, try again in a minute — otherwise the server may need updated Instagram session cookies.';
  }
  if (code.includes('TIKTOK')) {
    return 'We couldn’t access this TikTok video. Please check the link and try again.';
  }
  if (code.includes('TRANSCRIBE_TIMEOUT') || code.includes('OPENAI_TIMEOUT')) {
    return 'Transcription is taking longer than expected. Please retry in a moment.';
  }
  if (code.includes('FFMPEG') || code.includes('MEDIA_PROCESS')) {
    return 'We couldn’t process the media file. Please try another file or link.';
  }
  if (code.includes('NETWORK')) {
    return 'Connection interrupted during processing. Please try again.';
  }
  return fallback;
}

function formatPipelineErrorForUi(error, fallback = USER_ERROR_GENERIC) {
  const base = mapPipelineErrorToUserMessage(error, fallback);
  const traceId = error?.traceId || error?.requestId;
  let out = base;
  if (traceId && typeof traceId === 'string' && traceId.startsWith('tr_')) {
    out = `${base} (ref: ${traceId})`;
  }
  const prov = error?.debug?.provider;
  if (prov != null && typeof prov === 'object') {
    try {
      out += `\n\n[Admin debug]\n${JSON.stringify(prov, null, 2)}`;
    } catch {
      out += `\n\n[Admin debug]\n${String(prov)}`;
    }
  }
  return out;
}

async function parseApiErrorMessage(response, fallback = USER_ERROR_GENERIC) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const raw =
    (data && (data.message || data.reason || data.details || data.error)) ||
    `${response.status} ${response.statusText || ''}`.trim();
  const normalized = humanizeLimitReason(String(raw || fallback));
  return normalized || fallback;
}

/** Plan verification failed (subscription check unreachable). */
const USER_PLAN_VERIFY_FAIL = 'We couldn\'t verify your plan. Check your connection, refresh the page, and try again.';

/** When limit API returns no reason string (should be rare). */
const LIMIT_UPGRADE_FALLBACK =
  'You’ve used your included videos for this billing month. You can upgrade for more—or try again after your reset date in the dashboard.';

/** Rewrite API limit strings — conversion-focused, no raw billing jargon. */
function humanizeLimitReason(reason) {
  if (!reason || typeof reason !== 'string') {
    return 'You\'re one step away from uninterrupted subtitles—upgrade to keep going.';
  }
  if (/Daily limit reached/i.test(reason)) {
    return 'You\'ve hit today\'s free preview cap. Upgrade now and finish this project today—or try again tomorrow.';
  }
  if (/Monthly limit reached/i.test(reason)) {
    return 'You’ve used all included videos for this month. Your dashboard shows when your limit resets—and you can upgrade anytime for a higher monthly allowance.';
  }
  if (/download limit/i.test(reason)) {
    return 'You\'ve used this month\'s download allowance. Upgrade to grab more files without waiting for reset.';
  }
  if (
    /requires Starter or higher/i.test(reason) ||
    /available on Starter/i.test(reason) ||
    /available on Pro and Business/i.test(reason) ||
    /Business plan required/i.test(reason) ||
    /video processing credits/i.test(reason)
  ) {
    return reason;
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
  return 'That isn’t available on your current plan right now. Check your dashboard for limits and upgrade options when you need more.';
}

/** Lightweight viral line for SRT preview & exports (client-side only). */
const CUTUP_SRT_ATTRIBUTION = '\n# Generated by Cutup — https://cutup.shop\n';

/** Normalize API / pipeline transcription payloads (text vs transcript vs content). */
function normalizeTranscriptionResult(result) {
  if (!result) return { text: '', segments: [], language: null };
  if (Array.isArray(result?.segments) && result.segments.length) {
    window.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('whisper_api_response', result.segments, {
      source: 'normalizeTranscriptionResult_input'
    });
  }
  const text = result.text ?? result.transcript ?? result.content ?? '';
  const langDet = result.languageDetection || null;
  if (langDet?.detectedLanguage || langDet?.language) {
    console.log('[language-confidence-client]', {
      language: langDet.language ?? langDet.detectedLanguage,
      languageConfidence: langDet.languageConfidence ?? langDet.confidence,
      accent: langDet.accent,
      accentConfidence: langDet.accentConfidence,
      providerAgreement: langDet.providerAgreement,
      confidence: langDet.confidence ?? langDet.languageConfidence,
      detectedBy: langDet.detectedBy,
      needsReview: langDet.needsReview,
      transcriptSample: langDet.transcriptSample,
      whisperLanguage: langDet.whisperLanguage,
      providerLanguage: langDet.providerLanguage,
      verificationTriggered: langDet.verificationTriggered,
      verificationApplied: langDet.verificationApplied
    });
  }
  const rawSegments = Array.isArray(result.segments) ? result.segments : [];
  if (result.asrPipeline === 'v2') {
    window.cutupAsrPipeline = 'v2';
    window.cutupProviderWords = Array.isArray(result.words) ? result.words : [];
    window.cutupAsrSegmentSource = result.segmentSource || null;
    console.log('[asr-client]', {
      pipeline: 'v2',
      segmentCount: rawSegments.length,
      wordCount: window.cutupProviderWords.length,
      segmentSource: result.segmentSource || null,
      wordGapFill: result.wordGapFill || null,
      gapRetranscribe: result.gapRetranscribe || null,
      largestGapSec: computeClientSegmentGapSec(rawSegments),
      segmentStarts: rawSegments.slice(0, 12).map((s) => Number(s.start).toFixed(2))
    });
  } else if (result.asrPipeline === 'v1') {
    window.cutupAsrPipeline = 'v1';
  } else {
    console.warn('[asr-client] API did not report asrPipeline — server may need restart or deploy');
  }
  const normalized = {
    text: String(text || '').trim(),
    segments: rawSegments.length ? normalizeSegmentsForDisplay(rawSegments) : [],
    language: result.language ?? langDet?.language ?? langDet?.detectedLanguage ?? null,
    languageDetection: langDet,
    transcriptionRuntime: result.transcriptionRuntime || null,
    asrPipeline: result.asrPipeline || window.cutupAsrPipeline || null,
    words: Array.isArray(result.words) ? result.words : window.cutupProviderWords || [],
    wordGapFill: result.wordGapFill || null
  };
  if (normalized.segments.length) {
    window.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('after_client_normalize', normalized.segments);
  }
  return normalized;
}

function resolveFinalLanguageForUi(options = {}) {
  const langDet = options.languageDetection || null;
  return (
    langDet?.language ??
    langDet?.detectedLanguage ??
    options.originalLanguage ??
    null
  );
}

function requestPipelineFeedback(action, meta = {}) {
  window.CutupPipelineFeedback?.show?.(action, meta);
}

function stripPreviewMarkersFromTranscript(text) {
  return String(text || '')
    .replace(/\n\n\[Preview only[\s\S]*$/i, '')
    .replace(/\n\n\[You're seeing ~[\s\S]*$/i, '')
    .replace(/\n\n\[Preview ends here[\s\S]*$/i, '')
    .trim();
}

function getStoredTranscriptText() {
  if (window.originalFullText && String(window.originalFullText).trim()) {
    return stripPreviewMarkersFromTranscript(window.originalFullText);
  }
  const cached = window.cutupLastTranscription;
  if (cached?.fullText && String(cached.fullText).trim()) {
    return stripPreviewMarkersFromTranscript(cached.fullText);
  }
  if (cached?.transcription && String(cached.transcription).trim()) {
    return stripPreviewMarkersFromTranscript(cached.transcription);
  }
  const el = document.getElementById('fulltext');
  if (el?.textContent?.trim()) {
    return stripPreviewMarkersFromTranscript(el.textContent);
  }
  return '';
}

function stripSrtForTranslation(srt) {
  return String(srt || '')
    .replace(CUTUP_SRT_ATTRIBUTION, '')
    .replace(/\n# Generated by Cutup[^\n]*/gi, '')
    .replace(/\[Preview only[\s\S]*?(?=\n\n\d+\n|$)/gi, '')
    .replace(/\[Preview ends here[\s\S]*?(?=\n\n\d+\n|$)/gi, '')
    .trim();
}

function getStoredSrtContent() {
  const raw = window.originalSrtContent || window.currentSrtContent || '';
  const cleaned = stripSrtForTranslation(raw);
  if (cleaned) return cleaned;
  const previewEl = document.getElementById('srtPreview');
  if (previewEl?.textContent?.trim()) {
    const fromDom = stripSrtForTranslation(previewEl.textContent);
    if (fromDom) return fromDom;
  }
  const cached = window.cutupLastTranscription;
  if (Array.isArray(cached?.segments) && cached.segments.length > 0) {
    return generateSRTFromSubtitles(cached.segments);
  }
  const text = getStoredTranscriptText();
  return text ? buildPseudoSrtFromPlainText(text) : '';
}

const TRANSLATE_FETCH_TIMEOUT_MS = 180000;

function normalizeSourceLanguageForApi(code) {
  const raw = String(code || '').toLowerCase().trim();
  if (!raw || raw === 'auto' || raw === 'und' || raw === 'unknown') return undefined;
  return normalizeLangCode(code) || undefined;
}

/** POST /api/translate-srt with timeout and session header. */
async function fetchTranslateSrtApi(body, sessionId) {
  const stableSid = sessionId || getCutupSessionId();
  if (!stableSid) {
    const e = new Error('Sign in to translate and use pro exports.');
    e.errorCode = 'NO_SESSION';
    throw e;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSLATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': stableSid
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const errCode = String(data?.errorCode || data?.code || 'TRANSLATION_UNAVAILABLE').toUpperCase();
      const detail =
        (data && data.message) ||
        parseApiErrorMessageFromBody(data, response.status) ||
        'Translation temporarily unavailable.';
      const err = new Error(
        errCode === 'OPENAI_QUOTA_EXCEEDED' && !/translate/i.test(String(data?.phase || ''))
          ? mapErrorCodeToUserMessage('OPENAI_QUOTA_EXCEEDED')
          : errCode === 'TRANSLATION_UNAVAILABLE' ||
              errCode === 'TRANSLATION_TIMEOUT' ||
              errCode === 'TRANSLATION_PROVIDER_UNAVAILABLE'
            ? mapErrorCodeToUserMessage(errCode)
            : detail
      );
      err.errorCode = errCode;
      err.phase = data?.phase || null;
      err.traceId = data?.traceId || null;
      err.retryable = data?.retryable !== false;
      if (data?.debug && typeof data.debug === 'object') {
        err.debug = data.debug;
      }
      console.warn('[translate-failed]', {
        status: response.status,
        errorCode: err.errorCode,
        phase: err.phase,
        traceId: err.traceId
      });
      throw err;
    }
    if (data && data.success === false) {
      const ec = String(data.errorCode || 'TRANSLATION_UNAVAILABLE').toUpperCase();
      const err = new Error(
        ec === 'TRANSLATION_UNAVAILABLE' ||
          ec === 'TRANSLATION_TIMEOUT' ||
          ec === 'TRANSLATION_PROVIDER_UNAVAILABLE'
          ? mapErrorCodeToUserMessage(ec)
          : ec === 'OPENAI_QUOTA_EXCEEDED' && !/translate/i.test(String(data?.phase || ''))
            ? mapErrorCodeToUserMessage('OPENAI_QUOTA_EXCEEDED')
            : data.message || 'Translation failed.'
      );
      err.errorCode = ec;
      err.phase = data.phase || null;
      err.traceId = data.traceId || null;
      err.retryable = data.retryable !== false;
      if (data.debug && typeof data.debug === 'object') {
        err.debug = data.debug;
      }
      throw err;
    }
    console.log('[translate-render]', {
      traceId: data?.traceId || null,
      segmentCount: data?.segmentCount,
      targetLanguage: data?.targetLanguage
    });
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const err = new Error('Translation timed out. Please try again.');
      err.errorCode = 'TRANSLATION_TIMEOUT';
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseApiErrorMessageFromBody(data, httpStatus) {
  if (data?.message) return String(data.message);
  if (data?.details) return String(data.details);
  if (data?.error && typeof data.error === 'string') return data.error;
  if (httpStatus) return `Translation request failed (HTTP ${httpStatus}).`;
  return '';
}

/** Build valid SRT from plain text (multi-paragraph safe) for translate-srt API. */
function buildPseudoSrtFromPlainText(text) {
  const cleaned = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chunks = [];
  for (const part of parts) {
    if (part.length <= 220) {
      chunks.push(part);
      continue;
    }
    const sentences = part.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [part];
    let buf = '';
    for (const s of sentences) {
      const next = (buf + ' ' + s).trim();
      if (next.length > 220 && buf) {
        chunks.push(buf);
        buf = s.trim();
      } else {
        buf = next;
      }
    }
    if (buf) chunks.push(buf);
  }
  let t = 0;
  let out = '';
  chunks.forEach((chunk, i) => {
    const dur = Math.min(12, Math.max(2, Math.ceil(chunk.length / 22)));
    const start = formatSRTTime(t);
    const end = formatSRTTime(t + dur);
    out += `${i + 1}\n${start} --> ${end}\n${chunk}\n\n`;
    t += dur;
  });
  return out;
}

function extractPlainTextFromTranslatedSrt(srtContent) {
  const cleaned = stripSrtForTranslation(srtContent);
  const segments = parseSRTToSegments(cleaned);
  if (segments.length > 0) {
    return segments.map((s) => s.text).join('\n\n').trim();
  }
  return String(cleaned || '').split('\n').slice(2).join('\n').trim();
}

function mapTranslateErrorMessage(error, fallback = 'Translation temporarily unavailable.') {
  const code = String(error?.errorCode || error?.pipelineCode || error?.code || '').toUpperCase();
  const msg = String(error?.message || '').trim();
  const phase = String(error?.phase || error?.pipelineStage || '');
  if (code === 'OPENAI_QUOTA_EXCEEDED') {
    if (/translate/i.test(phase)) {
      return 'Translation is temporarily unavailable. Please try again in a few minutes.';
    }
    return mapErrorCodeToUserMessage('OPENAI_QUOTA_EXCEEDED');
  }
  if (
    code === 'TRANSLATION_UNAVAILABLE' ||
    code === 'TRANSLATION_TIMEOUT' ||
    code === 'TRANSLATION_PROVIDER_UNAVAILABLE'
  ) {
    return mapErrorCodeToUserMessage(code);
  }
  if (code.includes('TRANSCRIPT_MISSING') || /no text to translate|no subtitles/i.test(msg)) {
    return 'No transcript available. Generate subtitles first, then translate.';
  }
  if (code.includes('INVALID') && /segment|payload|srt/i.test(msg)) {
    return 'Invalid transcript payload. Please regenerate this output and try again.';
  }
  if (code.includes('TIMEOUT') || /timed out/i.test(msg)) {
    return 'Translation timeout. Please try again.';
  }
  if (code.includes('FEATURE_NOT_AVAILABLE') || code.includes('TRANSLATION_PLAN')) {
    return msg || 'Translation is not available on your current plan.';
  }
  if (code.startsWith('TRANSLATION_') && msg) {
    const ref = error?.traceId && String(error.traceId).startsWith('tr_') ? ` (ref: ${error.traceId})` : '';
    return `${msg}${ref}`;
  }
  if (phase && msg) {
    return `${msg} (phase: ${phase})`;
  }
  if (msg && !/couldn't finish|temporary processing issue/i.test(msg)) return msg;
  return fallback;
}

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
    const raw = document.getElementById('srtPreviewRaw')?.textContent || document.getElementById('srtPreview')?.textContent || '';
    return stripSrtForTranslation(raw).trim();
  }
  return '';
}

/* ========== Conversion layer (save CTA, soft lock, exit intent, sticky modes) ========== */
const CUTUP_LEAD_EMAIL_KEY = 'cutup_lead_email';

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
let cutupStickyGeneratedAt = 0;
let cutupStickyLastScrollAt = 0;
let cutupStickyPrimaryState = 'download';

function cutupIsLoggedIn() {
  return !!getCutupSessionId() && cutupSessionIsVerified();
}

/** Session id in storage (may be stale if API is down). */
function cutupHasStoredSession() {
  return !!getCutupSessionId();
}

/** Survives Google OAuth full-page redirect; mirrored on window for debugging */
const CUTUP_PENDING_ACTION_KEY = 'cutup_pending_action';

/** Pending upload blob survives OAuth full-page redirect (File objects do not). */
const CUTUP_PENDING_UPLOAD_DB_NAME = 'cutup_pending_upload_v1';
const CUTUP_PENDING_UPLOAD_DB_VERSION = 1;
const CUTUP_PENDING_UPLOAD_RECORD_ID = 'pending';

/** User intent through OAuth (localStorage); TTL 10m — see cutupParseLocalPendingAction */
const PENDING_ACTION_LS_KEY = 'pending_action';
const PENDING_ACTION_MAX_MS = 10 * 60 * 1000;

function cutupParseLocalPendingAction() {
  try {
    const raw = localStorage.getItem(PENDING_ACTION_LS_KEY);
    if (!raw) return { valid: false, data: null };
    const p = JSON.parse(raw);
    const ts = p.timestamp || 0;
    if (!ts || Date.now() - ts > PENDING_ACTION_MAX_MS) {
      localStorage.removeItem(PENDING_ACTION_LS_KEY);
      return { valid: false, data: null };
    }
    if (p.payload && p.payload.fileFlow) {
      return { valid: true, data: p };
    }
    const input = (p.payload && p.payload.input != null ? String(p.payload.input) : '').trim();
    if (!input) {
      localStorage.removeItem(PENDING_ACTION_LS_KEY);
      return { valid: false, data: null };
    }
    return { valid: true, data: p };
  } catch {
    try {
      localStorage.removeItem(PENDING_ACTION_LS_KEY);
    } catch (_e2) {
      /* ignore */
    }
    return { valid: false, data: null };
  }
}

function cutupMapPendingTypeToLocalMode(type) {
  if (type === 'generate_subtitle') return { mode: 'subtitle', fileFlow: false };
  if (type === 'summarize') return { mode: 'summary', fileFlow: false };
  if (type === 'resume_upload_tab') return { mode: 'fulltext', fileFlow: true };
  return { mode: 'fulltext', fileFlow: false };
}

function cutupWriteLocalPendingActionForLogin(type, payload) {
  const p = payload || {};
  const { mode, fileFlow } = cutupMapPendingTypeToLocalMode(type);
  const inputVal = fileFlow ? '' : String(p.url != null ? p.url : getCurrentUrl()).trim();
  const platform = String(p.platform || currentPlatform || 'youtube').trim();
  const activeTab =
    p.activeTab || (p.mode === 'subtitle' || mode === 'subtitle' ? 'srt' : mode === 'summary' ? 'summary' : 'fulltext');
  const obj = {
    type: 'generate',
    payload: {
      input: inputVal,
      platform,
      mode,
      fileFlow,
      activeTab
    },
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem(PENDING_ACTION_LS_KEY, JSON.stringify(obj));
  } catch (_e) {
    /* ignore */
  }
}

let cutupLocalResumeStarted = false;

async function cutupExecuteLocalPendingResume(data) {
  if (cutupLocalResumeStarted || !data || !data.payload) return;
  cutupLocalResumeStarted = true;
  cutupClearPendingAction();
  try {
    localStorage.removeItem(PENDING_ACTION_LS_KEY);
  } catch (_e) {
    /* ignore */
  }

  showMessage('Resuming your previous request...', 'info');
  const { payload } = data;
  const platform = payload.platform || 'youtube';

  if (payload.fileFlow) {
    retentionSwitchPlatformWithUrl('audiofile', '');
    try {
      localStorage.removeItem('cutup_pending_url');
      localStorage.removeItem('cutup_pending_platform');
    } catch (_e2) {
      /* ignore */
    }
    if (await cutupResumePendingUploadAfterLogin(payload)) return;
    showMessage('Select your file again to transcribe.', 'info');
    return;
  }

  const input = String(payload.input || '').trim();
  retentionSwitchPlatformWithUrl(platform, input);
  await new Promise((r) => setTimeout(r, 450));

  const mode = payload.mode || 'subtitle';
  try {
    if (mode === 'subtitle') {
      await handleSrtSubtitles();
    } else if (mode === 'summary') {
      await handleSummarize();
    } else {
      await handleFullText('fulltext');
    }
    try {
      localStorage.removeItem('cutup_pending_url');
      localStorage.removeItem('cutup_pending_platform');
    } catch (_e3) {
      /* ignore */
    }
  } catch (err) {
    console.error('[script] cutupExecuteLocalPendingResume failed:', err);
    reportClientError('resume_local_pending', err);
    showMessage(USER_ERROR_GENERIC, 'error');
  }
}

function cutupSocialTranscribeNeedsGoogleAuth(url, file, requestedPlatform) {
  if (
    file &&
    (currentPlatform === 'audiofile' ||
      !url ||
      (typeof url === 'string' && url.startsWith('📁')))
  ) {
    return false;
  }
  const isSocial =
    (requestedPlatform === 'instagram' && isInstagramUrl(url)) ||
    (requestedPlatform === 'tiktok' && isTikTokUrl(url));
  if (!isSocial) return false;
  return !cutupIsLoggedIn();
}

function cutupClearPendingAction() {
  try {
    sessionStorage.removeItem(CUTUP_PENDING_ACTION_KEY);
  } catch (_e) {
    /* ignore */
  }
  try {
    window.__pendingAction = null;
  } catch (_e) {
    /* ignore */
  }
  window.CutupApp.pendingAction = null;
}

function ensureSingleHomepageTool() {
  const tools = Array.from(document.querySelectorAll('#tool.download-section'));
  if (tools.length <= 1) return;
  tools.slice(1).forEach((el) => el.remove());
}

function detectPlatform(url) {
  const v = String(url || '').trim();
  if (!v) return null;
  if (isYouTubeUrl(v)) return 'youtube';
  if (isInstagramUrl(v)) return 'instagram';
  if (isTikTokUrl(v)) return 'tiktok';
  return null;
}

function showAuthTransition(opts = {}) {
  const title = opts.title || 'Sign in to continue';
  const text =
    opts.text ||
    'To keep going and save this work in your Cutup workspace, please sign in to your account.';
  const sub = opts.sub || 'Taking you to login now…';

  let overlay = document.getElementById('cutupAuthTransition');
  if (overlay) {
    const t = overlay.querySelector('.cutup-auth-transition__title');
    const b = overlay.querySelector('.cutup-auth-transition__text');
    const s = overlay.querySelector('.cutup-auth-transition__sub');
    if (t) t.textContent = title;
    if (b) b.textContent = text;
    if (s) s.textContent = sub;
    return overlay;
  }
  overlay = document.createElement('div');
  overlay.id = 'cutupAuthTransition';
  overlay.className = 'cutup-auth-transition';
  overlay.innerHTML = `
    <div class="cutup-auth-transition__panel" role="status" aria-live="polite">
      <div class="cutup-auth-transition__spinner" aria-hidden="true"></div>
      <p class="cutup-auth-transition__title"></p>
      <p class="cutup-auth-transition__text"></p>
      <p class="cutup-auth-transition__sub"></p>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.cutup-auth-transition__title').textContent = title;
  overlay.querySelector('.cutup-auth-transition__text').textContent = text;
  overlay.querySelector('.cutup-auth-transition__sub').textContent = sub;
  document.body.style.overflow = 'hidden';
  return overlay;
}

function hideAuthTransition() {
  document.getElementById('cutupAuthTransition')?.remove();
  document.body.style.overflow = '';
}

async function cutupTriggerLoginForPendingAction(type, payload) {
  window.CutupApp.pendingAction = { type, payload: payload || {} };
  window.CutupApp.authState = 'redirecting';
  cutupWriteLocalPendingActionForLogin(type, payload);
  try {
    const envelope = { type, payload: payload || {}, v: 1 };
    sessionStorage.setItem(CUTUP_PENDING_ACTION_KEY, JSON.stringify(envelope));
    window.__pendingAction = { type, payload: payload || {} };
  } catch (_e) {
    /* ignore */
  }
  const u = payload && payload.url != null ? payload.url : getCurrentUrl();
  if (u && String(u).trim()) {
    localStorage.setItem('cutup_pending_url', String(u).trim());
    localStorage.setItem(
      'cutup_pending_platform',
      (payload && payload.platform) || currentPlatform || 'youtube'
    );
  }
  const fileFlow = Boolean(payload && payload.fileFlow);
  showAuthTransition({
    title: fileFlow ? 'Sign in to transcribe your upload' : 'Sign in to continue',
    text: fileFlow
      ? 'Like social links: sign in with Google to extract speech, build subtitles, and export your file.'
      : 'To keep going and save this project in your Cutup workspace, please sign in with Google. Your link and settings are saved.',
    sub: 'Redirecting to Google sign-in…'
  });
  await new Promise((r) => setTimeout(r, 700));
  await cutupTriggerGoogleLogin();
}

async function resumeCutupPendingAction() {
  let raw;
  try {
    raw = sessionStorage.getItem(CUTUP_PENDING_ACTION_KEY);
  } catch (_e) {
    return;
  }
  if (!raw) return;

  let action;
  try {
    action = JSON.parse(raw);
  } catch (_e) {
    cutupClearPendingAction();
    return;
  }

  if (!localStorage.getItem('cutup_session')) return;

  cutupClearPendingAction();

  const { type, payload } = action;
  const p = payload || {};

  await new Promise((r) => setTimeout(r, 400));

  try {
    if (type === 'generate_subtitle') {
      await handleSrtSubtitles();
    } else if (type === 'fulltext') {
      await handleFullText(p.activeTab || 'fulltext');
    } else if (type === 'summarize') {
      await handleSummarize();
    } else if (type === 'resume_upload_tab') {
      retentionSwitchPlatformWithUrl('audiofile', '');
      if (!(await cutupResumePendingUploadAfterLogin(p))) {
        showMessage('Select your file again to transcribe.', 'info');
      }
    }
  } catch (err) {
    console.error('[script] resumeCutupPendingAction failed:', err);
    reportClientError('resume_pending', err);
    showMessage(USER_ERROR_GENERIC, 'error');
  }
}

async function resumePendingWorkflow() {
  await resumeCutupPendingAction();
}

const CUTUP_PENDING_PLAN_AFTER_AUTH_KEY = 'cutup_pending_plan_after_auth';
const CUTUP_PAYMENT_RETRY_KEY = 'cutup_payment_retry';

function inferCutupPaymentProvider() {
  if (typeof window !== 'undefined' && window.CUTUP_PAYMENT_PROVIDER) {
    return window.CUTUP_PAYMENT_PROVIDER === 'yekpay' ? 'yekpay' : 'yekpay';
  }
  try {
    const lang = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
    if (lang.startsWith('fa')) return 'yekpay';
  } catch (_e) {
    /* noop */
  }
  return 'yekpay';
}

async function cutupTriggerGoogleLogin() {
  if (cutupSessionIsVerified()) {
    console.log('[script] Already authenticated; skipping Google OAuth redirect');
    resetGoogleButtonState();
    return;
  }
  window.CutupApp.authState = 'redirecting';
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
      const err = new Error(`Server error: ${response.status}`);
      err.httpStatus = response.status;
      throw err;
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
    hideAuthTransition();
    const st = Number(error?.httpStatus || 0);
    if (st === 502 || st === 503 || st === 504) {
      showMessage(
        'Cutup API is temporarily unavailable (server error). Please try again in a minute or contact support if this persists.',
        'error'
      );
    } else {
      showMessage('Google sign-in failed. Please try again.', 'error');
    }
    throw error;
  }
}

const CUTUP_LANDING_PAID_PLANS = ['starter', 'pro', 'business'];

function cutupHandlePlanSelection(planKey, options = {}) {
  if (window.CutupPlanCheckout?.handlePlanSelection) {
    return window.CutupPlanCheckout.handlePlanSelection(planKey, options);
  }
  const plan = String(planKey || '').trim().toLowerCase();
  if (!localStorage.getItem('cutup_session')) {
    if (window.CutupPlanCheckout?.startGoogleOAuthCheckout) {
      return window.CutupPlanCheckout.startGoogleOAuthCheckout(plan, { source: 'pricing', redirectMode: 'plans' });
    }
    return cutupTriggerGoogleLogin();
  }
  window.location.href = `/checkout.html?plan=${encodeURIComponent(plan)}&source=pricing`;
  return Promise.resolve({ ok: true, route: 'checkout' });
}

async function runPricingUpgradeClick(plan, source = 'pricing') {
  const planKey = String(plan || '').trim().toLowerCase();
  if (!planKey || !CUTUP_LANDING_PAID_PLANS.includes(planKey)) return;
  try {
    if (!getCutupSessionId() && typeof showAuthTransition === 'function') {
      showAuthTransition({
        title: 'Signing you in',
        text: 'Redirecting to Google…',
        sub: ''
      });
    }
    await cutupHandlePlanSelection(planKey, { source });
  } catch (err) {
    console.error('[script] plan selection failed', err);
    if (typeof hideAuthTransition === 'function') hideAuthTransition();
    alert('Could not start sign-in. Please try again.');
  }
}

function bindPricingUpgradeCta(btn, planKey) {
  if (!btn || btn.dataset.cutupUpgradeBound === '1') return;
  btn.dataset.cutupUpgradeBound = '1';
  btn.addEventListener('click', (e) => {
    if (btn.classList.contains('disabled-plan-btn')) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    e.stopPropagation();
    void runPricingUpgradeClick(planKey, 'pricing');
  });
}

function setupLandingPricingCheckoutIntercept() {
  const hasPricing =
    document.getElementById('pricing') ||
    document.querySelector('.pricing-compare') ||
    document.querySelector('a.pricing-dashboard-cta');
  if (!hasPricing) return;
  if (document.documentElement.dataset.cutupPricingIntercept === '1') return;
  document.documentElement.dataset.cutupPricingIntercept = '1';
  document.addEventListener(
    'click',
    (e) => {
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
      void runPricingUpgradeClick(plan, 'pricing');
    },
    true
  );
  document.querySelectorAll('a.pricing-dashboard-cta[data-cutup-plan]').forEach((a) => {
    const plan = (a.getAttribute('data-cutup-plan') || '').trim();
    if (plan && CUTUP_LANDING_PAID_PLANS.includes(plan)) {
      bindPricingUpgradeCta(a, plan);
    }
  });
}

function updateCutupSocialAuthHints() {
  const loggedIn = cutupIsLoggedIn();
  document.querySelectorAll('.cutup-inline-auth-hint').forEach((el) => {
    el.hidden = loggedIn;
  });
}

function initStickyLayerAfterResults() {
  cutupStickyGeneratedAt = Date.now();
  cutupStickyLastScrollAt = Date.now();
  setStickyPrimaryMode('download');
}

async function cutupRestoreProjectFromApi(projectId) {
  const sessionId = getCutupSessionId();
  if (!sessionId || !projectId || !cutupSessionIsVerified()) return false;
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/projects?action=restore&id=${encodeURIComponent(projectId)}&session=${encodeURIComponent(sessionId)}`,
      { headers: { 'X-Session-Id': sessionId } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.payload) return false;
    const p = data.payload;
    if (p.sourceUrl) {
      retentionSwitchPlatformWithUrl(p.platform || 'youtube', p.sourceUrl);
    }
    if (typeof displayResults === 'function') {
      displayResults(p.summary, p.fullText, p.segments || [], {
        title: p.title,
        platform: p.platform,
        sourceUrl: p.sourceUrl,
        originalLanguage: p.language,
        activeTab: 'srt',
        outputMode: 'unified',
        cacheReplay: true
      });
    }
    if (p.srt) {
      window.currentSrtContent = p.srt;
      window.originalSrtContent = p.srt;
      syncSrtRawPanel?.();
    }
    window.CutupWorkspaceAutosave?.scheduleSave?.();
    return true;
  } catch (err) {
    console.warn('[script] cutupRestoreProjectFromApi failed:', err?.message || err);
    return false;
  }
}

async function cutupTryRestoreWorkspace() {
  if (cutupLocalResumeStarted) return false;
  const pending = cutupParseLocalPendingAction();
  if (pending.valid) return false;
  const resultSection = document.getElementById('resultSection');
  if (
    resultSection &&
    resultSection.style.display !== 'none' &&
    resultSection.textContent.trim().length > 0
  ) {
    return false;
  }
  if (window.CutupWorkspaceAutosave?.tryRestore?.()) return true;
  const projectId = new URLSearchParams(window.location.search).get('project');
  if (projectId) return cutupRestoreProjectFromApi(projectId);
  return false;
}

function setStickyPrimaryMode(mode) {
  const allowed = ['download', 'tryAnother'];
  if (!allowed.includes(mode)) return;
  cutupStickyPrimaryState = mode;
  const btn = document.getElementById('stickyDownloadBtn');
  if (!btn) return;
  const labels = {
    download: 'Download',
    tryAnother: 'Try another video',
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
  } else {
    setStickyPrimaryMode('tryAnother');
  }
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

function getVisibleTranslationLanguageOptions() {
  if (window.CutupRtlLanguages?.filterTranslationOptions) {
    return window.CutupRtlLanguages.filterTranslationOptions(TRANSLATION_LANGUAGE_OPTIONS);
  }
  return TRANSLATION_LANGUAGE_OPTIONS;
}

function buildLanguageOptionsMarkup() {
  const originalLabel = getTranslationOriginalLabel();
  const dynamicOptions = getVisibleTranslationLanguageOptions().map((lang) => (
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
    const hasPreviousValue = previousValue && (previousValue === 'original' || getVisibleTranslationLanguageOptions().some((lang) => lang.code === previousValue));
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
      const ytId = parseYouTubeVideoIdCanonical(url.trim());
      if (ytId) return `url:https://www.youtube.com/watch?v=${ytId}`;
      return `url:${stripTrackingQueryParamsClient(url.trim())}`;
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

function replayCachedResultIfMatch(activeTab = 'fulltext', outputMode = 'fulltext') {
  const key = getTranscriptionCacheKey();
  const cached = window.cutupLastTranscription;
  if (!cached || !key || cached.cacheKey !== key) return false;
  const hasText = typeof cached.fullText === 'string' && cached.fullText.trim().length > 0;
  const hasSeg = Array.isArray(cached.segments) && cached.segments.length > 0;
  if (!hasText && !hasSeg) return false;
  displayResults(cached.summary, cached.fullText, cached.segments || [], {
    ...cached.lastDisplayOptions,
    outputMode,
    activeTab,
    cacheReplay: true
  });
  return true;
}

function patchSummaryInResults(summary) {
  const cached = window.cutupLastTranscription;
  if (!cached) return;
  cached.summary = summary;
  const resultSection = document.getElementById('resultSection');
  const activeTab =
    resultSection?.querySelector('.tab-btn.active')?.dataset?.tab ||
    cached.lastDisplayOptions?.activeTab ||
    'srt';
  displayResults(summary, cached.fullText, cached.segments || [], {
    ...(cached.lastDisplayOptions || {}),
    outputMode: 'unified',
    activeTab,
    cacheReplay: true
  });
}

function applyResultOutputMode(resultSection, outputMode) {
  if (!resultSection) return;
  const fulltextBtn = resultSection.querySelector('.tab-btn[data-tab="fulltext"]');
  const summaryBtn = resultSection.querySelector('.tab-btn[data-tab="summary"]');
  const srtBtn = resultSection.querySelector('.tab-btn[data-tab="srt"]');
  const fulltextContent = document.getElementById('fulltext-tab');
  const summaryContent = document.getElementById('summary-tab');
  const srtContent = document.getElementById('srt-tab');

  if (outputMode === 'unified') {
    [fulltextBtn, summaryBtn, srtBtn].forEach((btn) => {
      if (btn) {
        btn.hidden = false;
        btn.style.removeProperty('display');
      }
    });
    [fulltextContent, summaryContent, srtContent].forEach((el) => {
      if (el) el.style.display = '';
    });
    resultSection.dataset.outputMode = 'unified';
    return;
  }

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
  window.__cutupAuthCallbackHandled = true;
  setCutupSession(sessionId, 'oauth_callback');
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({
        type: 'auth_success',
        session: sessionId
      });
    }
  } catch (e) {
    console.log('Could not notify extension:', e);
  }

  const pendingLsSnapshot = cutupParseLocalPendingAction();
  const pendingUrl = localStorage.getItem('cutup_pending_url');
  const pendingPlatform = localStorage.getItem('cutup_pending_platform');
  const hasResumeIntent =
    pendingLsSnapshot.valid ||
    !!(pendingUrl && String(pendingUrl).trim()) ||
    !!sessionStorage.getItem(CUTUP_PENDING_ACTION_KEY);

  console.log('[oauth-return]', { auth: 'success', hasResumeIntent, surface: 'homepage_fallback' });
  showAuthTransition({
    title: 'Signing you in',
    text: hasResumeIntent ? 'Restoring your project…' : 'Opening your dashboard…',
    sub: ''
  });
  const checkoutAfterAuth = window.CutupPlanCheckout?.resolvePostLoginRedirect?.();
  if (checkoutAfterAuth && !hasResumeIntent) {
    console.log('[checkout-after-oauth]', { url: checkoutAfterAuth });
    window.location.replace(checkoutAfterAuth);
  } else if (!hasResumeIntent) {
    let postAuthUrl = null;
    try {
      postAuthUrl = sessionStorage.getItem('cutup_post_auth_url');
      if (postAuthUrl) sessionStorage.removeItem('cutup_post_auth_url');
    } catch (_e) { /* noop */ }
    if (postAuthUrl) {
      const raw = String(postAuthUrl);
      const hashIdx = raw.indexOf('#');
      const pathPart = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
      const hashPart = hashIdx >= 0 ? raw.slice(hashIdx) : '';
      const join = pathPart.includes('?') ? '&' : '?';
      window.location.replace(
        `${window.location.origin}${pathPart}${join}session=${encodeURIComponent(sessionId)}${hashPart}`,
      );
    } else {
      window.location.replace(`${window.location.origin}/dashboard.html?session=${encodeURIComponent(sessionId)}`);
    }
  } else {
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}?resume=1`
    );

    loadUserProfile().then(async () => {
      if (pendingLsSnapshot.valid) {
        await cutupExecuteLocalPendingResume(pendingLsSnapshot.data);
      } else if (pendingUrl && pendingPlatform) {
        console.log('[script] Restoring pending URL:', pendingUrl, 'Platform:', pendingPlatform);
        await restorePendingUrl(pendingUrl, pendingPlatform);
      }
      await resumeCutupPendingAction();
      await cutupTryRestoreWorkspace();
    });

    setTimeout(() => {
      const downloadSection = document.querySelector('.download-section');
      if (downloadSection) {
        downloadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 500);
  }
} else if (authError === 'admin_account') {
  if (window.CutupRoleGuard?.handleUrlAdminLoginError) {
    window.CutupRoleGuard.handleUrlAdminLoginError();
  } else {
    showMessage(
      'This email belongs to a Cutup administrator. Please use the Operations Console or a separate customer account.',
      'error'
    );
  }
} else if (authError === 'account_deleted_cooldown' || authError === 'account_blocked') {
  console.log('[login-blocked]', { surface: 'homepage', error: authError });
  window.location.replace('/login.html?error=account_blocked');
} else if (authError) {
  console.error('Auth error:', authError);
  showMessage('Sign-in failed. Please try again.', 'error');
}

// Load user profile on page load
window.addEventListener('DOMContentLoaded', () => {
  console.log('[script] DOMContentLoaded event fired');
  const savedSession = localStorage.getItem('cutup_session');
  console.log('[script] Saved session from localStorage:', savedSession);
  window.CutupApp.authState = savedSession ? 'authenticated' : 'anonymous';
  cutupMarkSessionVerified(false, 'dom_load_pending');

  const loginBtn = document.getElementById('loginBtn');
  const googleWrap = document.querySelector('.google-btn-wrapper');
  if (!savedSession) {
    if (loginBtn) loginBtn.style.display = '';
    if (googleWrap) googleWrap.style.display = '';
    const signinFlag = new URLSearchParams(window.location.search).get('signin');
    if (signinFlag === '1' && !window.__cutupAuthCallbackHandled) {
      setTimeout(() => {
        if (!cutupSessionIsVerified()) {
          cutupTriggerGoogleLogin().catch(() => {});
        }
      }, 450);
    }
  }

  if (savedSession) {
    currentSession = savedSession;
    if (!window.__cutupAuthCallbackHandled) {
      const rpCheckout = new URLSearchParams(window.location.search);
      if (window.CutupPlanCheckout) {
        if (rpCheckout.get('redirect') === 'checkout') {
          const pk = window.CutupPlanCheckout.normalizePlanKey(rpCheckout.get('plan'));
          if (pk) {
            const target = window.CutupPlanCheckout.buildCheckoutUrl(pk, { source: 'checkout' });
            console.log('[post-login-redirect]', { target, reason: 'homepage_query_checkout' });
            window.location.replace(target);
            return;
          }
        }
        if (rpCheckout.get('redirect') === 'plans') {
          const pk = window.CutupPlanCheckout.normalizePlanKey(rpCheckout.get('plan'));
          const target = window.CutupPlanCheckout.buildDashboardPlansUrl(pk);
          console.log('[post-login-redirect]', { target, reason: 'homepage_query_plans' });
          window.location.replace(target);
          return;
        }
      }
      setTimeout(() => {
        loadUserProfile().then(async () => {
          const rp = new URLSearchParams(window.location.search);
          if (rp.get('resume') === '1') {
            const pr = cutupParseLocalPendingAction();
            if (pr.valid) {
              await cutupExecuteLocalPendingResume(pr.data);
            }
          }
          const pu = localStorage.getItem('cutup_pending_url');
          const pp = localStorage.getItem('cutup_pending_platform');
          if (pu && pp) {
            console.log('[script] Restoring pending URL:', pu, 'Platform:', pp);
            await restorePendingUrl(pu, pp);
          }
          await resumeCutupPendingAction();
          await cutupTryRestoreWorkspace();
        });
      }, 100);
    }
  } else {
    console.log('[script] No saved session, showing login button');
    showLoginButton();
  }

  applyCutupPricingPlanLocks(window.userSubscription || { plan: 'free' });
  updateCutupSocialAuthHints();
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
  const sessionId = getCutupSessionId();
  console.log('[script] loadUserProfile called, sessionId:', sessionId);
  
  if (!sessionId) {
    console.log('[script] No session found, showing login button');
    showLoginButton();
    return;
  }

  try {
    window.CutupApp.subscriptionHydration = 'pending';
    console.log('[script] Fetching user profile from API...');
    const response = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${sessionId}`);
    console.log('[script] Response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('[script] User data received:', data);
      
      if (data.user) {
        if (window.CutupRoleGuard?.handleAuthMePayload?.(data)) {
          showLoginButton();
          window.CutupRoleGuard.showAdminLoginBlockedModal?.();
          return;
        }
        console.log('[script] User found, showing profile');
        setCutupSession(sessionId, 'loadUserProfile_ok');
        cutupMarkSessionVerified(true, 'loadUserProfile_ok');
        showUserProfile(data.user);
        // Load subscription info and update UI
        await updateButtonsBasedOnSubscription(sessionId);
        await retentionMergeGuestIfNeeded(sessionId);
        await monetizationRefreshPaywallPassive();
      } else {
        console.warn('[script] No user in response');
        if (getCutupSessionId()) {
          window.CutupApp.subscriptionHydration = 'error';
        } else {
          showLoginButton();
        }
      }
    } else {
      // Session expired or invalid - but don't remove it immediately
      const errorText = await response.text().catch(() => '');
      console.error('[script] Failed to load user profile:', response.status, errorText);
      
      if (response.status === 401 || response.status === 403) {
        console.log('[script] Session expired, clearing session');
        clearCutupSession('auth_me_' + response.status);
        showLoginButton();
      } else if (response.status === 502 || response.status === 503 || response.status === 504) {
        cutupMarkSessionVerified(false, 'auth_me_' + response.status);
        window.CutupApp.subscriptionHydration = 'error';
        showLoginButton();
        showMessage(
          'Could not reach Cutup servers (temporary error). Click Sign in again when the site is back, or retry in a minute.',
          'error'
        );
      } else if (!getCutupSessionId()) {
        showLoginButton();
      } else {
        cutupMarkSessionVerified(false, 'auth_me_' + response.status);
        window.CutupApp.subscriptionHydration = 'error';
        showLoginButton();
      }
    }
  } catch (error) {
    console.error('[script] Error loading user profile:', error);
    cutupMarkSessionVerified(false, 'auth_me_network');
    if (getCutupSessionId()) {
      window.CutupApp.subscriptionHydration = 'error';
      showLoginButton();
      showMessage(
        'Connection to Cutup failed. Check your network, or try Sign in again in a moment.',
        'error'
      );
    } else {
      showLoginButton();
    }
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
  business: 3,
};

function normalizePlanKey(key) {
  if (!key) return 'free';
  key = String(key).toLowerCase();
  if (key === 'advanced') return 'business';
  return key;
}

function cutupGetPermissions(sub) {
  const s = sub || window.userSubscription || {};
  if (s.permissions && typeof s.permissions === 'object') return s.permissions;
  const plan = normalizePlanKey(s.plan || 'free');
  if (window.CutupPlanPermissions?.getPermissions) {
    return window.CutupPlanPermissions.getPermissions(plan);
  }
  return {};
}

function cutupRequirePermission(permission, options = {}) {
  const perms = cutupGetPermissions();
  if (perms[permission]) return true;
  const msg = window.CutupPlanPermissions?.getUpgradeMessage
    ? window.CutupPlanPermissions.getUpgradeMessage(permission)
    : (options.message || 'This feature is not available on your current plan.');
  showMessage(options.message || msg, options.variant || 'error');
  return false;
}

function cutupIsTopTierPlan(key) {
  return normalizePlanKey(key) === 'business';
}

/** API `usage.monthly.minutes` = completed generations this calendar month (not wall-clock minutes). */
function cutupGenerationCountFromUsage(usage) {
  const raw = usage?.monthly?.minutes;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function cutupMonthlyGenerationLimitFromSubscription(sub) {
  const fromUsage = sub?.usage?.monthlyLimit;
  if (fromUsage != null && Number(fromUsage) > 0) return Number(fromUsage);
  const fromRoot = sub?.monthlyGenerationLimit;
  if (fromRoot != null && Number(fromRoot) > 0) return Number(fromRoot);
  const plan = normalizePlanKey(sub?.plan);
  if (typeof window !== 'undefined' && window.CutupPlanDisplay?.monthlyVideosForPlan) {
    return window.CutupPlanDisplay.monthlyVideosForPlan(plan);
  }
  return 3;
}

/**
 * Client-side processing cap for disabling Run buttons.
 * Business/Advanced: never pre-block in UI (dashboard shows "Included"; server still enforces on run).
 */
function cutupProcessingQuotaExceeded(sub) {
  if (!sub) return false;
  const plan = normalizePlanKey(sub.plan);
  if (cutupIsTopTierPlan(plan)) return false;
  const limit = cutupMonthlyGenerationLimitFromSubscription(sub);
  if (!limit || limit <= 0) return false;
  return cutupGenerationCountFromUsage(sub.usage) >= limit;
}

/** Wall-clock estimate for remote audio/media extraction (progress only — not quota). */
function estimateMediaExtractionDurationSeconds(platform, durationSeconds = 0) {
  const dur = Math.max(0, Number(durationSeconds) || 0);
  const base = platform === 'youtube' ? 90 : 75;
  const scaled = dur > 0 ? Math.ceil(dur * 0.12) + 45 : 0;
  return Math.min(360, Math.max(base, scaled));
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
      if (btn.tagName === 'A') {
        if (getCutupSessionId() && window.CutupPlanCheckout?.buildCheckoutUrl) {
          btn.setAttribute('href', window.CutupPlanCheckout.buildCheckoutUrl(planKey, { source: 'pricing' }));
        } else {
          btn.setAttribute('href', 'javascript:void(0)');
        }
      }
      if (btn.classList.contains('pricing-dashboard-cta')) {
        bindPricingUpgradeCta(btn, planKey);
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
      if (getCutupSessionId()) {
        window.CutupApp.subscriptionHydration = 'error';
        console.warn(
          '[subscription] info fetch failed; not applying free-tier UI while session exists',
          subResponse.status
        );
        setButtonsForPaidPlan(false, false, false, null);
        return;
      }
      setButtonsForFreePlan();
      applyCutupPricingPlanLocks({ plan: 'free' });
      window.CutupApp.subscriptionHydration = 'ready';
      return;
    }
    
    const subData = await subResponse.json();
    const userPlan = normalizePlanKey(subData.plan || 'free');
    const features = subData.features || {};
    
    // Use API usage data (not localStorage) for button state
    const apiUsage = subData.usage || {};
    const apiDownloads = apiUsage.downloads || {};
    const apiAudio = apiDownloads.audio || {};
    const apiVideo = apiDownloads.video || {};
    
    const monthlyLimit =
      apiUsage.monthlyLimit != null
        ? apiUsage.monthlyLimit
        : (typeof window !== 'undefined' && window.CutupPlanDisplay?.monthlyVideosForPlan
            ? window.CutupPlanDisplay.monthlyVideosForPlan(userPlan)
            : 3);
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
    const monthlyCapExceeded = cutupProcessingQuotaExceeded({
      plan: userPlan,
      monthlyGenerationLimit: subData.monthlyGenerationLimit,
      usage: {
        ...apiUsage,
        monthlyLimit,
        monthly: { minutes: minutesUsed, limit: monthlyLimit }
      }
    });
    
    // Store subscription info globally
    const credits = subData.credits || {
      used: minutesUsed,
      limit: monthlyLimit,
      remaining: Math.max(0, monthlyLimit - minutesUsed)
    };
    window.userSubscription = {
      plan: userPlan,
      features: features,
      permissions: subData.permissions || cutupGetPermissions({ plan: userPlan }),
      credits,
      monthlyGenerationLimit: subData.monthlyGenerationLimit ?? monthlyLimit,
      planTagline: subData.planTagline || null,
      usage: {
        ...subData.usage,
        monthlyLimit,
        downloads: {
          audio: { count: audioCount, limit: audioLimit },
          video: { count: videoCount, limit: videoLimit }
        },
        monthly: { minutes: minutesUsed, limit: monthlyLimit }
      },
      subscription: subData.subscription || null
    };
    
    const audioExceeded = audioLimit !== null && audioCount >= audioLimit;
    const videoExceeded = videoLimit !== null && videoCount >= videoLimit;
    
    console.log('[script] Button state update:', {
      userPlan,
      monthlyCapExceeded,
      generationsUsed: minutesUsed,
      monthlyGenerationLimit: window.userSubscription.monthlyGenerationLimit,
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
    window.CutupPresetSelector?.applyPlanLocks?.();
    window.CutupApp.subscriptionHydration = 'ready';
  } catch (error) {
    console.error('Error loading subscription info:', error);
    if (getCutupSessionId()) {
      window.CutupApp.subscriptionHydration = 'error';
      console.warn('[subscription] exception during info fetch; not applying free-tier UI while session exists');
      setButtonsForPaidPlan(false, false, false, null);
      return;
    }
    setButtonsForFreePlan();
    applyCutupPricingPlanLocks({ plan: 'free' });
    window.CutupApp.subscriptionHydration = 'ready';
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
      ? 'You’ve reached today’s usage meter on the Free plan. Try again tomorrow—or upgrade for more headroom.'
      : 'You’ve used your included videos for this month. See your dashboard for your reset date—or upgrade when you need more volume.';

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
    'You’ve used your included videos for this month. Open your dashboard to see your reset timing—or pick a higher plan.';

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
  if (lb) {
    lb.style.display = '';
    lb.disabled = false;
    const label = lb.querySelector('.google-btn-label');
    if (label) {
      label.textContent = getCutupSessionId() && !cutupSessionIsVerified() ? 'Sign in again' : 'Sign in with Google';
    }
  }
  if (googleWrap) googleWrap.style.display = '';
  const up = document.getElementById('userProfile');
  if (up) up.style.display = 'none';
  resetGoogleButtonState();
  if (!getCutupSessionId()) {
    try {
      if (window.userSubscription) window.userSubscription.plan = 'free';
    } catch (_e) {
      /* noop */
    }
    applyCutupPricingPlanLocks({ plan: 'free' });
    try {
      window.CutupApp.subscriptionHydration = 'idle';
    } catch (_e2) {
      /* noop */
    }
  }
  updateCutupSocialAuthHints();
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
      clearCutupSession('logout');
      userProfile.classList.remove('active');
      showLoginButton();
      updateCutupSocialAuthHints();
    });
  }
  
  console.log('[script] User profile displayed successfully');
  updateCutupSocialAuthHints();
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
  try {
    const ls = localStorage.getItem('cutup_session');
    if (ls && String(ls).trim() && String(ls).trim() !== String(currentSession || '').trim()) {
      currentSession = String(ls).trim();
      window.CutupApp.authState = 'authenticated';
    }
  } catch (_e) {
    /* ignore */
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetGoogleButtonState();
});

// Logout button is now handled in showUserProfile function

// Download functionality - wait for DOM to be ready
let youtubeUrlInput, audioFileInput, downloadVideoBtnMain, downloadAudioBtnMain;
let downloadSubtitleBtnMain, summarizeBtnMain, fullTextBtnMain, downloadMessage;

document.addEventListener('DOMContentLoaded', async () => {
  if (window.CutupRtlLanguages?.ensureReady) {
    await window.CutupRtlLanguages.ensureReady();
  }
  populateLanguageSelects();
  window.CutupRtlLanguages?.applyMarketingVisibility?.();
  window.CutupRtlLanguages?.stripRtlOptionsFromDocument?.();
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

    if (cutupSessionIsVerified()) {
      console.log('[script] Login click ignored — session verified');
      return;
    }

    if (getCutupSessionId() && !cutupSessionIsVerified()) {
      console.log('[script] Re-auth: stored session could not be verified (API may be down)');
    }

    console.log('[script] Login button clicked, fetching auth URL from /api/oauth/google/start...');
    try {
      await cutupTriggerGoogleLogin();
    } catch (_err) {
      /* cutupTriggerGoogleLogin already surfaced error */
    }
  });

  if (
    document.getElementById('cutupPricingMatrixMount') &&
    !document.querySelector('#cutupPricingMatrixMount .pricing-compare') &&
    window.CutupPricingMatrix
  ) {
    window.CutupPricingMatrix.mount('#cutupPricingMatrixMount', { context: 'landing' });
  }
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

  initUploadFileTab();
});

// Check if YouTube URL is valid — after normalization (Shorts, live, youtu.be, watch?v=)
function isYouTubeUrl(url) {
  if (!url || !url.trim()) return false;
  return !!parseYouTubeVideoIdCanonical(url);
}

// Check if TikTok URL is valid (accepts any subdomain including short links)
function isTikTokUrl(url) {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    const h = u.hostname.toLowerCase();
    if (!h.includes('tiktok.com')) return false;
    return /^\/@[^/]+\/video\/\d+/i.test(u.pathname) || /^\/t\/[A-Za-z0-9]+/i.test(u.pathname);
  } catch (_e) {
    return false;
  }
}

// Check if Instagram URL is valid (reel/reels/p/tv only — not stories)
function isInstagramUrl(url) {
  if (!url || !url.trim()) return false;
  if (isInstagramStoryUrl(url)) return false;
  return !!normalizeInstagramUrlCanonical(url);
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
function showMessage(text, type = 'info', opts = {}) {
  if (!downloadMessage) return;
  if (type === 'error') {
    console.warn('[ui-error-trigger]', {
      text,
      isGeneric: text === USER_ERROR_GENERIC,
      stack: new Error('[ui-error-trigger]').stack
    });
  }
  downloadMessage.textContent = text;
  downloadMessage.className = `download-message ${type}`;
  downloadMessage.style.display = 'block';
  clearTimeout(downloadMessage._hideT);
  const ms =
    Number(opts.persistMs) > 0
      ? Number(opts.persistMs)
      : type === 'error'
        ? 10000
        : type === 'info'
          ? 8000
          : 5500;
  if (ms > 0) {
    downloadMessage._hideT = setTimeout(() => {
      downloadMessage.style.display = 'none';
    }, ms);
  }
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

// Check if user is logged in — redirect to login page when anonymous.
function checkLogin(options = {}) {
  const sessionId = getCutupSessionId();
  if (!sessionId) {
    const url = getCurrentUrl();
    const platform = currentPlatform || 'youtube';

    if (url && url.trim()) {
      localStorage.setItem('cutup_pending_url', url);
      localStorage.setItem('cutup_pending_platform', platform);
      console.log('[script] Saved pending URL:', url, 'Platform:', platform);
    }

    void cutupTriggerLoginForPendingAction(options.pendingType || 'summarize', {
      url,
      platform,
      ...(options.payload || {})
    });
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

function updateMainPasteRunState(platform, inputEl, btnEl) {
  if (!inputEl || !btnEl) return;
  const v = (inputEl.value || '').trim();
  if (!v) {
    btnEl.textContent = '📋 Paste';
    btnEl.dataset.state = 'paste';
    return;
  }
  const detected = detectPlatform(v);
  if (!detected) {
    btnEl.textContent = 'Paste';
    btnEl.dataset.state = 'invalid';
    return;
  }
  if (detected !== platform) {
    switchPlatform(detected, { carriedUrl: v });
    const nextInput = document.getElementById(detected === 'youtube' ? 'youtubeUrlInput' : `${detected}UrlInput`);
    const nextBtnId =
      detected === 'youtube' ? 'pasteBtnMain' :
      detected === 'instagram' ? 'pasteInstagramBtn' :
      detected === 'tiktok' ? 'pasteTiktokBtn' : '';
    const nextBtn = nextBtnId ? document.getElementById(nextBtnId) : null;
    if (nextInput && nextBtn) updateMainPasteRunState(detected, nextInput, nextBtn);
    return;
  }
  btnEl.textContent = 'Run';
  btnEl.dataset.state = 'run';
}

function initHomepageToolController() {
  window.CutupHomepageTool = window.CutupHomepageTool || { initialized: false };
  if (window.CutupHomepageTool.initialized) return;
  window.CutupHomepageTool.initialized = true;
  ensureSingleHomepageTool();

  const bindings = [
    { platform: 'youtube', inputId: 'youtubeUrlInput', btnId: 'pasteBtnMain' },
    { platform: 'instagram', inputId: 'instagramUrlInput', btnId: 'pasteInstagramBtn' },
    { platform: 'tiktok', inputId: 'tiktokUrlInput', btnId: 'pasteTiktokBtn' }
  ];

  bindings.forEach(({ platform, inputId, btnId }) => {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;

    const refresh = () => updateMainPasteRunState(platform, input, btn);
    input.addEventListener('input', refresh);
    input.addEventListener('paste', () => setTimeout(refresh, 0));
    input.addEventListener('keyup', refresh);
    input.addEventListener('change', refresh);

    btn.addEventListener('click', async () => {
      if (btn.dataset.state === 'run') {
        await handleSubtitleWorkflow({ platform, url: input.value, mode: 'subtitle' });
        return;
      }
      await handlePaste(input);
      refresh();
    });
    refresh();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initHomepageToolController();
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
  
  // Setup platform tabs (main tool only)
  document.querySelectorAll('#tool .platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const platform = tab.dataset.tab;
      if (platform) {
        switchPlatform(platform);
      }
    });
  });

  wireHeroQuickStart();
});

function initHeroPreviewTabs() {
  ensureSingleHomepageTool();
  const tabs = Array.from(document.querySelectorAll('.hero-platform-tab'));
  const title = document.getElementById('heroPreviewToolTitle');
  const input = document.getElementById('heroPreviewInput');
  const pasteBtn = document.getElementById('heroPreviewPasteBtn');
  if (!tabs.length || !title || !input || !pasteBtn) return;
  let hint = document.getElementById('heroPreviewInlineHint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'heroPreviewInlineHint';
    hint.className = 'hero-preview-inline-hint';
    input.closest('.hero-preview-input-group')?.insertAdjacentElement('afterend', hint);
  }
  let currentHeroPlatform = 'youtube';

  const copy = {
    youtube: {
      title: 'Paste a YouTube link',
      placeholder: 'https://youtube.com/watch?v=...',
      cta: '📋 Paste'
    },
    instagram: {
      title: 'Paste an Instagram link',
      placeholder: 'https://www.instagram.com/p/...',
      cta: '📋 Paste'
    },
    tiktok: {
      title: 'Paste a TikTok link',
      placeholder: 'https://www.tiktok.com/@...',
      cta: '📋 Paste'
    },
    audiofile: {
      title: 'Upload an audio or video file',
      placeholder: 'Choose file from your device...',
      cta: '📁 Choose file'
    }
  };

  function setHint(text, tone = 'info') {
    hint.textContent = text || '';
    hint.dataset.tone = tone;
    hint.hidden = !text;
  }

  function apply(platform) {
    currentHeroPlatform = platform;
    const payload = copy[platform] || copy.youtube;
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.heroPlatform === platform));
    title.textContent = payload.title;
    input.placeholder = payload.placeholder;
    input.disabled = platform === 'audiofile';
    input.value = '';
    pasteBtn.textContent = payload.cta;
  }

  function updateActivePlatform(platform, keepValue = true) {
    const saved = input.value;
    apply(platform || 'youtube');
    if (keepValue) input.value = saved;
    updateCTAState();
  }

  function updateCTAState() {
    if (currentHeroPlatform === 'audiofile') {
      pasteBtn.textContent = '📁 Choose file';
      pasteBtn.classList.add('is-ready');
      pasteBtn.removeAttribute('aria-disabled');
      setHint('');
      return;
    }
    const v = (input.value || '').trim();
    if (!v) {
      pasteBtn.textContent = '📋 Paste';
      pasteBtn.classList.remove('is-ready');
      pasteBtn.setAttribute('aria-disabled', 'true');
      setHint('');
      return;
    }
    const detected = detectPlatform(v);
    if (!detected) {
      pasteBtn.textContent = 'Run';
      pasteBtn.classList.remove('is-ready');
      pasteBtn.setAttribute('aria-disabled', 'true');
      setHint('Invalid link. Use YouTube, Instagram, or TikTok URL.', 'error');
      return;
    }
    if (detected !== currentHeroPlatform) {
      updateActivePlatform(detected, true);
      return;
    }
    pasteBtn.textContent = 'Run';
    pasteBtn.classList.add('is-ready');
    pasteBtn.removeAttribute('aria-disabled');
    setHint('');
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      updateActivePlatform(tab.dataset.heroPlatform || 'youtube', false);
    });
  });

  pasteBtn.addEventListener('click', async () => {
    if (currentHeroPlatform === 'audiofile') {
      document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      switchPlatform('audiofile');
      const audioInput = document.getElementById('audioFileInput');
      if (audioInput) audioInput.click();
      return;
    }
    if ((input.value || '').trim() === '') {
      try {
        if (navigator.clipboard?.readText) {
          const v = await navigator.clipboard.readText();
          if (v) input.value = v.trim();
        }
      } catch (_e) {
        // ignore clipboard restrictions
      }
      updateCTAState();
      if ((input.value || '').trim() === '') {
        showMessage('Paste a link first.', 'info');
      }
      return;
    }

    const url = (input.value || '').trim();
    const detected = detectPlatform(url);
    if (!detected) {
      updateCTAState();
      return;
    }
    if (detected !== currentHeroPlatform) updateActivePlatform(detected, true);

    await handleSubtitleWorkflow({
      platform: detected,
      url,
      mode: 'subtitle'
    });
  });

  input.addEventListener('input', updateCTAState);
  input.addEventListener('paste', () => setTimeout(updateCTAState, 0));
  input.addEventListener('keyup', updateCTAState);

  apply('youtube');
  updateCTAState();
}

async function handleSubtitleWorkflow({ platform, url, mode = 'subtitle' }) {
  const p = platform || 'youtube';
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) {
    showMessage('Paste a valid URL to continue.', 'info');
    return;
  }

  if (!cutupIsLoggedIn()) {
    await cutupTriggerLoginForPendingAction('generate_subtitle', {
      platform: p,
      url: cleanUrl,
      mode
    });
    return;
  }

  switchPlatform(p);
  const inputId = p === 'youtube' ? 'youtubeUrlInput' : `${p}UrlInput`;
  const input = document.getElementById(inputId);
  if (input) input.value = cleanUrl;
  checkInput();
  document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (mode === 'summary') {
    await handleSummarize();
    return;
  }
  if (mode === 'fulltext') {
    await handleFullText('fulltext');
    return;
  }
  await handleSrtSubtitles();
}

function wireHeroQuickStart() {
  const heroInput = document.getElementById('heroUrlInput');
  const heroBtn = document.getElementById('heroGenerateBtn');
  if (!heroBtn || !heroInput) return;

  heroBtn.addEventListener('click', () => {
    const v = (heroInput.value || '').trim();
    if (!v) {
      heroInput.focus();
      showMessage('Paste a video link to continue.', 'info');
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
  if (!beginPipelineRun()) return;
  const sessionId = getCutupSessionId();
  
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  const requestedPlatform = resolveRequestedPlatform(url, file);
  
  if (!url && !file) {
    endPipelineRun();
    if (currentPlatform === 'audiofile') {
      showMessage('Please select an audio/video file.', 'error');
    } else {
      showMessage('Please paste a valid link first.', 'error');
    }
      return;
    }

  const isFileFlow =
    !!file &&
    (currentPlatform === 'audiofile' ||
      !url ||
      (typeof url === 'string' && url.startsWith('📁')));
  if (isFileFlow && !(await cutupGateUploadAuth(file, { mode: 'summary', activeTab: 'summary' }))) {
    endPipelineRun();
    return;
  }

  if (cutupSocialTranscribeNeedsGoogleAuth(url, file, requestedPlatform)) {
    endPipelineRun();
    try {
      await cutupTriggerLoginForPendingAction('summarize', {
        url: getCurrentUrl(),
        platform: requestedPlatform,
        activeTab: 'summary',
      });
    } catch (_e) {
      cutupClearPendingAction();
    }
    return;
  }

  const estMin = file ? Math.max(1, Math.ceil((file.size / 1024 / 1024) * 1.2)) : AVG_VIDEO_MINUTES;
  const monGate = await monetizationPreflightBeforeProcess(sessionId, estMin);
  if (!monGate.allowed) {
    endPipelineRun();
    showMessage(monGate.reason || LIMIT_UPGRADE_FALLBACK, 'error');
    return;
  }

  const runSummarize = async () => {
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
  };
  cutupLastPipelineRetry = () => {
    if (!beginPipelineRun()) return;
    runSummarize().finally(() => endPipelineRun());
  };
  try {
    await runSummarize();
  } finally {
    endPipelineRun();
  }
}

async function handleFullText(activeTab = 'fulltext') {
  if (!beginPipelineRun()) return;
  const sessionId = getCutupSessionId();
    
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  const requestedPlatform = resolveRequestedPlatform(url, file);

  const isFileFlowFtEarly =
    !!file &&
    (currentPlatform === 'audiofile' ||
      !url ||
      (typeof url === 'string' && url.startsWith('📁')));
  if (isFileFlowFtEarly && replayCachedResultIfMatch(activeTab, 'unified')) {
    endPipelineRun();
    return;
  }
    
  if (!url && !file) {
    endPipelineRun();
    if (currentPlatform === 'audiofile') {
      showMessage('Please select an audio/video file.', 'error');
    } else {
      showMessage('Please paste a valid link first.', 'error');
    }
      return;
    }

  const isFileFlowFt =
    !!file &&
    (currentPlatform === 'audiofile' ||
      !url ||
      (typeof url === 'string' && url.startsWith('📁')));
  if (
    isFileFlowFt &&
    !(await cutupGateUploadAuth(file, {
      mode: activeTab === 'srt' ? 'subtitle' : 'fulltext',
      activeTab
    }))
  ) {
    endPipelineRun();
    return;
  }

  if (cutupSocialTranscribeNeedsGoogleAuth(url, file, requestedPlatform)) {
    endPipelineRun();
    const pendingType = activeTab === 'srt' ? 'generate_subtitle' : 'fulltext';
    try {
      await cutupTriggerLoginForPendingAction(pendingType, {
        url: getCurrentUrl(),
        platform: requestedPlatform,
        activeTab,
      });
    } catch (_e) {
      cutupClearPendingAction();
    }
    return;
  }

  const estMin = file ? Math.max(1, Math.ceil((file.size / 1024 / 1024) * 1.2)) : AVG_VIDEO_MINUTES;
  const monGate = await monetizationPreflightBeforeProcess(sessionId, estMin);
  if (!monGate.allowed) {
    endPipelineRun();
    showMessage(monGate.reason || LIMIT_UPGRADE_FALLBACK, 'error');
    return;
  }

  const runFullText = async () => {
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
  };
  cutupLastPipelineRetry = () => {
    if (!beginPipelineRun()) return;
    runFullText().finally(() => endPipelineRun());
  };
  try {
    await runFullText();
  } finally {
    endPipelineRun();
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
        outputMode: 'unified',
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
      outputMode: 'unified',
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
  const requestId = makeRequestId();
  const traceId = makeTraceId();
  let finalUrl = String(url || '').trim();
  if (platform === 'instagram') {
    if (isInstagramStoryUrl(finalUrl)) {
      const e = new Error(mapErrorCodeToUserMessage('INSTAGRAM_STORY_UNSUPPORTED'));
      e.errorCode = 'INSTAGRAM_STORY_UNSUPPORTED';
      e.pipelineCode = 'UNSUPPORTED_INSTAGRAM_URL';
      e.retryable = false;
      throw e;
    }
    const norm = normalizeInstagramUrlCanonical(finalUrl);
    if (!norm) {
      const e = new Error(mapErrorCodeToUserMessage('INVALID_URL'));
      e.errorCode = 'INVALID_URL';
      e.retryable = false;
      throw e;
    }
    finalUrl = norm;
  } else {
    finalUrl = stripTrackingQueryParamsClient(finalUrl);
  }
  console.log('[link-parse]', { url: finalUrl.slice(0, 120), platform });
  console.log('[platform-detected]', { platform });
  console.log('[download-start]', { traceId, platform });
  console.log('[transcript-trace]', traceId, { stage: 'social-extract', platform });
  if (!sessionId) {
    const e = new Error('Sign in required for Instagram/TikTok transcription.');
    e.errorCode = 'SESSION_EXPIRED';
    e.retryable = false;
    throw e;
  }
  if (platform !== 'instagram' && platform !== 'tiktok') {
    const e = new Error('Unsupported platform for social extraction');
    e.errorCode = 'INVALID_URL';
    e.retryable = false;
    throw e;
  }

  const response = await fetchWithRetry(`${API_BASE_URL}/api/youtube-download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      'X-Request-Id': requestId,
      'X-Trace-Id': traceId
    },
    body: JSON.stringify({
      url: finalUrl,
      type: 'audio',
      quality: 'best',
      platform
    }),
    signal: AbortSignal.timeout(getPipelineFetchTimeoutMs('extract'))
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => null);
    console.error('[download-failed]', { traceId, platform, status: response.status, body: errJson });
    throw buildPipelineErrorFromApi(errJson, response, traceId);
  }

  const audioBlob = await response.blob();
  if (!audioBlob || !audioBlob.size) {
    const e = new Error('No audio was returned from downloader');
    e.pipelineCode = 'SOCIAL_DOWNLOAD_EMPTY';
    e.requestId = requestId;
    e.pipelineStage = 'social-extraction';
    throw e;
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

// Extract YouTube video ID (canonical parser)
function extractVideoId(url) {
  return parseYouTubeVideoIdCanonical(url);
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
  const plan = (a.getAttribute('data-cutup-plan') || 'pro').trim();
  if (localStorage.getItem('cutup_session') && window.CutupPlanCheckout?.buildCheckoutUrl) {
    a.href = window.CutupPlanCheckout.buildCheckoutUrl(plan, { source: 'pricing' });
  } else {
    a.href = 'javascript:void(0)';
    bindPricingUpgradeCta(a, plan);
  }
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
    const cachedPlan = normalizePlanKey(window.userSubscription?.plan);
    if (getCutupSessionId() && cutupIsTopTierPlan(cachedPlan)) {
      console.warn('[monetization] preflight check unavailable; allowing top-tier cached plan');
      return { allowed: true };
    }
    return { allowed: false, reason: USER_PLAN_VERIFY_FAIL };
  }

  applyMonetizationPaywallFromServer(data);

  if (data.allowed === false) {
    console.log('[monetization] limit reached', { plan: data.plan, reason: data.reason });
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
  const sessionId = getCutupSessionId();
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
      console.log('[quota-check]', { feature, videoDurationMinutes, allowed: true, mode: 'preview' });
      return { allowed: true, reason: 'Preview mode: no auth' };
    }

    console.log('[quota-check]', { feature, videoDurationMinutes, phase: 'request' });
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
    console.log('[quota-check]', {
      feature,
      videoDurationMinutes,
      allowed: data?.allowed !== false,
      plan: data?.plan,
      monthlyUsed: data?.usage?.monthly?.minutes,
      monthlyLimit: data?.usage?.monthlyLimit,
      reason: data?.reason || null
    });
    return data;
  } catch (error) {
    console.error('[quota-check]', { feature, videoDurationMinutes, error });
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
      languageDetection: transcription.languageDetection || null,
      transcriptionRuntime: transcription.transcriptionRuntime || null,
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
    console.error('[PIPELINE ERROR][processSummarizeFile]', error);
    reportClientError('process', error);
    showPipelineError(error, cutupLastPipelineRetry);
    hideProgressBar();
  }
}

/** One upload pass: transcribe once, show SRT + transcript tabs; summary fills in when ready. */
async function startUploadFilePipeline(file) {
  if (!(file instanceof File) || !cutupIsLoggedIn()) return;
  if (!beginPipelineRun()) return;
  try {
    await processFullTextFile(file, getCutupSessionId(), 'srt');
  } finally {
    endPipelineRun();
  }
}

// Process full text for file
async function processFullTextFile(file, sessionId, activeTab = 'fulltext') {
  const isPreviewMode = !sessionId;
  const showUnifiedTabs = !isPreviewMode;
  const resultOutputMode = showUnifiedTabs ? 'unified' : activeTab === 'srt' ? 'srt' : 'fulltext';
  const resultActiveTab = showUnifiedTabs ? 'srt' : activeTab === 'srt' ? 'srt' : 'fulltext';
  try {
    // Show progress bar
    showProgressBar('Extracting subtitles & transcript…', false);
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

    const summaryPending = {
      unavailable: true,
      message: 'Summary is generating…'
    };

    // Final update to 100%
    setTimeout(() => {
      updateProgressBar(0, 0, 100, 'All set');
    }, 350);
    
    // One transcription → SRT + full text; show SRT first, transcript tab is instant from cache
    displayResults(summaryPending, transcription.text, transcription.segments || [], {
      originalLanguage: transcription.language,
      languageDetection: transcription.languageDetection || null,
      transcriptionRuntime: transcription.transcriptionRuntime || null,
      activeTab: resultActiveTab,
      outputMode: resultOutputMode,
      previewMode: isPreviewMode,
      videoDurationSeconds: estimatedDurationMinutes * 60,
      title: file.name || 'Uploaded file',
      platform: 'upload',
      sourceUrl: 'upload://local-file'
    });
    trackEvent('transcript_generated', {
      mode: showUnifiedTabs ? 'unified' : 'fulltext',
      source: 'file',
      auth: !!sessionId,
      preview: isPreviewMode
    });

    if (sessionId && transcription.text) {
      void summarizeText(
        transcription.text,
        normalizeSummaryLanguage(transcription.language),
        sessionId,
        {
          platform: 'upload',
          title: file.name || 'Uploaded file',
          sourceUrl: 'upload://local-file'
        }
      )
        .then((summary) => patchSummaryInResults(summary))
        .catch((summaryErr) => {
          console.warn('Summary generation failed for file flow:', summaryErr);
          patchSummaryInResults({
            unavailable: true,
            message: 'Summary could not be generated for this file.'
          });
        });
    }
    
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
    void cutupClearPendingUploadFile();
    
  } catch (error) {
    console.error('[PIPELINE ERROR][processFullTextFile]', error);
    reportClientError('process', error);
    showPipelineError(error, cutupLastPipelineRetry);
    hideProgressBar();
  }
}

/** Fallback when /api/youtube JSON extract fails — streams audio via youtube-download. */
async function extractYouTubeAudioViaDownload(resolved, sessionId, traceId) {
  if (!sessionId) return null;
  const requestId = makeRequestId();
  const sourceUrl = resolved.cleaned || resolved.original || resolved.normalizedUrl;
  console.log('[youtube-extract-fallback]', { traceId, route: 'youtube-download', videoId: resolved.videoId });
  updateProgressBar(0, 0, Math.max(progressCurrentPercent || 0, 12), 'Trying alternate download…');

  const response = await fetchWithRetry(`${API_BASE_URL}/api/youtube-download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      'X-Request-Id': requestId,
      'X-Trace-Id': traceId
    },
    body: JSON.stringify({
      url: sourceUrl,
      videoId: resolved.videoId,
      type: 'audio',
      quality: 'best',
      platform: 'youtube'
    }),
    signal: AbortSignal.timeout(getPipelineFetchTimeoutMs('extract'))
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => null);
    console.error('[youtube-extract-fallback-failed]', { traceId, status: response.status, body: errJson });
    throw buildPipelineErrorFromApi(errJson, response, traceId);
  }

  const audioBlob = await response.blob();
  if (!audioBlob?.size) {
    const e = new Error('No audio was returned from alternate downloader');
    e.errorCode = 'DOWNLOAD_FAILED';
    e.traceId = traceId;
    throw e;
  }

  const audioUrl = await blobToDataUrl(audioBlob);
  return {
    audioUrl,
    language: null,
    subtitles: null,
    subtitleLanguage: null,
    subtitlesSource: null,
    availableLanguages: [],
    title: null,
    duration: null,
    videoId: resolved.videoId
  };
}

// Extract YouTube audio (like extension)
async function extractYouTubeAudio(url, sessionId = null) {
  const resolved = resolveYouTubeUrlForPipeline(url);
  console.log('[link-parse]', { url: resolved.original.slice(0, 120) });
  const { videoId, normalizedUrl } = resolved;
  if (resolved.cleaned && /\/shorts\//i.test(resolved.cleaned)) {
    console.log('[shorts-normalized]', { videoId, url: normalizedUrl });
  }
  if (!videoId || !normalizedUrl) {
    const errorCode = resolved.cleaned && /\/shorts\//i.test(resolved.cleaned)
      ? 'SHORTS_PARSE_ERROR'
      : 'INVALID_URL';
    const e = new Error(mapErrorCodeToUserMessage(errorCode));
    e.errorCode = errorCode;
    e.pipelineCode = errorCode;
    e.retryable = false;
    throw e;
  }

  const traceId = makeTraceId();
  console.log('[platform-detected]', { platform: 'youtube', videoId });
  console.log('[download-start]', { traceId, platform: 'youtube', videoId });
  console.log('[transcript-trace]', traceId, { stage: 'youtube-extract-start', videoId });
  
  try {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/youtube`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        ...(sessionId ? { 'X-Session-Id': sessionId } : {})
      },
      body: JSON.stringify({
        videoId,
        url: normalizedUrl,
        originalUrl: resolved.original,
        isShorts: /\/shorts\//i.test(resolved.cleaned || resolved.original)
      }),
      signal: AbortSignal.timeout(getPipelineFetchTimeoutMs('extract'))
    });

    console.log('[generate-response]', { traceId, stage: 'youtube-extract', status: response.status });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[generate-error]', { traceId, stage: 'youtube-extract', status: response.status, error });
      throw buildPipelineErrorFromApi(error, response, traceId);
    }

    const result = await response.json();
    if (result && result.success === false) {
      console.error('[frontend-after-youtube]', { traceId, errorCode: result.errorCode, message: result.message });
      throw buildPipelineErrorFromApi(result, response, traceId);
    }

    const payload =
      typeof result === 'string'
        ? { audioUrl: result }
        : {
            audioUrl: result.audioUrl || result.audio_url || null,
            language: result.language || null,
            subtitles: result.subtitles || null,
            subtitleLanguage: result.subtitleLanguage || result.subtitle_language || null,
            subtitlesSource: result.subtitlesSource || result.subtitles_source || null,
            availableLanguages: result.availableLanguages || result.available_languages || [],
            title: result.title || null,
            duration: result.duration ?? null
          };

    console.log('[frontend-after-youtube]', {
      traceId,
      hasAudioUrl: Boolean(payload.audioUrl),
      audioUrlKind: payload.audioUrl ? (String(payload.audioUrl).startsWith('data:') ? 'data-url' : 'url') : 'none',
      hasSubtitles: Boolean(payload.subtitles),
      subtitleLanguage: payload.subtitleLanguage,
      duration: payload.duration,
      title: payload.title ? String(payload.title).slice(0, 80) : null
    });

    if (!payload.audioUrl) {
      const e = new Error('Audio extraction returned no audioUrl');
      e.errorCode = 'DOWNLOAD_FAILED';
      e.traceId = traceId;
      throw e;
    }

    return { ...payload, videoId };
  } catch (error) {
    console.error('[frontend-runtime-error]', {
      stage: 'extractYouTubeAudio',
      traceId,
      name: error?.name,
      message: error?.message,
      errorCode: error?.errorCode
    });
    const code = String(error?.errorCode || error?.pipelineCode || '').toUpperCase();
    const canFallback =
      sessionId &&
      (code === 'DOWNLOAD_FAILED' ||
        code === 'TRANSCRIPTION_TIMEOUT' ||
        code === 'PLATFORM_ERROR' ||
        code === 'UNKNOWN_ERROR' ||
        /could not extract/i.test(String(error?.message || '')));
    if (canFallback) {
      try {
        const fallbackPayload = await extractYouTubeAudioViaDownload(resolved, sessionId, traceId);
        if (fallbackPayload?.audioUrl) {
          console.log('[youtube-extract-fallback-ok]', { traceId, bytes: audioBlobSizeHint(fallbackPayload.audioUrl) });
          return fallbackPayload;
        }
      } catch (fallbackErr) {
        console.error('[youtube-extract-fallback-error]', { traceId, message: fallbackErr?.message });
        throw fallbackErr?.errorCode ? fallbackErr : error;
      }
    }
    if (error.errorCode || error.pipelineCode) throw error;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      const e = new Error(mapErrorCodeToUserMessage('TRANSCRIPTION_TIMEOUT'));
      e.errorCode = 'TRANSCRIPTION_TIMEOUT';
      e.pipelineCode = 'TRANSCRIPTION_TIMEOUT';
      e.traceId = traceId;
      e.retryable = true;
      throw e;
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      const e = new Error(mapErrorCodeToUserMessage('NETWORK_ERROR'));
      e.errorCode = 'NETWORK_ERROR';
      e.pipelineCode = 'NETWORK_ERROR';
      e.traceId = traceId;
      e.retryable = true;
      throw e;
    }
    throw error;
  }
}

function audioBlobSizeHint(dataUrl) {
  const s = String(dataUrl || '');
  if (!s.startsWith('data:')) return null;
  const idx = s.indexOf(',');
  if (idx < 0) return null;
  return Math.floor((s.length - idx) * 0.75);
}

// Transcribe audio (like extension)
function rememberSourceVideoFile(file) {
  if (file instanceof File && String(file.type || '').toLowerCase().startsWith('video/')) {
    window.cutupLastSourceVideoFile = file;
    void probeVideoAspectFromFile(file);
  }
}

async function probeVideoAspectFromFile(file) {
  if (!(file instanceof File) || !String(file.type || '').toLowerCase().startsWith('video/')) {
    return null;
  }
  try {
    const aspect = await new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        const w = Number(video.videoWidth) || 0;
        const h = Number(video.videoHeight) || 0;
        URL.revokeObjectURL(url);
        if (!w || !h) {
          resolve(null);
          return;
        }
        if (h > w * 1.05) resolve('vertical');
        else if (w > h * 1.15) resolve('horizontal');
        else resolve('square');
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      video.src = url;
    });
    if (aspect) {
      window.cutupVideoAspect = aspect;
      window.CutupSubtitleStyles?.refreshPreview?.();
    }
    return aspect;
  } catch {
    return null;
  }
}

/** Convert extracted audio (data URL from YouTube/IG/TikTok) into a File for multipart upload. */
async function dataUrlToTranscribeFile(dataUrl, contextMeta = {}) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const mime = blob.type || 'audio/mpeg';
  let ext = 'mp3';
  if (mime.includes('wav')) ext = 'wav';
  else if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
  else if (mime.includes('webm') || mime.includes('ogg')) ext = 'webm';
  const platform = contextMeta.platform || 'media';
  const name = contextMeta.filename || `extracted-${platform}.${ext}`;
  return new File([blob], name, { type: mime });
}

/** Shared transcription path for YouTube, Instagram, TikTok after audio/subtitle extraction. */
async function resolveTranscriptionFromExtract(extractResult, {
  platform,
  sessionId,
  sourceUrl,
  durationSeconds = 0,
  progressStartPct = 26,
  progressEndPct = 70,
  subtitleProgressSec = 5,
  transcribeProgressSec = null
} = {}) {
  if (shouldUseYoutubeSubtitles(extractResult)) {
    console.log('YOUTUBE: Using manual YouTube subtitles');
    updateProgressBar(0, 0, 28, CUTUP_PIPELINE.CHECK_SUBTITLES);
    startProgressTracking(progressStartPct, progressEndPct, subtitleProgressSec, CUTUP_PIPELINE.READ_CAPTIONS, CUTUP_PIPELINE.READ_CAPTIONS);
    const transcription = await parseYouTubeSubtitles(extractResult.subtitles, extractResult.subtitleLanguage);
    stopProgressTracking(progressEndPct, 'Subtitles parsed');
    return { transcription, usedManualSubtitles: true };
  }

  if (extractResult.subtitles && extractResult.subtitlesSource === 'auto') {
    console.log('YOUTUBE: Skipping auto-generated captions — transcribing audio for accuracy');
  }
  console.log(`${platform.toUpperCase()}: Transcribing audio`);
  const estimatedTranscriptionTime = transcribeProgressSec ?? estimateTranscriptionDuration(null, durationSeconds);
  startProgressTracking(
    progressStartPct,
    progressEndPct,
    estimatedTranscriptionTime,
    CUTUP_PIPELINE.GENERATE_TRANSCRIPT,
    CUTUP_PIPELINE.GENERATE_TRANSCRIPT
  );
  const rawLangHint = extractResult.language || extractResult.subtitleLanguage || null;
  const slavicMetaHint = /^(ru|uk|pl)$/i.test(String(rawLangHint || '').slice(0, 2));
  const langHint = slavicMetaHint ? null : rawLangHint;
  if (rawLangHint) setDetectedSourceLanguage(rawLangHint);
  const transcription = await transcribeAudio(extractResult.audioUrl, langHint, sessionId, {
    platform,
    title: extractResult.title || `${getPlatformName(platform)} video`,
    sourceUrl
  });
  stopProgressTracking(progressEndPct, 'Transcription complete');
  return { transcription, usedManualSubtitles: false };
}

async function transcribeAudio(audioUrlOrFile, languageHint = null, sessionId = null, contextMeta = {}) {
  window.CutupWhisperTimingTrace?.resetWhisperTimingTrace?.();
  let transcribePayload = audioUrlOrFile;
  if (typeof audioUrlOrFile === 'string' && audioUrlOrFile.startsWith('data:')) {
    console.log('TRANSCRIBE: Converting data URL to file for upload endpoint');
    transcribePayload = await dataUrlToTranscribeFile(audioUrlOrFile, contextMeta);
  }
  if (transcribePayload instanceof File) {
    rememberSourceVideoFile(transcribePayload);
  }
  const requestId = makeRequestId();
  const traceId = makeTraceId();
  const payloadKind = transcribePayload instanceof File ? 'file' : 'url';
  console.log('[transcript-trace]', traceId);
  console.log('[generate-start]', {
    traceId,
    requestId,
    kind: payloadKind,
    hasSession: Boolean(sessionId),
    platform: contextMeta?.platform || null
  });
  const orchestrationTimers = [
    setTimeout(() => cutupPulseTranscriptionOrchestration(0), 22000),
    setTimeout(() => cutupPulseTranscriptionOrchestration(1), 38000),
    setTimeout(() => cutupPulseTranscriptionOrchestration(2), 52000)
  ];
  console.log('[frontend-before-transcribe]', {
    traceId,
    requestId,
    kind: payloadKind,
    hasSession: Boolean(sessionId),
    platform: contextMeta?.platform || null
  });
  try {
    let response;
    const timeoutMs = getPipelineFetchTimeoutMs('transcribe');
    const commonHeaders = {
      'X-Trace-Id': traceId,
      'X-Request-Id': requestId,
      ...(sessionId ? { 'X-Session-Id': sessionId } : {})
    };
    
    // File / data-URL payloads use multipart upload (avoids JSON body size limits)
    if (transcribePayload instanceof File) {
      const formData = new FormData();
      formData.append('file', transcribePayload);
      if (sessionId) {
        formData.append('user_id', sessionId);
      }
      
      console.log('TRANSCRIBE: Sending file to upload endpoint, size:', transcribePayload.size, 'bytes');
      
      response = await fetchWithRetry(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: commonHeaders,
        body: formData,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } else {
      console.log('TRANSCRIBE: Sending request to', `${API_BASE_URL}/api/transcribe`);
      
      const body = { audioUrl: transcribePayload, languageHint, metadata: contextMeta };
      
      response = await fetchWithRetry(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
          ...commonHeaders
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    }

    console.log('[generate-response]', { traceId, requestId, status: response.status, ok: response.ok });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('[generate-error]', { traceId, requestId, status: response.status, error });
      throw buildPipelineErrorFromApi(error, response, traceId);
    }
    
    const result = await response.json();

    console.log('[frontend-transcribe-response]', {
      traceId,
      requestId,
      status: response.status,
      success: result?.success,
      errorCode: result?.errorCode,
      hasText: !!result?.text,
      textLength: result?.text?.length || 0,
      segmentCount: Array.isArray(result?.segments) ? result.segments.length : 0,
      asrPipeline: result?.asrPipeline || null,
      segmentSource: result?.segmentSource || null,
      wordGapFill: result?.wordGapFill || null,
      wordCount: Array.isArray(result?.words) ? result.words.length : 0
    });
    
    if (result && result.success === false) {
      throw buildPipelineErrorFromApi(result, response, traceId);
    }
    
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
    
    console.log('[generate-response]', {
      requestId,
      ok: true,
      textLength: result.text.length,
      segments: result.segments?.length || 0
    });
    
    cutupLangDebug({
      phase: 'transcribeAudio:response',
      language: result.language ?? null,
      textChars: result.text?.length ?? 0,
      segmentCount: Array.isArray(result.segments) ? result.segments.length : 0,
      hadLanguageHint: languageHint != null && languageHint !== ''
    });
    const normalized = normalizeTranscriptionResult(result);
    if (result?.whisperTimingForensics) {
      window.cutupTranscribeApiForensics = result.whisperTimingForensics;
    }
    return normalized;
  } catch (error) {
    console.error('[frontend-runtime-error]', {
      stage: 'transcribeAudio',
      traceId,
      requestId,
      name: error?.name,
      message: error?.message,
      errorCode: error?.errorCode
    });
    console.error('[generate-error]', { traceId, requestId, name: error?.name, errorCode: error?.errorCode });
    if (error.errorCode || error.pipelineCode) throw error;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      const e = new Error(mapErrorCodeToUserMessage('TRANSCRIPTION_TIMEOUT'));
      e.errorCode = 'TRANSCRIPTION_TIMEOUT';
      e.pipelineCode = 'TRANSCRIPTION_TIMEOUT';
      e.traceId = traceId;
      e.retryable = true;
      throw e;
    }
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      const e = new Error(mapErrorCodeToUserMessage('NETWORK_ERROR'));
      e.errorCode = 'NETWORK_ERROR';
      e.pipelineCode = 'NETWORK_ERROR';
      e.traceId = traceId;
      e.retryable = true;
      throw e;
    }
    throw error;
  } finally {
    orchestrationTimers.forEach((t) => clearTimeout(t));
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

function isClientAsrV2() {
  return window.cutupAsrPipeline === 'v2';
}

function computeClientSegmentGapSec(segments) {
  const sorted = [...(segments || [])].sort((a, b) => Number(a.start) - Number(b.start));
  let max = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    max = Math.max(max, Number(sorted[i + 1].start) - Number(sorted[i].end));
  }
  return Number(max.toFixed(3));
}

/** Pass-through for ASR V2 — no merge, offset, or timing mutation on the client. */
function normalizeSegmentsForDisplay(segments) {
  if (!Array.isArray(segments) || !segments.length) return segments || [];
  if (isClientAsrV2()) {
    return segments
      .map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: String(s.text || '').trim(),
        ...(Array.isArray(s.words) ? { words: s.words } : {}),
        ...(s.fromProviderWords ? { fromProviderWords: true } : {})
      }))
      .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  }
  if (window.CutupSubtitleClean?.normalizeTimelineSegments) {
    return window.CutupSubtitleClean.normalizeTimelineSegments(segments);
  }
  return segments;
}

/** Only trust creator-uploaded YouTube captions; auto-generated rolling tracks go to Whisper. */
function shouldUseYoutubeSubtitles(youtubeResult) {
  return Boolean(youtubeResult?.subtitles && youtubeResult.subtitlesSource === 'manual');
}

// Parse YouTube VTT subtitles to segments (like extension)
async function parseYouTubeSubtitles(vttContent, language) {
  // Convert VTT to SRT format
  const srtContent = vttToSRT(vttContent);
  
  // Parse SRT to segments + collapse rolling/blink duplicates
  const segments = normalizeSegmentsForDisplay(parseSRTToSegments(srtContent));
  
  // Extract full text
  const fullText = segments.map(s => s.text).join(' ');
  
  const audioDurationSec = segments.length
    ? Math.max(...segments.map((s) => Number(s.end) || 0))
    : null;
  return normalizeTranscriptionResult({
    text: fullText,
    language: language ?? null,
    segments,
    transcriptionRuntime: {
      provider: 'youtube',
      providerLabel: 'YouTube captions',
      model: 'manual',
      transcriptionDurationMs: 0,
      audioDurationSec: audioDurationSec > 0 ? Number(audioDurationSec.toFixed(3)) : null,
      fromCache: false
    }
  });
}

function formatRuntimeDurationMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} ms`;
  const sec = n / 1000;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatRuntimeAudioDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 60) return `${n.toFixed(1)} s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTranscriptionRuntimeBar(runtime) {
  const bar = document.getElementById('transcriptionRuntimeBar');
  if (!bar) return;
  if (!runtime || (!runtime.provider && !runtime.providerLabel)) {
    bar.hidden = true;
    bar.textContent = '';
    return;
  }
  const provider = runtime.providerLabel || runtime.provider || '—';
  const model = runtime.model || (runtime.fromCache ? 'cached' : '—');
  const transcribeDur = runtime.fromCache
    ? 'cached'
    : formatRuntimeDurationMs(runtime.transcriptionDurationMs);
  const audioDur = formatRuntimeAudioDuration(runtime.audioDurationSec);
  bar.innerHTML = `
    <span><strong>Provider</strong> ${escapeHtmlRuntime(provider)}</span>
    <span><strong>Model</strong> ${escapeHtmlRuntime(model)}</span>
    <span><strong>Transcription</strong> ${escapeHtmlRuntime(transcribeDur)}</span>
    <span><strong>Audio</strong> ${escapeHtmlRuntime(audioDur)}</span>
  `;
  bar.hidden = false;
}

function escapeHtmlRuntime(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    
    const timeMatch = timeLine
      .replace(/--&gt;/gi, '-->')
      .replace(/--@gt;/gi, '-->')
      .match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timeMatch) continue;
    
    const startTime = parseSRTTimeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endTime = parseSRTTimeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    let text = textLines.join(' ').trim();
    
    // Clean up text: remove any remaining HTML tags and inline timestamps
    text = text.replace(/<[^>]+>/g, ''); // Remove HTML tags
    text = text.replace(/<\d{2}:\d{2}:\d{2}[,\.]\d{3}>/g, ''); // Remove inline timestamps
    text = (typeof decodeSubtitleTextEntities === 'function'
      ? decodeSubtitleTextEntities
      : window.CutupSubtitleClean?.decodeSubtitleTextEntities)?.(text) ?? text;
    text = text.replace(/\s+/g, ' ').trim(); // Normalize whitespace
    
    if (text.length > 0) {
      rawSegments.push({ start: startTime, end: endTime, text });
    }
  }
  
  return normalizeSegmentsForDisplay(rawSegments);
}

// Parse SRT time to seconds
function parseSRTTimeToSeconds(hours, minutes, seconds, milliseconds) {
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(milliseconds) / 1000;
}

// Process summarize (using extension logic)
async function processSummarize(url, sessionId, platform = 'youtube') {
  const isPreviewMode = !sessionId;
  console.log('[generate-start]', { flow: 'processSummarize', platform, url: String(url || '').slice(0, 80), hasSession: Boolean(sessionId) });
  if (replayCachedResultIfMatch('summary', 'fulltext')) return;
  try {
    // Show progress bar
    showProgressBar('Working on your video…', false);
    const extractLabel =
      platform === 'youtube' ? CUTUP_PIPELINE.DOWNLOAD : CUTUP_PIPELINE.EXTRACT_AUDIO;
    updateProgressBar(0, 0, 0, extractLabel);

    const extractEstSec = estimateMediaExtractionDurationSeconds(platform);
    startProgressTracking(0, 22, extractEstSec, CUTUP_PIPELINE.EXTRACT_AUDIO);
    const youtubeResult = platform === 'youtube'
      ? await extractYouTubeAudio(url, sessionId)
      : await extractSocialAudio(url, platform, sessionId);

    console.log('[frontend-after-youtube]', {
      flow: 'processFullText',
      platform,
      hasAudioUrl: Boolean(youtubeResult?.audioUrl),
      hasSubtitles: Boolean(youtubeResult?.subtitles),
      duration: youtubeResult?.duration ?? null
    });

    const audioUrl = youtubeResult.audioUrl;
    
    if (!audioUrl) {
      stopProgressTracking(0, 'Audio extraction failed');
      throw new Error('Audio extraction failed');
    }
    
    stopProgressTracking(22, 'Audio extracted');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    if (sessionId) {
      // Check subscription limit with actual duration
      updateProgressBar(0, 0, 24, 'Checking your plan…');
      const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
      if (!limitCheck.allowed) {
        showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
        hideProgressBar();
        return;
      }
      updateProgressBar(0, 0, 26, 'Plan check complete');
    } else {
      updateProgressBar(0, 0, 26, 'Running free preview…');
    }
    
    const { transcription } = await resolveTranscriptionFromExtract(youtubeResult, {
      platform,
      sessionId,
      sourceUrl: url,
      durationSeconds,
      progressStartPct: 26,
      progressEndPct: 70
    });

    const estimatedSummaryTime = estimateSummarizationDuration(transcription.text.length);
    startProgressTracking(70, 99, estimatedSummaryTime, CUTUP_PIPELINE.WRITING_SUMMARY, CUTUP_PIPELINE.WRITING_SUMMARY);
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
      isYouTubeSubtitle: shouldUseYoutubeSubtitles(youtubeResult),
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      languageDetection: transcription.languageDetection || null,
      transcriptionRuntime: transcription.transcriptionRuntime || null,
      activeTab: 'summary',
      outputMode: 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: youtubeResult.duration || 0,
      title: youtubeResult.title || `${getPlatformName(platform)} video`,
      platform,
      sourceUrl: url,
      videoId: youtubeResult.videoId || null
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
    stopProgressTracking(progressCurrentPercent || 0, 'Failed');
    console.error('[PIPELINE ERROR][processSummarize]', error);
    reportClientError('process', error);
    showPipelineError(error, cutupLastPipelineRetry);
  } finally {
    hideProgressBar();
  }
}

// Process full text (using extension logic)
async function processFullText(url, sessionId, platform = 'youtube', activeTab = 'fulltext') {
  const isPreviewMode = !sessionId;
  console.log('[generate-start]', { flow: 'processFullText', platform, activeTab, url: String(url || '').slice(0, 80), hasSession: Boolean(sessionId) });
  if (replayCachedResultIfMatch(activeTab, activeTab === 'srt' ? 'srt' : 'fulltext')) return;
  try {
    // Show progress bar
    showProgressBar('Working on your video…', false);
    const extractLabel =
      platform === 'youtube' ? CUTUP_PIPELINE.DOWNLOAD : CUTUP_PIPELINE.EXTRACT_AUDIO;
    updateProgressBar(0, 0, 0, extractLabel);

    const extractEstSec = estimateMediaExtractionDurationSeconds(platform);
    startProgressTracking(0, 22, extractEstSec, CUTUP_PIPELINE.EXTRACT_AUDIO);
    const youtubeResult = platform === 'youtube'
      ? await extractYouTubeAudio(url, sessionId)
      : await extractSocialAudio(url, platform, sessionId);

    console.log('[frontend-after-youtube]', {
      flow: 'processFullText',
      platform,
      hasAudioUrl: Boolean(youtubeResult?.audioUrl),
      hasSubtitles: Boolean(youtubeResult?.subtitles),
      duration: youtubeResult?.duration ?? null
    });

    const audioUrl = youtubeResult.audioUrl;
    
    if (!audioUrl) {
      stopProgressTracking(0, 'Audio extraction failed');
      throw new Error('Audio extraction failed');
    }
    
    stopProgressTracking(22, 'Audio extracted');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    if (sessionId) {
      // Check subscription limit with actual duration
      updateProgressBar(0, 0, 24, 'Checking your plan…');
      const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
      if (!limitCheck.allowed) {
        showMessage(limitCheck.reason || LIMIT_UPGRADE_FALLBACK, 'error');
        window.open(`/dashboard.html?session=${encodeURIComponent(sessionId)}`, '_blank');
        hideProgressBar();
        return;
      }
      updateProgressBar(0, 0, 26, 'Plan check complete');
    } else {
      updateProgressBar(0, 0, 26, 'Running free preview…');
    }
    
    console.log('[frontend-before-transcribe]', {
      flow: 'processFullText',
      platform,
      audioUrlKind: String(audioUrl).startsWith('data:') ? 'data-url' : 'url',
      durationSeconds,
      subtitlesSource: youtubeResult.subtitlesSource || null
    });
    const { transcription } = await resolveTranscriptionFromExtract(youtubeResult, {
      platform,
      sessionId,
      sourceUrl: url,
      durationSeconds,
      progressStartPct: 26,
      progressEndPct: 99
    });
    console.log('[frontend-transcribe-response]', {
      flow: 'processFullText',
      textChars: transcription?.text?.length ?? 0,
      segmentCount: transcription?.segments?.length ?? 0,
      language: transcription?.language ?? null
    });

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
      isYouTubeSubtitle: shouldUseYoutubeSubtitles(youtubeResult),
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      languageDetection: transcription.languageDetection || null,
      transcriptionRuntime: transcription.transcriptionRuntime || null,
      activeTab,
      outputMode: activeTab === 'srt' ? 'srt' : 'fulltext',
      previewMode: isPreviewMode,
      videoDurationSeconds: youtubeResult.duration || 0,
      title: youtubeResult.title || `${getPlatformName(platform)} video`,
      platform,
      sourceUrl: url,
      videoId: youtubeResult.videoId || null
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
    stopProgressTracking(progressCurrentPercent || 0, 'Failed');
    console.error('[frontend-runtime-error]', {
      stage: 'processFullText',
      name: error?.name,
      message: error?.message,
      errorCode: error?.errorCode,
      pipelineCode: error?.pipelineCode
    });
    console.error('[PIPELINE ERROR][processFullText]', error);
    reportClientError('process', error);
    showPipelineError(error, cutupLastPipelineRetry);
  } finally {
    hideProgressBar();
  }
}

/** Normalize platform id for cinematic UI (all Cutup input sources). */
function normalizeCinematicPlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (p === 'audiofile' || p === 'file' || p === 'local') return 'upload';
  if (p === 'youtube' || p === 'tiktok' || p === 'instagram' || p === 'upload') return p;
  return p || 'upload';
}

/** Duration from timed segments when API did not return video length (TikTok/Instagram/upload). */
function deriveDurationSecFromSegments(segments, fallbackSec = 0) {
  if (!Array.isArray(segments) || !segments.length) return Math.max(0, Number(fallbackSec) || 0);
  let maxEnd = 0;
  for (const s of segments) {
    const end = Number(s?.end);
    if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
  }
  return maxEnd > 0 ? maxEnd : Math.max(0, Number(fallbackSec) || 0);
}

/** Metadata for cinematic preview card (heuristic UI only). */
function buildCinematicPreviewMeta(options = {}, segments = null) {
  const platform = normalizeCinematicPlatform(
    options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : null) || 'upload'
  );
  let videoId = options.videoId || null;
  const sourceUrl = options.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : null);
  if (!videoId && sourceUrl && platform === 'youtube') {
    try {
      videoId = resolveYouTubeUrlForPipeline(sourceUrl).videoId;
    } catch {
      videoId = null;
    }
  }
  const fromApi = Number(options.videoDurationSeconds) || 0;
  const durationSec = fromApi > 0 ? fromApi : deriveDurationSecFromSegments(segments, fromApi);

  return {
    title: options.title || null,
    platform,
    durationSec,
    language: options.originalLanguage || window.cutupDetectedSourceLanguage || 'auto',
    videoId,
    thumbnailUrl: options.thumbnailUrl || null,
    sourceUrl: sourceUrl || null
  };
}

/** Refresh styled SRT preview + raw panel (style presets engine). */
function refreshCutupSubtitleStyles() {
  if (window.CutupSubtitleStyles && typeof window.CutupSubtitleStyles.refreshPreview === 'function') {
    window.CutupSubtitleStyles.refreshPreview();
  }
}

function syncSrtRawPanel() {
  const rawEl = document.getElementById('srtPreviewRaw');
  const content =
    buildCleanSrtFromSource() ||
    stripSrtForTranslation(window.originalSrtContent || window.currentSrtContent || '');
  if (rawEl) rawEl.textContent = content;
  const hidden = document.getElementById('srtPreview');
  if (hidden) hidden.textContent = content;
}

/** Mount AI cinematic preview after transcription (additive; safe if modules missing). */
function mountCutupCinematicPreview(fullText, segments, options = {}) {
  const mount = document.getElementById('cutupCinematicPreviewMount');
  if (!mount) return;
  if (!window.CutupCinematicPreview || typeof window.CutupCinematicPreview.mount !== 'function') {
    mount.hidden = true;
    return;
  }
  const text = String(fullText || '').trim();
  const segs = Array.isArray(segments) ? segments : [];
  if (!text && segs.length === 0) {
    window.CutupCinematicPreview.unmount(mount);
    return;
  }
  try {
    const meta = buildCinematicPreviewMeta(options, segs);
    window.CutupCinematicPreview.mount(mount, {
      fullText: text,
      segments: segs,
      meta
    });
    console.log('[cinematic-preview] mounted', { platform: meta.platform, durationSec: meta.durationSec });
  } catch (err) {
    console.warn('[cinematic-preview] mount failed', err?.message || err);
    mount.hidden = true;
  }
}

// Display Results (like extension) - replaces modal approach
function displayResults(summary, fullText, segments = null, options = {}) {
  if (Array.isArray(segments) && segments.length) {
    segments = normalizeSegmentsForDisplay(segments);
    window.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('after_display_results', segments, {
      previewMode: !!options.previewMode
    });
  }
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
  const transcriptRaw = typeof fullText === 'string' ? fullText : (fullText?.text || fullText?.transcript || '');
  window.originalFullText = String(transcriptRaw || '').trim();
  window.originalSummary = typeof summary === 'string' ? summary : (summary?.summary || summaryTextContent);
  const finalUiLanguage = resolveFinalLanguageForUi(options);
  setDetectedSourceLanguage(finalUiLanguage);
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

    // Store original SRT for translation (without attribution line)
    window.originalSrtContent = stripSrtForTranslation(window.currentSrtContent);
    window.originalSrtSegments = segments;
    window.cutupSourceSegments = cloneSourceSegments(
      previewSegments && previewSegments.length ? previewSegments : segments
    );
    if (window.CutupSubtitleVersions) {
      window.CutupSubtitleVersions.reset();
      window.CutupSubtitleVersions.registerOriginal({
        segments: window.cutupSourceSegments,
        srtContent: stripSrtForTranslation(window.originalSrtContent || window.currentSrtContent || ''),
        language: window.cutupDetectedSourceLanguage || options.originalLanguage
      });
      window.CutupSubtitleVersions.bindSelector();
    }
    window.availableLanguages = (options && options.availableLanguages) || [];
  } else {
    // Clear SRT-related state when user has no subtitle access
    window.currentSrtContent = null;
    window.originalSrtContent = null;
    window.originalSrtSegments = null;
    window.cutupSourceSegments = null;
    window.CutupSubtitleVersions?.reset?.();
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
    rawProviderLanguage:
      options.languageDetection?.rawProviderLanguage ??
      options.languageDetection?.providerLanguage ??
      options.languageDetection?.whisperLanguage ??
      null,
    finalLanguage: finalUiLanguage,
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
  const hasSrtExport = Boolean(
    (window.cutupSourceSegments && window.cutupSourceSegments.length) || window.currentSrtContent
  );
  const downloadCleanSrtBtn = document.getElementById('downloadCleanSrtBtn');
  if (downloadCleanSrtBtn) {
    downloadCleanSrtBtn.disabled = !hasSrtExport;
    downloadCleanSrtBtn.title = hasSrtExport
      ? 'Plain, editing-ready SRT from the original transcript'
      : 'SRT will appear after transcription is ready.';
  }
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  if (downloadSrtBtn) {
    downloadSrtBtn.style.display = 'none';
    downloadSrtBtn.disabled = !hasSrtExport;
  }
  if (previewMode && hasSubtitleFeature && outputMode === 'srt') {
    trackEvent('subtitle_preview_shown', {
      activeTab: 'srt',
      auth: !!localStorage.getItem('cutup_session'),
      platform: typeof currentPlatform !== 'undefined' ? currentPlatform : 'unknown'
    });
  }

  window.cutupLastLanguageDetection = options.languageDetection || null;

  // Show result section
  resultSection.style.display = 'block';

  renderTranscriptionRuntimeBar(
    options.transcriptionRuntime || options.languageDetection?.transcriptionRuntime || null
  );

  mountCutupCinematicPreview(previewFullText, previewSegments || segments, options);

  syncSrtRawPanel();
  if (window.currentSrtContent && window.CutupSubtitleStyles) {
    requestAnimationFrame(() => window.CutupSubtitleStyles.initAfterResults());
  }
  if (window.CutupViralExport) {
    requestAnimationFrame(() => window.CutupViralExport.initAfterResults());
  }

  applyResultOutputMode(resultSection, outputMode);

  let targetTab = requestedTab;
  if (outputMode === 'unified') {
    targetTab =
      requestedTab === 'fulltext' || requestedTab === 'summary' ? requestedTab : 'srt';
  } else if (outputMode === 'srt') {
    targetTab = 'srt';
  } else if (targetTab === 'srt') {
    targetTab = summary ? 'summary' : 'fulltext';
  }
  switchTab(targetTab);

  setupTranslateButtons();

  window.cutupLastTranscription = {
    cacheKey: getTranscriptionCacheKey(),
    summary,
    fullText: window.originalFullText,
    transcription: window.originalFullText,
    segments: segments || [],
    title: options.title || null,
    platform: options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : null),
    sourceUrl: options.sourceUrl || (typeof getCurrentUrl === 'function' ? getCurrentUrl() : null),
    lastDisplayOptions: {
      originalLanguage: finalUiLanguage || options.originalLanguage,
      languageDetection: options.languageDetection || null,
      isYouTubeSubtitle: options.isYouTubeSubtitle,
      availableLanguages: options.availableLanguages || [],
      previewMode: options.previewMode,
      outputMode,
      activeTab: requestedTab,
      videoDurationSeconds: options.videoDurationSeconds,
      platform: normalizeCinematicPlatform(
        options.platform || (typeof currentPlatform !== 'undefined' ? currentPlatform : null)
      ),
      title: options.title || null,
      sourceUrl: options.sourceUrl || null,
      videoId: options.videoId || null,
      thumbnailUrl: options.thumbnailUrl || null,
      transcriptionRuntime: options.transcriptionRuntime || null
    },
    languageDetection: options.languageDetection || null,
    transcriptionRuntime: options.transcriptionRuntime || null
  };

  const habitHint = document.getElementById('retentionHabitHint');
  if (habitHint) habitHint.hidden = false;

  initStickyLayerAfterResults();
  window.CutupWorkspaceAutosave?.scheduleSave?.();

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
        thumbnailUrl: options.thumbnailUrl || options.lastDisplayOptions?.thumbnailUrl || null,
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

  if (!options.cacheReplay && !options.previewMode) {
    requestPipelineFeedback('transcription', {
      contextKey: window.cutupLastTranscription?.cacheKey || options.sourceUrl || options.title || 'transcription',
      platform: options.platform || currentPlatform,
      outputMode
    });
  }
}

window.displayResults = displayResults;

async function persistSavedOutputs(sessionId, payload) {
  if (!sessionId || !payload) return;
  const baseMeta = {
    platform: payload.platform || 'unknown',
    sourceUrl: payload.sourceUrl || '',
    title: payload.title || null,
    thumbnailUrl: payload.thumbnailUrl || null
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
    processingSessionId: last.cacheKey || null,
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

  if (tabName === 'srt') {
    window.CutupSubtitleVersions?.refreshVersionSelector?.();
    syncSrtRawPanel();
    refreshCutupSubtitleStyles();
  }
  window.CutupWorkspaceAutosave?.scheduleSave?.();
}

// Generate SRT from segments
function generateSRT(segments) {
  return segments.map((segment, index) => {
    const start = formatSRTTime(segment.start);
    const end = formatSRTTime(segment.end);
    return `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
  }).join('');
}

/** Immutable Whisper/source segments — never pass through viral-only cleaning for SRT export. */
function cloneSourceSegments(segments) {
  const decode =
    typeof decodeSubtitleTextEntities === 'function'
      ? decodeSubtitleTextEntities
      : window.CutupSubtitleClean?.decodeSubtitleTextEntities;
  return (segments || [])
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: decode ? decode(String(s.text || '')) : String(s.text || '').trim()
    }))
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
}

function buildCleanSrtFromSource() {
  const raw = cloneSourceSegments(
    (window.CutupSubtitleVersions?.getActiveSegments?.() || []).length
      ? window.CutupSubtitleVersions.getActiveSegments()
      : window.cutupSourceSegments ||
          window.originalSrtSegments ||
          window.cutupLastTranscription?.segments
  );
  if (!raw.length) return '';
  if (isClientAsrV2()) {
    return generateSRT(raw);
  }
  const prepared = window.CutupSubtitleClean?.prepareSegmentsForMode
    ? window.CutupSubtitleClean.prepareSegmentsForMode(raw, 'accurate')
    : raw;
  if (!prepared.length) return '';
  return generateSRT(prepared);
}

window.buildCleanSrtFromSource = buildCleanSrtFromSource;

function downloadCleanSrtFile() {
  if (!cutupRequirePermission('canDownloadSrt')) return;
  const body = buildCleanSrtFromSource();
  if (!body) {
    showMessage('No subtitles available for clean SRT export yet.', 'info');
    return;
  }
  const videoId =
    window.cutupLastTranscription?.videoId ||
    parseYouTubeVideoIdCanonical(getCurrentUrl?.() || '') ||
    null;
  downloadSRTFile(`${body}${CUTUP_SRT_ATTRIBUTION}`, videoId ? `${videoId}-clean` : 'clean');
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
  const bindTranslate = (btnId, handler) => {
    const btn = document.getElementById(btnId);
    if (!btn || btn.dataset.cutupTranslateBound === '1') return;
    btn.dataset.cutupTranslateBound = '1';
    btn.addEventListener('click', async () => {
      console.log('[translate-click]', { button: btnId });
      const sessionId = checkLogin({ pendingType: 'fulltext', payload: { mode: 'translate' } });
      if (!sessionId) return;
      if (!cutupRequirePermission('canTranslate')) return;
      const originalLanguage = window.cutupDetectedSourceLanguage || 'auto';
      await handler(sessionId, originalLanguage);
    });
  };
  bindTranslate('translateFulltextBtn', translateFulltextContent);
  bindTranslate('translateSummaryBtn', translateSummaryContent);
  bindTranslate('translateSrtBtn', translateSrtContent);
}

// Translate fulltext content
async function translateFulltextContent(sessionId, originalLanguage) {
  console.log('[translate-start]', { kind: 'fulltext' });
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
    const stableSid = sessionId || getCutupSessionId();
    const fulltext = getStoredTranscriptText();
    console.log('[translate-payload]', {
      kind: 'fulltext',
      targetLanguage,
      sourceLanguage: originalLanguage || 'auto',
      textChars: fulltext.length
    });
    if (!fulltext) {
      const e = new Error('No transcript available. Generate subtitles first, then translate.');
      e.errorCode = 'TRANSCRIPT_MISSING';
      throw e;
    }

    const srtPayload = buildPseudoSrtFromPlainText(fulltext);
    if (!srtPayload) {
      const e = new Error('Invalid transcript payload. Please regenerate this output and try again.');
      e.errorCode = 'INVALID_TRANSCRIPT_PAYLOAD';
      throw e;
    }

    console.log('[translate-api-request]', { route: 'translate-srt', kind: 'fulltext', srtChars: srtPayload.length });
    const data = await fetchTranslateSrtApi({
      srtContent: srtPayload,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(originalLanguage),
      metadata: getTranslationMetadata('transcript')
    }, stableSid);
    console.log('[translate-api-response]', { kind: 'fulltext', segmentCount: data.segmentCount, targetLanguage: data.targetLanguage });
    const translatedText = extractPlainTextFromTranslatedSrt(data.srtContent);
    
    const fulltextEl = document.getElementById('fulltext');
    if (fulltextEl) {
      fulltextEl.textContent = translatedText;
    }
    console.log('[translate-render]', { kind: 'fulltext', chars: translatedText.length });
    try {
      console.log(
        '[translation-flow]',
        JSON.stringify({
          reusedExistingTranscript: true,
          reusedTranscriptId: window.cutupLastTranscription?.cacheKey || null,
          reExtractionTriggered: false,
          quotaIncremented: false
        })
      );
    } catch (_e) {
      /* ignore */
    }
    if (stableSid) setCutupSession(stableSid, 'translate_fulltext_success');
    requestPipelineFeedback('translation', { kind: 'fulltext', targetLanguage, contextKey: `fulltext_${targetLanguage}` });
  } catch (error) {
    console.error('[translate-error]', { kind: 'fulltext', message: error?.message, code: error?.errorCode });
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Translate';
    }
  }
}

// Translate summary content
async function translateSummaryContent(sessionId, originalLanguage) {
  console.log('[translate-start]', { kind: 'summary' });
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
    const stableSid = sessionId || getCutupSessionId();
    const summary = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary?.summary || '');
    console.log('[translate-payload]', { kind: 'summary', targetLanguage, summaryChars: summary.length });
    if (!summary) {
      const e = new Error('No transcript available. Generate subtitles first, then translate.');
      e.errorCode = 'TRANSCRIPT_MISSING';
      throw e;
    }

    const srtPayload = buildPseudoSrtFromPlainText(summary);
    console.log('[translate-api-request]', { route: 'translate-srt', kind: 'summary', srtChars: srtPayload.length });
    const data = await fetchTranslateSrtApi({
      srtContent: srtPayload,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(originalLanguage),
      metadata: getTranslationMetadata('summary')
    }, stableSid);
    console.log('[translate-api-response]', { kind: 'summary', segmentCount: data.segmentCount });
    const translatedText = extractPlainTextFromTranslatedSrt(data.srtContent);
    
    // Format translated summary
    const paragraphs = translatedText.split(/\n\s*\n/).filter(p => p.trim());
    const formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
    
    const summaryTextEl = document.getElementById('summaryText');
    if (summaryTextEl) {
      summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">No summary available</p>';
    }
    if (stableSid) setCutupSession(stableSid, 'translate_summary_success');
    console.log('[translate-render]', { kind: 'summary', chars: translatedText.length });
    requestPipelineFeedback('translation', { kind: 'summary', targetLanguage, contextKey: `summary_${targetLanguage}` });
  } catch (error) {
    console.error('[translate-error]', { kind: 'summary', message: error?.message, code: error?.errorCode });
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 Translate';
    }
  }
}

// Translate SRT content
async function translateSrtContent(sessionId, originalLanguage) {
  console.log('[translate-start]', { kind: 'srt' });
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
    const stableSid = sessionId || getCutupSessionId();
    const srtContent =
      window.CutupSubtitleVersions?.versions?.original?.srtContent ||
      getStoredSrtContent();
    console.log('[translate-payload]', { kind: 'srt', targetLanguage, srtChars: srtContent.length });
    if (!srtContent) {
      const e = new Error('No transcript available. Generate subtitles first, then translate.');
      e.errorCode = 'TRANSCRIPT_MISSING';
      throw e;
    }

    console.log('[translate-api-request]', { route: 'translate-srt', kind: 'srt', srtChars: srtContent.length });
    const data = await fetchTranslateSrtApi({
      srtContent,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(originalLanguage),
      metadata: getTranslationMetadata('srt')
    }, stableSid);
    console.log('[translate-api-response]', { kind: 'srt', segmentCount: data.segmentCount });
    const translatedSrt = stripSrtForTranslation(data.srtContent);
    const translatedSegments = normalizeSegmentsForDisplay(
      Array.isArray(data.segments) && data.segments.length
        ? data.segments
        : parseSRTToSegments(translatedSrt)
    );

    if (data.segmentTimingLineage) {
      window.cutupSegmentTimingLineage = data.segmentTimingLineage;
    }
    window.CutupWhisperTimingTrace?.recordWhisperTimingStage?.('after_translate_api', translatedSegments, {
      targetLanguage
    });

    if (window.CutupSubtitleVersions) {
      window.CutupSubtitleVersions.registerTranslation(targetLanguage, {
        srtContent: translatedSrt,
        segments: translatedSegments
      });
    } else {
      window.currentSrtContent = translatedSrt;
      window.cutupSourceSegments = cloneSourceSegments(translatedSegments);
    }

    const srtPreviewEl = document.getElementById('srtPreview');
    if (srtPreviewEl) {
      srtPreviewEl.textContent = `${translatedSrt}${CUTUP_SRT_ATTRIBUTION}`;
    }
    syncSrtRawPanel();
    refreshCutupSubtitleStyles();
    if (window.CutupViralExport?.refreshExportButton) {
      window.CutupViralExport.refreshExportButton();
    }
    const langName = getLanguageName(targetLanguage);
    showMessage(`✓ ${langName} subtitles ready`, 'success');
    console.log('[translate-render]', { kind: 'srt', chars: translatedSrt.length, targetLanguage });
    if (stableSid) setCutupSession(stableSid, 'translate_srt_success');
    window.CutupWorkspaceAutosave?.scheduleSave?.();
    requestPipelineFeedback('translation', { kind: 'srt', targetLanguage, contextKey: `srt_${targetLanguage}` });
  } catch (error) {
    console.error('[translate-error]', { kind: 'srt', message: error?.message, code: error?.errorCode });
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
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

function switchPlatform(platform, options = {}) {
  const { preserveCurrentValue = false, carriedUrl = '' } = options || {};
  const currentValue = preserveCurrentValue ? getCurrentUrl() : '';
  currentPlatform = platform;
  window.CutupApp.activePlatform = platform;
  
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
      if (carriedUrl) {
        urlInput.value = carriedUrl;
      } else if (preserveCurrentValue && currentValue) {
        urlInput.value = currentValue;
      } else {
        urlInput.value = '';
      }
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
  
  const downloadCleanSrtBtn = document.getElementById('downloadCleanSrtBtn');
  if (downloadCleanSrtBtn && downloadCleanSrtBtn.dataset.cutupBound !== '1') {
    downloadCleanSrtBtn.dataset.cutupBound = '1';
    downloadCleanSrtBtn.addEventListener('click', () => downloadCleanSrtFile());
  }

  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  if (downloadSrtBtn) {
    downloadSrtBtn.addEventListener('click', () => downloadCleanSrtFile());
  }
}

// Download as TXT
function downloadAsTxt(content, filename, extension = 'txt') {
  if (!cutupRequirePermission('canExportTxt')) return;
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
    if (!cutupRequirePermission('canExportDocx')) return;
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
    const srtPayload = buildPseudoSrtFromPlainText(summaryText);
    const data = await fetchTranslateSrtApi({
      srtContent: srtPayload,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(
        originalLanguage || window.cutupDetectedSourceLanguage
      ),
      metadata: getTranslationMetadata('summary')
    }, sessionId);
    const translatedText = extractPlainTextFromTranslatedSrt(data.srtContent);
    document.getElementById('summaryTextMain').textContent = translatedText;
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
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
    const srtPayload = buildPseudoSrtFromPlainText(window.originalFullText || '');
    const data = await fetchTranslateSrtApi({
      srtContent: srtPayload,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(
        originalLanguage || window.cutupDetectedSourceLanguage
      ),
      metadata: getTranslationMetadata('transcript')
    }, sessionId);
    const translatedText = extractPlainTextFromTranslatedSrt(data.srtContent);
    document.getElementById('fullTextMain').textContent = translatedText;
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
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
  clearProgressBarFailureState();
  clearPipelineRetryUi();

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
    } else if (elapsed >= progressEstimatedDuration && progressCurrentPercent < progressTargetPercent - 1) {
      // Extraction/transcription still running after estimate — creep instead of freezing
      progressCurrentPercent = Math.min(progressTargetPercent - 1, progressCurrentPercent + 0.12);
    }

    if (progressStatusTextAt50 && progressTitle && progressCurrentPercent >= midPoint) {
      if (progressTitle.textContent !== progressStatusTextAt50) {
        progressTitle.textContent = progressStatusTextAt50;
        progressStatusText = progressStatusTextAt50;
      }
    }

    updateProgressBar(0, 0, progressCurrentPercent, progressStatusText);
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

// Hide progress bar (skipped while progress-failed — user dismisses via Retry or new run)
function hideProgressBar() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  if (progressAnimateToFinalInterval) {
    clearInterval(progressAnimateToFinalInterval);
    progressAnimateToFinalInterval = null;
  }

  const progressContainer = document.getElementById('downloadProgressContainer');
  if (progressContainer?.classList.contains('progress-failed')) {
    return;
  }

  progressStartTime = null;
  progressEstimatedDuration = null;
  progressCurrentPercent = 0;
  progressTargetPercent = 0;
  progressStatusText = '';
  progressStatusTextAt50 = null;

  if (progressContainer) {
    progressContainer._hideT = setTimeout(() => {
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

const UPLOAD_MEDIA_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'webm',
  'mp4',
  'mov',
  'mkv',
  'aac',
  'flac',
  'mpeg',
  'mpga'
]);

function isAllowedUploadFile(file) {
  if (!file) return false;
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return true;
  const ext = String(file.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return ext ? UPLOAD_MEDIA_EXTENSIONS.has(ext) : false;
}

function cutupOpenPendingUploadDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(CUTUP_PENDING_UPLOAD_DB_NAME, CUTUP_PENDING_UPLOAD_DB_VERSION);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
    };
  });
}

async function cutupSavePendingUploadFile(file, meta = {}) {
  if (!(file instanceof File)) return;
  const db = await cutupOpenPendingUploadDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    store.put(
      {
        blob: file,
        name: file.name,
        type: file.type,
        lastModified: file.lastModified,
        size: file.size,
        meta: {
          mode: meta.mode || 'fulltext',
          activeTab: meta.activeTab || (meta.mode === 'subtitle' ? 'srt' : 'fulltext'),
          savedAt: Date.now()
        }
      },
      CUTUP_PENDING_UPLOAD_RECORD_ID
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('indexedDB write failed'));
    };
  });
}

async function cutupLoadPendingUploadFile() {
  try {
    const db = await cutupOpenPendingUploadDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(CUTUP_PENDING_UPLOAD_RECORD_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
    if (!record?.blob) return null;
    const file = new File([record.blob], record.name || 'upload', {
      type: record.type || '',
      lastModified: record.lastModified || Date.now()
    });
    return { file, meta: record.meta || {} };
  } catch (err) {
    console.warn('[upload] pending file load failed:', err?.message || err);
    return null;
  }
}

async function cutupClearPendingUploadFile() {
  try {
    const db = await cutupOpenPendingUploadDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(CUTUP_PENDING_UPLOAD_RECORD_ID);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (_e) {
    /* ignore */
  }
}

function cutupBindFileToAudioInput(file) {
  if (!audioFileInput || !(file instanceof File)) return;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    audioFileInput.files = dt.files;
  } catch (_e) {
    /* ignore — window.selectedFile still holds the File */
  }
}

async function cutupResumePendingUploadAfterLogin(payload = {}) {
  if (!cutupIsLoggedIn()) return false;
  const activeTab =
    payload.activeTab || (payload.mode === 'subtitle' || payload.mode === 'srt' ? 'srt' : 'fulltext');
  let file = window.selectedFile;
  if (!(file instanceof File)) {
    const loaded = await cutupLoadPendingUploadFile();
    if (loaded?.file) {
      file = loaded.file;
      window.selectedFile = file;
    }
  }
  if (!(file instanceof File)) return false;

  retentionSwitchPlatformWithUrl('audiofile', '');
  cutupBindFileToAudioInput(file);
  rememberSourceVideoFile(file);
  updateAudioFileSelectedLabel(file);
  checkInput();

  await startUploadFilePipeline(file);
  await cutupClearPendingUploadFile();
  return true;
}

/**
 * Same auth gate as social links: overlay + Google OAuth before upload processing.
 * @returns {Promise<boolean>} true when user may continue
 */
async function cutupGateUploadAuth(file = null, meta = {}) {
  if (cutupIsLoggedIn()) return true;
  if (file instanceof File) {
    window.selectedFile = file;
    rememberSourceVideoFile(file);
    cutupBindFileToAudioInput(file);
    updateAudioFileSelectedLabel(file);
    if (currentPlatform !== 'audiofile') switchPlatform('audiofile');
    checkInput();
    try {
      await cutupSavePendingUploadFile(file, meta);
    } catch (err) {
      console.warn('[upload] could not persist file before login:', err?.message || err);
    }
  } else if (currentPlatform !== 'audiofile') {
    switchPlatform('audiofile');
  }
  const activeTab = meta.activeTab || (meta.mode === 'subtitle' ? 'srt' : 'fulltext');
  try {
    await cutupTriggerLoginForPendingAction('resume_upload_tab', {
      platform: 'audiofile',
      fileFlow: true,
      mode: meta.mode || 'fulltext',
      activeTab
    });
  } catch (_e) {
    cutupClearPendingAction();
    hideAuthTransition();
    showMessage('Sign in to transcribe uploads.', 'error');
  }
  return false;
}

function updateAudioFileSelectedLabel(file) {
  const el = document.getElementById('audioFileSelectedName');
  if (!el) return;
  if (!file) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const mb = (file.size / 1024 / 1024).toFixed(1);
  const kind = String(file.type || '').startsWith('video/') ? 'Video' : 'Audio';
  el.textContent = `${kind}: ${file.name} (${mb} MB)`;
  el.hidden = false;
}

function initUploadFileTab() {
  audioFileInput = document.getElementById('audioFileInput');
  if (!audioFileInput || audioFileInput.dataset.cutupBound === '1') return;
  audioFileInput.dataset.cutupBound = '1';

  const chooseBtn = document.getElementById('audioFileChooseBtn');
  const dropZone = document.getElementById('audioFileDropZone');

  const openPicker = () => {
    if (currentPlatform !== 'audiofile') switchPlatform('audiofile');
    audioFileInput.click();
  };

  if (chooseBtn && chooseBtn.dataset.cutupBound !== '1') {
    chooseBtn.dataset.cutupBound = '1';
    chooseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openPicker();
    });
    chooseBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPicker();
      }
    });
  }

  audioFileInput.addEventListener('change', (ev) => {
    void handleFileSelect(ev);
  });

  if (dropZone) {
    ['dragenter', 'dragover'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('is-dragover');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      void confirmSelectedUploadFile(file);
    });
  }
}

/**
 * Validate + stage file after picker OK or drop. Guests are sent to Google login; processing resumes after return.
 * @returns {Promise<boolean>}
 */
async function stageSelectedUploadFile(file) {
  if (!file) return false;

  const maxSize = 100 * 1024 * 1024;
  if (file.size > maxSize) {
    showMessage(
      `File is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum allowed is ${maxSize / 1024 / 1024} MB.`,
      'error'
    );
    if (audioFileInput) audioFileInput.value = '';
    updateAudioFileSelectedLabel(null);
    checkInput();
    return false;
  }

  if (!isAllowedUploadFile(file)) {
    showMessage('Please select an audio or video file (MP3, WAV, M4A, MP4, MOV…).', 'error');
    if (audioFileInput) audioFileInput.value = '';
    updateAudioFileSelectedLabel(null);
    checkInput();
    return false;
  }

  window.selectedFile = file;
  rememberSourceVideoFile(file);
  if (currentPlatform !== 'audiofile') switchPlatform('audiofile');
  cutupBindFileToAudioInput(file);
  updateAudioFileSelectedLabel(file);
  checkInput();
  return true;
}

/** After native file dialog OK: login if needed, else auto-run one transcription for SRT + transcript. */
async function confirmSelectedUploadFile(file, meta = {}) {
  if (!(await stageSelectedUploadFile(file))) return;
  const pendingMeta = {
    mode: 'subtitle',
    activeTab: 'srt',
    ...meta
  };
  if (!cutupIsLoggedIn()) {
    await cutupGateUploadAuth(file, pendingMeta);
    return;
  }
  await startUploadFilePipeline(file);
}

async function handleFileSelect(e) {
  const file = e?.target?.files?.[0];
  if (!file) {
    updateAudioFileSelectedLabel(null);
    checkInput();
    return;
  }
  await confirmSelectedUploadFile(file, { mode: 'subtitle', activeTab: 'srt' });
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
  const value = input ? input.value.trim() : '';
  window.CutupApp.currentUrl = value;
  return value;
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
    const detected = detectPlatform(url);
    if (detected && detected !== currentPlatform && detected !== 'audiofile') {
      switchPlatform(detected, { carriedUrl: url });
      return;
    }
    if (!detected) {
      // URL is not from any known platform
      if (isInstagramStoryUrl(url)) {
        showMessage(mapErrorCodeToUserMessage('INSTAGRAM_STORY_UNSUPPORTED'), 'error');
      } else if (/instagram\.com/i.test(url)) {
        showMessage('Please paste a direct Instagram Reel, Post, or Video link.', 'error');
      } else {
        const platformName = getPlatformName(currentPlatform);
        showMessage(`Invalid link. Please enter a ${platformName} URL. Example: ${getExampleUrl(currentPlatform)}`, 'error');
      }
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
    const srtPayload = getStoredSrtContent() || stripSrtForTranslation(window.originalSrtContent || '');
    if (!srtPayload) {
      throw new Error('No transcript available. Generate subtitles first, then translate.');
    }
    const data = await fetchTranslateSrtApi({
      srtContent: srtPayload,
      targetLanguage,
      sourceLanguage: normalizeSourceLanguageForApi(
        window.originalSrtLanguage || window.cutupDetectedSourceLanguage
      ),
      metadata: getTranslationMetadata('srt')
    }, sessionId);
    const translatedSrt = stripSrtForTranslation(data.srtContent);
    window.currentSrtContent = translatedSrt;
    document.getElementById('srtPreviewMain').textContent = `${translatedSrt}${CUTUP_SRT_ATTRIBUTION}`;
    
  } catch (error) {
    console.error('Error:', error);
    reportClientError('translate', error);
    showMessage(mapTranslateErrorMessage(error), 'error');
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

// Features slider for mobile (native scroll-snap, no translateX math)
let mobileFeaturesState = null;
let featureAutoplayTimer = null;

function initFeaturesSlider() {
  const featuresGrid = document.querySelector('#features .features-grid');
  if (!featuresGrid || window.innerWidth > 768) return;
  if (featuresGrid.dataset.sliderInitialized === '1') return;

  const cards = Array.from(featuresGrid.children).filter((el) => el.classList?.contains('feature-card'));
  if (!cards.length) return;

  const rail = document.createElement('div');
  rail.className = 'features-slider-mobile';
  const track = document.createElement('div');
  track.className = 'features-track';

  cards.forEach((card) => {
    // Neutralize global observer inline styles on cards inside slider.
    card.style.opacity = '1';
    card.style.transform = 'none';
    card.style.transition = 'none';
    track.appendChild(card);
  });

  rail.appendChild(track);
  featuresGrid.innerHTML = '';
  featuresGrid.appendChild(rail);

  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'features-dots';
  const dots = cards.map((_, i) => {
    const dot = document.createElement('div');
    dot.className = `features-dot ${i === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => {
      track.scrollTo({ left: track.clientWidth * i, behavior: 'smooth' });
    });
    dotsContainer.appendChild(dot);
    return dot;
  });
  featuresGrid.appendChild(dotsContainer);

  let scrollRaf = 0;
  function syncDotsFromScroll() {
    scrollRaf = 0;
    const width = track.clientWidth || 1;
    const index = Math.max(0, Math.min(dots.length - 1, Math.round(track.scrollLeft / width)));
    dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
  }
  track.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(syncDotsFromScroll);
  }, { passive: true });

  function getActiveIndex() {
    const width = track.clientWidth || 1;
    return Math.max(0, Math.min(dots.length - 1, Math.round(track.scrollLeft / width)));
  }

  function queueAutoplay(delayMs) {
    if (featureAutoplayTimer) clearTimeout(featureAutoplayTimer);
    featureAutoplayTimer = window.setTimeout(() => {
      const idx = getActiveIndex();
      const width = track.clientWidth || 1;
      if (idx >= dots.length - 1) {
        // Pause on last slide, then jump back to first.
        track.scrollTo({ left: 0, behavior: 'smooth' });
        queueAutoplay(2200);
        return;
      }
      track.scrollTo({ left: width * (idx + 1), behavior: 'smooth' });
      queueAutoplay(1800);
    }, delayMs);
  }

  // Keep loop smooth after manual swipe/dot interactions.
  track.addEventListener('scrollend', () => {
    queueAutoplay(1800);
  });
  track.addEventListener('touchend', () => {
    queueAutoplay(1800);
  }, { passive: true });

  queueAutoplay(1800);

  mobileFeaturesState = { track, dots };
  featuresGrid.dataset.sliderInitialized = '1';
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  initFeaturesSlider();
});

// Reinitialize on resize
window.addEventListener('resize', () => {
  if (window.innerWidth <= 768) {
    initFeaturesSlider();
    if (mobileFeaturesState?.track) {
      const idx = Math.round((mobileFeaturesState.track.scrollLeft || 0) / (mobileFeaturesState.track.clientWidth || 1));
      mobileFeaturesState.track.scrollTo({ left: (mobileFeaturesState.track.clientWidth || 0) * idx, behavior: 'auto' });
    }
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
  setupRetentionInteractions();
  setupMonetizationPaywallUi();
});

