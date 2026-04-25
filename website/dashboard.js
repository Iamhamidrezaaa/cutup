const API_BASE_URL = 'https://cutup.shop';
const AVG_VIDEO_MINUTES = 7;

let currentSession = null;
let currentUser = null;
let subscriptionInfo = null;
let plansCache = [];
let historyCache = [];
let savedOutputsCache = [];

function formatDateTime(dateValue) {
  if (!dateValue) return '—';
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function safeText(value, fallback = '—') {
  const str = String(value ?? '').trim();
  return str || fallback;
}

function videosUsedEstimate(usedMinutes) {
  return Math.max(0, Math.ceil((Number(usedMinutes) || 0) / AVG_VIDEO_MINUTES));
}

function videosRemainingEstimate(usedMinutes, limitMinutes) {
  const remMin = Math.max(0, (Number(limitMinutes) || 0) - (Number(usedMinutes) || 0));
  return Math.floor(remMin / AVG_VIDEO_MINUTES);
}

function showDashboardBanner(message, variant = 'info') {
  let el = document.getElementById('dashboardBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dashboardBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.textContent = message;
  el.className = `dashboard-banner dashboard-banner--${variant}`;
  el.hidden = false;
  clearTimeout(el._hideT);
  el._hideT = setTimeout(() => {
    el.hidden = true;
  }, 9000);
}

function showDashboardLevelError(message) {
  const welcomeMessage = document.getElementById('welcomeMessage');
  if (welcomeMessage) {
    welcomeMessage.innerHTML = `<p class="dashboard-empty-note">${message}</p>`;
    welcomeMessage.classList.add('dashboard-error-surface');
  }
}

function generateAvatar(text) {
  const name = safeText(text, 'User');
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=128&background=6366f1&color=fff&bold=true`;
}

async function apiGet(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function getPlanVideoEstimate(monthlyLimitMinutes) {
  const videos = Math.max(1, Math.round((Number(monthlyLimitMinutes) || 0) / AVG_VIDEO_MINUTES));
  return `~${videos} videos / month`;
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.dashboard-section');
  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.dataset.section;
      navItems.forEach((n) => n.classList.remove('active'));
      sections.forEach((s) => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`${target}-section`)?.classList.add('active');
    });
  });

  document.getElementById('userProfileLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('.nav-item[data-section="overview"]')?.click();
  });
}

function setupEventListeners() {
  document.getElementById('logoutBtnHeader')?.addEventListener('click', async () => {
    if (currentSession) {
      try {
        await fetch(`${API_BASE_URL}/api/auth?action=logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': currentSession
          },
          body: JSON.stringify({ session: currentSession })
        });
      } catch (_e) {
        // noop
      }
    }
    localStorage.removeItem('cutup_session');
    window.location.href = 'index.html';
  });
}

function getSessionFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const authSuccess = params.get('auth');
  const sessionId = params.get('session');
  const paymentResult = params.get('payment');
  if (authSuccess === 'success' && sessionId) {
    localStorage.setItem('cutup_session', sessionId);
  }

  if (paymentResult === 'success') {
    setTimeout(() => showDashboardBanner('Payment received. We refreshed your plan status.', 'success'), 250);
  } else if (paymentResult === 'cancel') {
    setTimeout(() => showDashboardBanner('Checkout was cancelled. No charge was made.', 'neutral'), 250);
  }

  const activeSession = sessionId || localStorage.getItem('cutup_session');
  if (paymentResult || authSuccess === 'success') {
    const cleanQuery = activeSession ? `?session=${encodeURIComponent(activeSession)}` : '';
    window.history.replaceState({}, document.title, `${window.location.pathname}${cleanQuery}`);
  }
  return activeSession;
}

async function loadUserProfile() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/auth?action=me&session=${currentSession}`);
  if (!response.ok || !data.user) {
    throw new Error('auth_failed');
  }
  currentUser = data.user;
  const avatar = document.getElementById('userAvatarHeader');
  if (avatar) {
    avatar.src = currentUser.picture || generateAvatar(currentUser.name || currentUser.email);
  }
  document.getElementById('userNameHeader').textContent = safeText(currentUser.name, currentUser.email);
  document.getElementById('userEmailHeader').textContent = safeText(currentUser.email, '');
  document.getElementById('welcomeMessage').textContent = `Welcome back, ${safeText(currentUser.name, currentUser.email)}.`;
  const identityStrip = document.getElementById('identityStrip');
  if (identityStrip) {
    identityStrip.innerHTML = `
      <div><strong>Name:</strong> ${safeText(currentUser.name, currentUser.email)}</div>
      <div><strong>Email:</strong> ${safeText(currentUser.email)}</div>
      <div><strong>Session:</strong> Active</div>
    `;
  }
}

async function loadSubscriptionInfo() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=info&session=${currentSession}`, {
    headers: { 'X-Session-Id': currentSession }
  });
  if (!response.ok) {
    throw new Error('subscription_failed');
  }
  subscriptionInfo = data;
}

async function loadUsageHistory() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=history&session=${currentSession}&limit=60`, {
    headers: { 'X-Session-Id': currentSession }
  });
  historyCache = response.ok ? (data.history || []) : [];
}

async function loadPlans() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=plans`);
  plansCache = response.ok ? (data.plans || []) : [];
}

async function loadSavedOutputs() {
  const { response, data } = await apiGet(`${API_BASE_URL}/api/subscription?action=savedOutputs&session=${currentSession}&limit=100`, {
    headers: { 'X-Session-Id': currentSession }
  });
  savedOutputsCache = response.ok ? (data.outputs || []) : [];
}

function renderOverview() {
  if (!subscriptionInfo) return;
  const usage = subscriptionInfo.usage || {};
  const monthlyMinutes = usage.monthly?.minutes || 0;
  const monthlyLimit = usage.monthlyLimit || 0;
  const remainingVideos = subscriptionInfo.plan === 'advanced'
    ? 'Fair use'
    : `~${videosRemainingEstimate(monthlyMinutes, monthlyLimit)}`;
  const audioCount = usage.downloads?.audio?.count || 0;
  const audioLimit = usage.downloads?.audio?.limit;
  const videoCount = usage.downloads?.video?.count || 0;
  const videoLimit = usage.downloads?.video?.limit;
  const renewal = subscriptionInfo.subscription?.endDate
    ? formatDateTime(subscriptionInfo.subscription.endDate)
    : 'No scheduled renewal';
  const dailyMinutes = usage.daily?.minutes || 0;
  const dailyLimit = usage.dailyLimit;

  document.getElementById('remainingVideos').textContent = remainingVideos;
  document.getElementById('audioDownloadUsage').textContent = `${audioCount}${audioLimit != null ? `/${audioLimit}` : ''}`;
  document.getElementById('videoDownloadUsage').textContent = `${videoCount}${videoLimit != null ? `/${videoLimit}` : ''}`;

  const currentPlanCard = document.getElementById('currentPlanCard');
  if (currentPlanCard) {
    const showUpgrade = ['free', 'starter'].includes((subscriptionInfo.plan || '').toLowerCase());
    currentPlanCard.innerHTML = `
      <h2>Current plan</h2>
      <p><strong>${safeText(subscriptionInfo.planName, 'Free')}</strong> · ${subscriptionInfo.subscription?.billingPeriod || 'monthly'}</p>
      <p>Status: <strong>Active</strong></p>
      <p>Included usage: <strong>${getPlanVideoEstimate(monthlyLimit)}</strong> (based on ~7 mins/video)</p>
      <p>Audio downloads: <strong>${audioCount}${audioLimit != null ? `/${audioLimit}` : ' (unlimited)'}</strong></p>
      <p>Video downloads: <strong>${videoCount}${videoLimit != null ? `/${videoLimit}` : ' (unlimited)'}</strong></p>
      <p>Renewal/expiry: <strong>${renewal}</strong></p>
      ${dailyLimit != null ? `<p>Daily free limit: <strong>${dailyMinutes}/${dailyLimit} mins</strong></p>` : ''}
      ${showUpgrade ? `<button class="plan-btn" id="overviewUpgradeBtn">Upgrade plan</button>` : ''}
    `;
    document.getElementById('overviewUpgradeBtn')?.addEventListener('click', () => {
      document.querySelector('.nav-item[data-section="subscription"]')?.click();
    });
  }
}

function formatHistoryType(type) {
  switch (type) {
    case 'transcription': return 'Transcription';
    case 'summarization': return 'Summarization';
    case 'srt': return 'SRT';
    case 'downloadAudio': return 'Download audio';
    case 'downloadVideo': return 'Download video';
    case 'download': return 'Download';
    default: return type || 'Activity';
  }
}

function formatPlatformLabel(platform, sourceUrl = '') {
  const p = String(platform || '').toLowerCase();
  if (p.includes('youtube')) return 'YouTube';
  if (p.includes('instagram')) return 'Instagram';
  if (p.includes('tiktok')) return 'TikTok';
  if (p.includes('upload') || p.includes('audiofile')) return 'Upload';
  if (sourceUrl.includes('youtube')) return 'YouTube';
  if (sourceUrl.includes('instagram')) return 'Instagram';
  if (sourceUrl.includes('tiktok')) return 'TikTok';
  return 'Unknown';
}

function fallbackTitle(platform, sourceUrl = '') {
  const p = formatPlatformLabel(platform, sourceUrl);
  if (p === 'Instagram') return 'Instagram reel';
  if (p === 'TikTok') return 'TikTok video';
  if (p === 'Upload') return 'Uploaded file';
  if (p === 'YouTube') return 'YouTube video';
  return 'Generated output';
}

function renderUsageSection() {
  const target = document.getElementById('usageDetails');
  if (!target || !subscriptionInfo) return;
  const usage = subscriptionInfo.usage || {};
  const monthlyMinutes = usage.monthly?.minutes || 0;
  const monthlyLimit = usage.monthlyLimit || 0;
  const daily = usage.daily || {};
  const dailyLabel = usage.dailyLimit != null
    ? `${daily.minutes || 0}/${usage.dailyLimit} minutes today`
    : `${daily.minutes || 0} minutes today`;

  const items = historyCache.slice(0, 20).map((item) => {
    const normalizedType = item.type === 'download'
      ? (item.metadata?.kind === 'audio' ? 'downloadAudio' : item.metadata?.kind === 'video' ? 'downloadVideo' : 'download')
      : item.type;
    const sourceUrl = safeText(item.metadata?.sourceUrl || item.metadata?.url, '');
    const platformLabel = formatPlatformLabel(item.metadata?.platform || item.metadata?.source, sourceUrl);
    const title = safeText(
      item.metadata?.title || item.metadata?.videoTitle || item.metadata?.filename,
      fallbackTitle(platformLabel, sourceUrl)
    );
    const platform = platformLabel !== 'Unknown' ? ` · ${platformLabel}` : '';
    const minutesNote = Number(item.minutes) > 0 ? ` · ${Number(item.minutes).toFixed(1)} min` : '';
    const status = safeText(item.metadata?.status, 'completed');
    return `
      <div class="history-item">
        <details>
          <summary>
            <div class="history-content">
              <div class="history-title">${title}</div>
              <div class="history-meta">
                <span class="history-type">${formatHistoryType(normalizedType)}</span>
                <span>${formatDateTime(item.date)}${platform}${minutesNote}</span>
              </div>
            </div>
          </summary>
          <div class="history-details">
            <div><strong>Platform:</strong> ${platformLabel}</div>
            <div><strong>Type:</strong> ${formatHistoryType(normalizedType)}</div>
            <div><strong>Date:</strong> ${formatDateTime(item.date)}</div>
            <div><strong>Duration:</strong> ${Number(item.minutes) > 0 ? `${Number(item.minutes).toFixed(1)} min` : '—'}</div>
            <div><strong>Title:</strong> ${title}</div>
            <div><strong>Source URL:</strong> ${sourceUrl || '—'}</div>
            <div><strong>Status:</strong> ${status}</div>
          </div>
        </details>
      </div>
    `;
  }).join('');

  target.innerHTML = `
    <div class="usage-summary">
      <h3>Usage overview</h3>
      <div class="usage-stats">
        <div class="usage-stat-item"><span class="usage-stat-label">Videos processed</span><span class="usage-stat-value">~${videosUsedEstimate(monthlyMinutes)}</span></div>
        <div class="usage-stat-item"><span class="usage-stat-label">Videos remaining</span><span class="usage-stat-value">${subscriptionInfo.plan === 'advanced' ? 'Fair use' : `~${videosRemainingEstimate(monthlyMinutes, monthlyLimit)}`}</span></div>
        <div class="usage-stat-item"><span class="usage-stat-label">Daily usage</span><span class="usage-stat-value">${dailyLabel}</span></div>
        <div class="usage-stat-item"><span class="usage-stat-label">Audio downloads</span><span class="usage-stat-value">${usage.downloads?.audio?.count || 0}${usage.downloads?.audio?.limit != null ? `/${usage.downloads.audio.limit}` : ''}</span></div>
        <div class="usage-stat-item"><span class="usage-stat-label">Video downloads</span><span class="usage-stat-value">${usage.downloads?.video?.count || 0}${usage.downloads?.video?.limit != null ? `/${usage.downloads.video.limit}` : ''}</span></div>
      </div>
    </div>
    <div class="usage-history">
      <h3>Recent activity</h3>
      ${items || '<p class="dashboard-empty-note">No recent activity yet.</p>'}
    </div>
  `;
}

function renderSavedOutputs() {
  const target = document.getElementById('savedOutputs');
  if (!target) return;
  if (!savedOutputsCache.length) {
    target.innerHTML = `
      <div class="empty-state">
        <h3>Saved outputs</h3>
        <p class="dashboard-empty-note">Saved outputs are coming soon. Your generated transcripts, summaries, and subtitle files will appear here.</p>
      </div>
    `;
    return;
  }

  const cards = savedOutputsCache.map((item) => {
    const title = safeText(item.title, fallbackTitle(item.platform, item.sourceUrl || ''));
    const created = formatDateTime(item.createdAt);
    const typeLabel = formatHistoryType(item.type);
    const platform = formatPlatformLabel(item.platform, item.sourceUrl || '');
    const content = safeText(item.content, '');
    return `
      <article class="usage-summary">
        <h3>${title}</h3>
        <p><strong>Type:</strong> ${typeLabel} · <strong>Platform:</strong> ${platform} · <strong>Language:</strong> ${safeText(item.language, 'original')}</p>
        <p><strong>Created:</strong> ${created}</p>
        <div class="preview-upgrade-actions">
          <button class="plan-btn" data-view-output="${item.id}">View</button>
          <button class="plan-btn" data-copy-output="${item.id}">Copy</button>
          <button class="plan-btn" data-download-txt="${item.id}">Download TXT</button>
          ${item.type === 'srt' ? `<button class="plan-btn" data-download-srt="${item.id}">Download SRT</button>` : `<button class="plan-btn" data-download-docx="${item.id}">Download DOCX</button>`}
        </div>
        <details id="saved-output-view-${item.id}" style="margin-top:10px;">
          <summary>Preview</summary>
          <pre style="white-space: pre-wrap; margin-top:8px;">${content.replace(/</g, '&lt;')}</pre>
        </details>
      </article>
    `;
  }).join('');

  target.innerHTML = `
    ${cards}
  `;

  target.querySelectorAll('[data-view-output]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-view-output');
      const details = document.getElementById(`saved-output-view-${id}`);
      if (details) details.open = true;
    });
  });
  target.querySelectorAll('[data-copy-output]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-copy-output');
      const item = savedOutputsCache.find((o) => String(o.id) === String(id));
      if (!item) return;
      await navigator.clipboard.writeText(item.content || '');
      showDashboardBanner('Output copied.', 'success');
    });
  });
  target.querySelectorAll('[data-download-txt],[data-download-srt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-download-txt') || btn.getAttribute('data-download-srt');
      const item = savedOutputsCache.find((o) => String(o.id) === String(id));
      if (!item) return;
      const ext = btn.hasAttribute('data-download-srt') ? 'srt' : 'txt';
      const blob = new Blob([item.content || ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeText(item.title, 'output').replace(/\s+/g, '_')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  });
  target.querySelectorAll('[data-download-docx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-download-docx');
      const item = savedOutputsCache.find((o) => String(o.id) === String(id));
      if (!item) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/generate-docx`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': currentSession
          },
          body: JSON.stringify({ content: item.content || '', filename: safeText(item.title, 'output') })
        });
        if (!response.ok) throw new Error('docx_failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeText(item.title, 'output').replace(/\s+/g, '_')}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (_e) {
        showDashboardBanner('Could not generate DOCX for this output right now.', 'error');
      }
    });
  });
}

function renderPlansSection() {
  const subscriptionInfoEl = document.getElementById('subscriptionInfo');
  const plansGrid = document.getElementById('plansGrid');
  if (!subscriptionInfoEl || !plansGrid) return;

  const stripeReady = plansCache.some((p) => Number(p?.priceUsd?.monthly) > 0);
  const publicPlanIds = new Set(plansCache.map((p) => p.id));
  const currentPlanId = subscriptionInfo?.plan || 'free';
  const isCurrentPlanPrivate = !publicPlanIds.has(currentPlanId);
  subscriptionInfoEl.innerHTML = `
    <div class="usage-summary">
      <h3>Choose a plan</h3>
      <p class="dashboard-muted-loading">Current: <strong>${safeText(subscriptionInfo?.planName, 'Free')}</strong></p>
      ${isCurrentPlanPrivate ? '<p class="dashboard-empty-note">You are currently on a Business plan.</p>' : ''}
      ${stripeReady ? '' : '<p class="dashboard-empty-note">Payments are not available yet.</p>'}
    </div>
  `;

  const order = ['free', 'starter', 'pro', 'advanced'];
  const sortedPlans = [...plansCache].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  plansGrid.innerHTML = sortedPlans.map((plan) => {
    const isCurrent = plan.id === subscriptionInfo?.plan;
    const usd = Number(plan?.priceUsd?.monthly || 0);
    const cta = plan.id === 'starter'
      ? 'Upgrade to Starter'
      : plan.id === 'pro'
        ? 'Upgrade to Pro'
        : plan.id === 'advanced'
          ? 'Upgrade to Advanced'
          : 'Free tier';
    const disableButton = isCurrent || plan.id === 'free' || !stripeReady;
    const priceLabel = usd > 0 ? `$${usd.toFixed(2)} / month` : 'Price unavailable';
    return `
      <article class="paid-plan-card ${plan.id === 'pro' ? 'featured' : ''} ${isCurrent ? 'current-plan' : ''}">
        <div class="paid-plan-header">
          <h3 class="paid-plan-name">${safeText(plan.nameEn, plan.name || plan.id)}</h3>
          ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
        </div>
        <p class="plan-price">${priceLabel}</p>
        <ul class="plan-features">
          <li>${getPlanVideoEstimate(plan.monthlyLimit)}</li>
          <li>Audio downloads: ${plan.downloadAudioLimit != null ? plan.downloadAudioLimit : 'Unlimited'}</li>
          <li>Video downloads: ${plan.downloadVideoLimit != null ? plan.downloadVideoLimit : 'Unlimited'}</li>
        </ul>
        <button class="plan-btn" data-upgrade-plan="${plan.id}" ${disableButton ? 'disabled' : ''}>${cta}</button>
      </article>
    `;
  }).join('');

  plansGrid.querySelectorAll('button[data-upgrade-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const planId = btn.getAttribute('data-upgrade-plan');
      if (!planId || !currentSession) return;
      startStripeCheckout(planId);
    });
  });
}

function renderBillingSection() {
  const target = document.getElementById('financialInfo');
  if (!target) return;
  const subscriptionEnd = subscriptionInfo?.subscription?.endDate ? formatDateTime(subscriptionInfo.subscription.endDate) : '—';
  const stripeReady = plansCache.some((p) => Number(p?.priceUsd?.monthly) > 0);
  const paymentStatus = subscriptionInfo?.plan === 'free' ? 'No active paid subscription' : 'Active';
  target.innerHTML = `
    <div class="usage-summary">
      <h3>Billing state</h3>
      <p><strong>Plan:</strong> ${safeText(subscriptionInfo?.planName, 'Free')}</p>
      <p><strong>Billing period:</strong> ${safeText(subscriptionInfo?.subscription?.billingPeriod, 'monthly')}</p>
      <p><strong>Renewal / expiry:</strong> ${subscriptionEnd}</p>
      <p><strong>Payment status:</strong> ${paymentStatus}</p>
      ${stripeReady
        ? '<p class="dashboard-muted-loading">Use the Plans section to change your plan.</p>'
        : '<p class="dashboard-empty-note">Payments are not available yet.</p>'}
    </div>
  `;
}

async function startStripeCheckout(planKey) {
  try {
    const { response, data } = await apiGet(`${API_BASE_URL}/api/stripe/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': currentSession
      },
      body: JSON.stringify({ priceKey: planKey })
    });
    if (response.ok && data.url) {
      window.location.href = data.url;
      return;
    }
    showDashboardBanner('Payments are not available yet.', 'neutral');
  } catch (_e) {
    showDashboardBanner('Could not start payment right now. Please try again.', 'error');
  }
}

async function refreshDashboardData({ silent = false } = {}) {
  if (!silent) {
    document.getElementById('welcomeMessage').textContent = 'Refreshing your dashboard...';
  }
  try {
    await Promise.all([
      loadUserProfile(),
      loadSubscriptionInfo(),
      loadUsageHistory(),
      loadPlans(),
      loadSavedOutputs()
    ]);
    renderOverview();
    renderUsageSection();
    renderSavedOutputs();
    renderPlansSection();
    renderBillingSection();
    if (!silent) {
      document.getElementById('welcomeMessage').textContent = `Welcome back, ${safeText(currentUser?.name, currentUser?.email)}.`;
    }
  } catch (e) {
    if (e.message === 'auth_failed') {
      localStorage.removeItem('cutup_session');
      window.location.href = 'index.html';
      return;
    }
    showDashboardLevelError('Could not load dashboard data right now. Please refresh in a moment.');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  currentSession = getSessionFromLocation();
  if (!currentSession) {
    window.location.href = 'index.html';
    return;
  }
  localStorage.setItem('cutup_session', currentSession);
  setupNavigation();
  setupEventListeners();
  await refreshDashboardData();

  setInterval(() => {
    refreshDashboardData({ silent: true });
  }, 30000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDashboardData({ silent: true });
  });
  window.addEventListener('focus', () => {
    refreshDashboardData({ silent: true });
  });
});
