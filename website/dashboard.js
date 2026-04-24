// Dashboard JavaScript
const API_BASE_URL = 'https://cutup.shop';
const DASHBOARD_HISTORY_KEY = 'cutup_dashboard_history'; // Shared key for localStorage
let currentSession = null;

/** Maps backend minutes → user-facing “videos” (~5–10 min each). */
const AVG_VIDEO_MINUTES = 7;

function videosUsedEstimate(usedMinutes) {
  return Math.max(0, Math.ceil((Number(usedMinutes) || 0) / AVG_VIDEO_MINUTES));
}

function videosRemainingEstimate(usedMinutes, limitMinutes) {
  const remMin = Math.max(0, (Number(limitMinutes) || 0) - (Number(usedMinutes) || 0));
  return Math.floor(remMin / AVG_VIDEO_MINUTES);
}

function isAdvancedFairUsePlan(planId) {
  return planId === 'advanced';
}

function planValueCopy(plan) {
  const id = plan.id;
  if (id === 'starter') {
    return '~10–15 videos / month · subtitle downloads · up to 2 languages · summaries';
  }
  if (id === 'pro') {
    return '~25–35 videos / month · multilingual subtitles · faster processing · stronger exports';
  }
  if (id === 'advanced') {
    return '~80–100+ typical videos / month · priority queue · fair use · every feature';
  }
  return 'Full processing for creators and teams';
}
let currentUser = null;
let subscriptionInfo = null;
let shoppingCart = [];

function trackConversionEvent(eventName, properties = {}) {
  try {
    if (window.posthog && typeof window.posthog.capture === 'function') {
      window.posthog.capture(eventName, properties);
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, properties);
    }
  } catch (e) { /* ignore */ }
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
  }, 10000);
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Check for session from URL params (after OAuth callback)
  const urlParams = new URLSearchParams(window.location.search);
  const authSuccess = urlParams.get('auth');
  const sessionId = urlParams.get('session');
  
  if (authSuccess === 'success' && sessionId) {
    localStorage.setItem('cutup_session', sessionId);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const paymentResult = urlParams.get('payment');
  if (paymentResult === 'success') {
    trackConversionEvent('payment_success', { method: 'stripe', surface: 'dashboard_return' });
    setTimeout(() => {
      showDashboardBanner(
        'Payment received. Your plan should update within a few seconds — this page refreshes your usage automatically.',
        'success'
      );
    }, 400);
  } else if (paymentResult === 'cancel') {
    trackConversionEvent('payment_cancelled', { method: 'stripe', surface: 'dashboard_return' });
    setTimeout(() => {
      showDashboardBanner('Checkout was cancelled. You were not charged.', 'neutral');
    }, 400);
  }

  if ((paymentResult === 'success' || paymentResult === 'cancel') && sessionId) {
    const clean = `${window.location.pathname}?session=${encodeURIComponent(sessionId)}`;
    window.history.replaceState({}, document.title, clean);
  } else if (paymentResult === 'success' || paymentResult === 'cancel') {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  
  initDashboard();
});

async function initDashboard() {
  // Check for session in URL first (from OAuth callback), then localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const sessionFromUrl = urlParams.get('session');
  
  let savedSession = sessionFromUrl || localStorage.getItem('cutup_session');
  
  if (!savedSession) {
    window.location.href = 'index.html';
    return;
  }
  
  currentSession = savedSession;
  // Save to localStorage for future use
  if (sessionFromUrl) {
    localStorage.setItem('cutup_session', savedSession);
  }
  
  // Load cart
  loadCart();
  
  // Load user profile
  await loadUserProfile();
  
  // Load subscription info
  await loadSubscriptionInfo();
  
  // Dashboard is now backend-driven, no need for localStorage update
  
  // Setup navigation
  setupNavigation();
  
  // Setup event listeners
  setupEventListeners();
  
  // Load sections
  loadCartSection();
  loadFinancialSection();
  loadSupportSection();
  
  // Auto-refresh subscription info every 5 seconds (backend-driven)
  setInterval(async () => {
    await loadSubscriptionInfo();
  }, 5000);
  
  // Refresh when page becomes visible (user switches back to tab)
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      await loadSubscriptionInfo();
    }
  });
  
  // Refresh when window gets focus
  window.addEventListener('focus', async () => {
    await loadSubscriptionInfo();
  });
  
  // Check localStorage for activity signals (from main page)
  let lastCheckTime = Date.now();
  setInterval(() => {
    const lastActivity = localStorage.getItem('cutup_last_activity');
    if (lastActivity) {
      const activityTime = parseInt(lastActivity);
      if (activityTime > lastCheckTime) {
        lastCheckTime = activityTime;
        console.log('[dashboard] Activity detected, refreshing from API');
        // Refresh from API (backend-driven)
        loadSubscriptionInfo();
      }
    }
  }, 1000); // Check every 1 second
  
  // Listen for cutupDownloadRecorded event (from main page)
  window.addEventListener('cutupDownloadRecorded', async (event) => {
    console.log('[dashboard] Received cutupDownloadRecorded event:', event.detail);
    // Refresh from API (backend-driven)
    await loadSubscriptionInfo();
  });
  
  // Listen for cutupUsageRecorded event (from main page - for transcription/summarization)
  window.addEventListener('cutupUsageRecorded', async (event) => {
    console.log('[dashboard] Received cutupUsageRecorded event:', event.detail);
    // Refresh from API (backend-driven)
    await loadSubscriptionInfo();
  });
  
  // Listen for storage events (cross-tab sync) - ONLY refresh from API (backend-driven)
  window.addEventListener('storage', async (event) => {
    if (event.key === 'cutup_last_activity') {
      console.log('[dashboard] Activity detected, refreshing from API');
      // Only refresh from API (backend-driven)
      await loadSubscriptionInfo();
    }
  });
  
  // Refresh when navigating to overview section
  const overviewNav = document.querySelector('[data-section="overview"]');
  if (overviewNav) {
    overviewNav.addEventListener('click', async () => {
      setTimeout(async () => {
        await loadSubscriptionInfo();
      }, 100);
    });
  }
}

async function loadUserProfile() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${currentSession}`);
    if (response.ok) {
      const data = await response.json();
      if (data.user) {
        currentUser = data.user;
        showUserProfile(data.user);
      } else {
        localStorage.removeItem('cutup_session');
        window.location.href = 'index.html';
      }
    } else {
      localStorage.removeItem('cutup_session');
      window.location.href = 'index.html';
    }
  } catch (error) {
    console.error('Error loading user profile:', error);
    localStorage.removeItem('cutup_session');
    window.location.href = 'index.html';
  }
}

function showUserProfile(user) {
  console.log('[dashboard] showUserProfile called with:', user);
  
  const userAvatarHeader = document.getElementById('userAvatarHeader');
  const userNameHeader = document.getElementById('userNameHeader');
  const welcomeMessage = document.getElementById('welcomeMessage');
  
  if (!userAvatarHeader || !userNameHeader) {
    console.error('[dashboard] User profile elements not found!');
    // Retry after a short delay
    setTimeout(() => {
      showUserProfile(user);
    }, 100);
    return;
  }
  
  if (user.picture) {
    userAvatarHeader.src = user.picture;
    userAvatarHeader.style.display = 'block';
  } else {
    // Generate avatar if no picture
    const avatarUrl = generateAvatar(user.name || user.email);
    userAvatarHeader.src = avatarUrl;
    userAvatarHeader.style.display = 'block';
  }
  
  userNameHeader.textContent = user.name || user.email;
  
  if (welcomeMessage) {
    const raw = (user.name || user.email || 'there').trim();
    const first = raw.includes(' ') ? raw.split(/\s+/)[0] : raw.split('@')[0];
    welcomeMessage.textContent = `Hi ${first}—here’s your plan and usage at a glance.`;
  }
  
  console.log('[dashboard] User profile updated successfully');
}

// Generate avatar URL for users without profile picture
function generateAvatar(text) {
  const name = text || 'User';
  const encodedName = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encodedName}&size=128&background=6366f1&color=fff&bold=true`;
}

// Get usage statistics from localStorage history
// DISABLED: getUsageFromLocalHistory() - Dashboard is now backend-driven
// All usage data comes from API, not localStorage
function getUsageFromLocalHistory() {
  console.log('[dashboard] getUsageFromLocalHistory called but DISABLED - using backend-driven approach');
  // Return empty usage - dashboard should only use API data
  return {
    audioDownloads: 0,
    videoDownloads: 0,
    usedMinutes: 0,
  };
}

// DISABLED: updateDashboardFromLocalStorage() - Dashboard is now backend-driven
// All usage data comes from API, not localStorage
// This function is kept for backward compatibility but does nothing
function updateDashboardFromLocalStorage() {
  // Do nothing - dashboard is now backend-driven via loadSubscriptionInfo() -> updateDashboard()
  // All UI updates should come from updateDashboard() which reads from subscriptionInfo.usage (from API)
  return;
}

async function loadSubscriptionInfo() {
  try {
    // **BACKEND-DRIVEN**: Load everything from API (single source of truth)
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${currentSession}`, {
      headers: {
        'X-Session-Id': currentSession
      }
    });
    
    if (response.ok) {
      subscriptionInfo = await response.json();
      console.log('[dashboard] Subscription info loaded from API (backend-driven):', subscriptionInfo);
      
      // Ensure usage structure exists
      if (!subscriptionInfo.usage) {
        subscriptionInfo.usage = {
          daily: { date: new Date().toDateString(), minutes: 0 },
          monthly: { month: new Date().getMonth(), year: new Date().getFullYear(), minutes: 0 },
          downloads: {
            audio: { count: 0, limit: 3 },
            video: { count: 0, limit: 3 }
          }
        };
      }
      
      // Calculate remaining minutes
      const monthlyLimit = subscriptionInfo.usage.monthlyLimit || 20;
      const usedMinutes = subscriptionInfo.usage.monthly?.minutes || 0;
      subscriptionInfo.usage.monthly.remaining = Math.max(0, monthlyLimit - usedMinutes);
      
      console.log('[dashboard] Usage from API:', {
        audioDownloads: subscriptionInfo.usage.downloads?.audio?.count || 0,
        videoDownloads: subscriptionInfo.usage.downloads?.video?.count || 0,
        usedMinutes: usedMinutes,
        remainingMinutes: subscriptionInfo.usage.monthly.remaining
      });
      
      // Update dashboard UI from API data (backend-driven)
      updateDashboard();
      loadPlans();
    } else {
      const errorText = await response.text().catch(() => '');
      console.error('[dashboard] Failed to load subscription info from API:', response.status, errorText);
      
      // Fallback: Create default structure (but don't use localStorage)
      subscriptionInfo = {
        plan: 'free',
        planName: 'Free',
        usage: {
          monthly: { minutes: 0, remaining: 15 },
          monthlyLimit: 15,
          downloads: {
            audio: { count: 0, limit: 3 },
            video: { count: 0, limit: 3 }
          }
        }
      };
      updateDashboard();
      loadPlans();
    }
  } catch (error) {
    console.error('[dashboard] Error loading subscription info:', error);
    // Fallback: Create default structure
    subscriptionInfo = {
      plan: 'free',
      planName: 'Free',
      usage: {
        monthly: { minutes: 0, remaining: 15 },
          monthlyLimit: 15,
        downloads: {
          audio: { count: 0, limit: 3 },
          video: { count: 0, limit: 3 }
        }
      }
    };
    updateDashboard();
  }
}

function updateDashboard() {
  if (!subscriptionInfo) return;
  
  const usedMinutes = subscriptionInfo.usage.monthly.minutes || 0;
  const limit = subscriptionInfo.usage.monthlyLimit || 0;
  const planId = subscriptionInfo.plan || 'free';
  const usedVideosDisp = videosUsedEstimate(usedMinutes);
  const remainingVideosDisp = videosRemainingEstimate(usedMinutes, limit);
  
  // Update stats with null checks
  const usedMinutesEl = document.getElementById('usedMinutes');
  const remainingMinutesEl = document.getElementById('remainingMinutes');
  const statUsedLabel = document.getElementById('statUsedLabel');
  const statRemainingLabel = document.getElementById('statRemainingLabel');
  const currentPlanEl = document.getElementById('currentPlan');
  const expiryDateEl = document.getElementById('expiryDate');
  
  if (usedMinutesEl) usedMinutesEl.textContent = usedVideosDisp > 0 ? `~${usedVideosDisp}` : '0';
  if (remainingMinutesEl) {
    remainingMinutesEl.textContent = isAdvancedFairUsePlan(planId) ? 'Fair use' : String(remainingVideosDisp);
  }
  if (statUsedLabel) statUsedLabel.textContent = 'Videos processed (~this month)';
  if (statRemainingLabel) {
    statRemainingLabel.textContent = isAdvancedFairUsePlan(planId)
      ? 'Included capacity (fair use)'
      : 'Videos left (~this month)';
  }
  if (currentPlanEl) currentPlanEl.textContent = subscriptionInfo.planName;
  
  if (expiryDateEl) {
    if (subscriptionInfo.subscription.endDate) {
      const endDate = new Date(subscriptionInfo.subscription.endDate);
      expiryDateEl.textContent = endDate.toLocaleDateString('en-US');
    } else {
      expiryDateEl.textContent = 'No end date';
    }
  }
  
  // Update download stats
  if (subscriptionInfo.usage && subscriptionInfo.usage.downloads) {
    const audioCount = subscriptionInfo.usage.downloads.audio?.count || 0;
    const videoCount = subscriptionInfo.usage.downloads.video?.count || 0;
    const audioLimit = subscriptionInfo.usage.downloads.audio?.limit || null;
    const videoLimit = subscriptionInfo.usage.downloads.video?.limit || null;
    
    console.log('[dashboard] Updating download stats:', { audioCount, videoCount, audioLimit, videoLimit });
    
    let downloadStats = document.getElementById('downloadStats');
    if (!downloadStats) {
      const statsGrid = document.querySelector('.stats-grid');
      if (statsGrid) {
        downloadStats = document.createElement('div');
        downloadStats.className = 'stat-card';
        downloadStats.id = 'downloadStats';
        downloadStats.innerHTML = `
          <div class="stat-icon">📥</div>
          <div class="stat-content">
            <div class="stat-value" id="downloadCount">${audioCount + videoCount}</div>
            <div class="stat-label">Downloads (audio: ${audioCount}${audioLimit ? `/${audioLimit}` : ''} | video: ${videoCount}${videoLimit ? `/${videoLimit}` : ''})</div>
          </div>
        `;
        statsGrid.appendChild(downloadStats);
      }
    } else {
      const downloadCountEl = document.getElementById('downloadCount');
      if (downloadCountEl) {
        downloadCountEl.textContent = audioCount + videoCount;
        console.log('[dashboard] Updated downloadCount element:', audioCount + videoCount);
      }
      const labelEl = downloadStats.querySelector('.stat-label');
      if (labelEl) {
        labelEl.textContent = `Downloads (audio: ${audioCount}${audioLimit ? `/${audioLimit}` : ''} | video: ${videoCount}${videoLimit ? `/${videoLimit}` : ''})`;
        console.log('[dashboard] Updated download label');
      }
    }
  } else {
    console.warn('[dashboard] No downloads data in usage:', subscriptionInfo.usage);
  }
  
  drawUsageChart();
  loadUsageHistory();
}

async function drawUsageChart() {
  const canvas = document.getElementById('usageChart');
  if (!canvas || !subscriptionInfo) return;
  
  // Load history for chart
  let history = [];
  try {
    const historyResponse = await fetch(`${API_BASE_URL}/api/subscription?action=history&session=${currentSession}&limit=30`, {
      headers: {
        'X-Session-Id': currentSession
      }
    });
    if (historyResponse.ok) {
      const historyData = await historyResponse.json();
      history = historyData.history || [];
    }
  } catch (error) {
    console.error('Error loading history for chart:', error);
  }
  
  const ctx = canvas.getContext('2d');
  const width = canvas.width = canvas.offsetWidth;
  const height = canvas.height = 300;
  
  const used = subscriptionInfo.usage.monthly.minutes || 0;
  const limit = subscriptionInfo.usage.monthlyLimit || 0;
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  const planKey = subscriptionInfo.plan || 'free';
  
  ctx.clearRect(0, 0, width, height);
  
  // Draw background
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, width, height);
  
  // Group history by date (last 7 days)
  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    last7Days.push({
      date: date.toDateString(),
      dateObj: date, // Keep date object for comparison
      minutes: 0,
      downloads: 0
    });
  }
  
  console.log('[dashboard] Processing history for chart:', history.length, 'items');
  history.forEach(item => {
    if (!item.date) return;
    
    // Parse item date (could be ISO string or Date object)
    const itemDate = new Date(item.date);
    if (isNaN(itemDate.getTime())) {
      console.warn('[dashboard] Invalid date in history item:', item.date);
      return;
    }
    
    // Set time to midnight for comparison
    itemDate.setHours(0, 0, 0, 0);
    const itemDateString = itemDate.toDateString();
    
    const dayData = last7Days.find(d => d.date === itemDateString);
    if (dayData) {
      // For downloads, count them but don't add to minutes
      // Downloads should appear in chart but not affect minute count
      if (item.type === 'downloadVideo' || item.type === 'downloadAudio') {
        // Count downloads but don't add to minutes
        dayData.downloads = (dayData.downloads || 0) + 1;
        console.log('[dashboard] Found download:', item.type, 'on', itemDateString, 'total downloads:', dayData.downloads);
      } else {
        // For transcription/summarization, add minutes
        dayData.minutes += item.minutes || 0;
      }
    } else {
      // Item is outside last 7 days, skip it
      console.log('[dashboard] Item date outside range:', itemDateString);
    }
  });
  
  console.log('[dashboard] Last 7 days data:', last7Days.map(d => ({
    date: d.date,
    minutes: d.minutes,
    downloads: d.downloads
  })));
  
  // Draw daily usage bars
  const barWidth = (width - 60) / 7;
  const maxMinutes = Math.max(...last7Days.map(d => d.minutes || 0), 1);
  const barHeight = 200;
  const baseY = 50 + barHeight; // Base Y position for bars (bottom of chart area)
  
  last7Days.forEach((day, index) => {
    const x = 30 + index * barWidth;
    const barH = maxMinutes > 0 ? ((day.minutes || 0) / maxMinutes) * barHeight : 0;
    const y = baseY - barH;
    
    // Draw bar for minutes (transcription/summarization)
    if (day.minutes > 0) {
      ctx.fillStyle = subscriptionInfo.plan === 'free' ? '#ef4444' : '#6366f1';
      ctx.fillRect(x, y, barWidth - 5, barH);
    }
    
    // Draw download indicator (small dot or icon) - always visible if downloads exist
    if (day.downloads > 0) {
      // Position download indicator at a fixed height from bottom (even if no minutes)
      const downloadY = day.minutes > 0 ? y - 15 : baseY - 15;
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(x + barWidth / 2 - 2.5, downloadY, 5, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw download count text
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10px Vazirmatn';
      ctx.textAlign = 'center';
      ctx.fillText(`${day.downloads}↓`, x + barWidth / 2 - 2.5, downloadY - 10);
    }
    
    // Draw day label
    const dayName = new Date(day.date).toLocaleDateString('fa-IR', { weekday: 'short' });
    ctx.fillStyle = '#666';
    ctx.font = '12px Vazirmatn';
    ctx.textAlign = 'center';
    ctx.fillText(dayName, x + barWidth / 2 - 2.5, height - 10);
    
    if (day.minutes > 0) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '10px Vazirmatn';
      ctx.textAlign = 'center';
      const vEq = Math.max(1, Math.ceil(day.minutes / AVG_VIDEO_MINUTES));
      ctx.fillText(`~${vEq}`, x + barWidth / 2 - 2.5, y - 5);
    }
  });
  
  const usedV = videosUsedEstimate(used);
  const remV = videosRemainingEstimate(used, limit);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '14px Vazirmatn';
  ctx.textAlign = 'right';
  if (isAdvancedFairUsePlan(planKey)) {
    ctx.fillText(`~${usedV} videos processed · priority & fair-use pool`, width - 20, 30);
  } else {
    ctx.fillText(
      `~${usedV} videos used · ~${remV} left · ${percentage.toFixed(0)}% of monthly pool`,
      width - 20,
      30
    );
  }
}

async function loadPlans() {
  try {
    console.log('Loading plans...');
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=plans`);
    console.log('Plans response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Plans data:', data);
      
      if (data.plans && Array.isArray(data.plans)) {
        displayPlans(data.plans);
      } else {
        console.error('Invalid plans data:', data);
        showPlansError('We couldn\'t read plan data from the server. Tap retry or refresh.');
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.error('Error loading plans:', response.status, errorData);
      showPlansError('Plans didn\'t load. Check your connection and retry.');
    }
  } catch (error) {
    console.error('Error loading plans:', error);
    showPlansError('Network issue while loading plans. Try again.');
  }
}

function showPlansError(message) {
  const plansGrid = document.getElementById('plansGrid');
  if (plansGrid) {
    plansGrid.innerHTML = `<div class="error-message" style="text-align: center; padding: 48px; color: #ef4444;">
      <p>${message}</p>
      <button onclick="loadPlans()" style="margin-top: 16px; padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">Retry</button>
    </div>`;
  }
}

function displayPlans(plans) {
  const plansGrid = document.getElementById('plansGrid');
  if (!plansGrid) {
    console.error('plansGrid element not found!');
    return;
  }
  
  console.log('Displaying plans:', plans);
  
  if (!plans || plans.length === 0) {
    plansGrid.innerHTML = '<div class="empty-state"><p class="dashboard-empty-note">No plans to show right now. Refresh in a moment.</p></div>';
    return;
  }
  
  // Find free plan
  const freePlan = plans.find(p => p.id === 'free');
  const paidPlans = plans.filter(p => p.id !== 'free');
  
  const sortedPaidPlans = ['starter', 'pro', 'advanced']
    .map(id => paidPlans.find(p => p.id === id))
    .filter(p => p);
  
  plansGrid.innerHTML = '';
  
  // Display free plan info first (just text, no card)
  if (freePlan) {
    const freeInfo = document.createElement('div');
    freeInfo.className = 'free-plan-text';
    freeInfo.innerHTML = `
      <h3 class="free-plan-title">Free — taste the workflow</h3>
      <p class="free-plan-description">
        Built to show value in one sitting. Limits are intentionally tight so serious creators upgrade quickly.
      </p>
      <ul class="free-plan-limits">
        <li>✅ ~2–3 short videos / month · enough to feel the magic</li>
        <li>✅ Subtitle & transcript preview on the homepage</li>
        <li>❌ Full SRT download stays locked — upgrade to export</li>
        <li>⚠️ Watermark may appear · languages & tools are limited</li>
        <li>🔔 Hit a wall? Upgrade unlocks uninterrupted batches for students, creators, and pros</li>
      </ul>
    `;
    plansGrid.appendChild(freeInfo);
  }
  
  // Display paid plans in a special grid
  const paidPlansContainer = document.createElement('div');
  paidPlansContainer.className = 'paid-plans-container';
  
  const paidPlansGrid = document.createElement('div');
  paidPlansGrid.className = 'paid-plans-grid';
  
  // Display paid plans
  sortedPaidPlans.forEach((plan, index) => {
    console.log('Creating card for plan:', plan.id, plan.name);
    const planCard = document.createElement('div');
    planCard.className = 'paid-plan-card';
    planCard.dataset.planId = plan.id;
    planCard.dataset.index = index;
    
    // Pro plan is featured (middle, larger)
    if (plan.id === 'pro') {
      planCard.classList.add('featured');
    }
    
    if (plan.id === subscriptionInfo?.plan) {
      planCard.classList.add('current-plan');
    }
    
    // Get download limits
    const audioLimit = plan.downloadAudioLimit !== undefined ? plan.downloadAudioLimit : null;
    const videoLimit = plan.downloadVideoLimit !== undefined ? plan.downloadVideoLimit : null;
    const audioText = audioLimit ? `${audioLimit} / month` : 'Unlimited';
    const videoText = videoLimit ? `${videoLimit} / month` : 'Unlimited';
    const usd = plan.priceUsd && plan.priceUsd.monthly > 0 ? plan.priceUsd.monthly : null;
    const stripeKey = ['starter', 'pro', 'advanced'].includes(plan.id) ? plan.id : 'pro';
    const usdLabel = usd != null ? `$${Number(usd).toFixed(2)}` : '';
    const priceSectionHtml = usd
      ? `<div class="plan-price-section" id="price-${plan.id}"><div class="plan-price"><span class="price-main">${usdLabel}</span><span class="plan-period">/ month · USD (Stripe)</span></div></div>`
      : `<div class="plan-billing-selector">
        <label>Billing:</label>
        <select class="billing-period-select" data-plan-id="${plan.id}" onchange="updatePlanPrice('${plan.id}', this.value)">
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly (10% off)</option>
          <option value="semiannual">Semi-annual (15% off)</option>
          <option value="annual">Annual (25% off)</option>
        </select>
      </div>
      <div class="plan-price-section" id="price-${plan.id}">
        ${calculatePlanPriceHTML(plan, 'monthly')}
      </div>`;

    planCard.innerHTML = `
      <div class="paid-plan-header">
        <div class="paid-plan-name">${plan.nameEn || plan.name}</div>
        ${plan.id === subscriptionInfo?.plan ? '<div class="current-badge">Current plan</div>' : ''}
      </div>
      ${priceSectionHtml}
      <ul class="plan-features">
        <li>${planValueCopy(plan)}</li>
        <li>✅ AI summaries &amp; key takeaways</li>
        <li>✅ Full SRT subtitles (paid tiers)</li>
        <li>✅ Audio downloads: ${audioText}</li>
        <li>✅ Video downloads: ${videoText}</li>
      </ul>
      ${usd && plan.id !== subscriptionInfo?.plan ? `
      <button type="button" class="plan-btn stripe-pay" onclick="startStripeCheckout('${stripeKey}')">Subscribe with card (Stripe)</button>
      ` : ''}
      <button class="plan-btn ${plan.id === subscriptionInfo?.plan ? 'current' : ''}" 
              onclick="addToCartFromCard('${plan.id}')">
        ${plan.id === subscriptionInfo?.plan ? 'Current plan' : (usd ? 'Or add legacy cart (IRR)' : 'Add to cart')}
      </button>
    `;
    
    paidPlansGrid.appendChild(planCard);
  });
  
  paidPlansContainer.appendChild(paidPlansGrid);
  plansGrid.appendChild(paidPlansContainer);
}


function calculatePlanPriceHTML(plan, billingPeriod) {
  const price = plan.price[billingPeriod] || plan.price.monthly;
  const originalPrice = plan.price.monthly * getPeriodMultiplier(billingPeriod);
  const discount = billingPeriod !== 'monthly' ? 
    Math.round(((originalPrice - price) / originalPrice) * 100) : 0;
  
  return `
    <div class="plan-price">
      <span class="price-main">${formatPrice(price)} IRR</span>
      ${discount > 0 ? `
        <span class="price-original">${formatPrice(originalPrice)} IRR</span>
        <span class="price-discount">${discount}% off</span>
      ` : ''}
    </div>
    <div class="plan-period">${getPeriodName(billingPeriod)}</div>
  `;
}

function updatePlanPrice(planId, billingPeriod) {
  fetch(`${API_BASE_URL}/api/subscription?action=plans`)
    .then(response => response.json())
    .then(data => {
      const plan = data.plans.find(p => p.id === planId);
      if (plan) {
        const priceSection = document.getElementById(`price-${planId}`);
        if (priceSection) {
          priceSection.innerHTML = calculatePlanPriceHTML(plan, billingPeriod);
        }
      }
    })
    .catch(error => {
      console.error('Error updating plan price:', error);
    });
}

function getPeriodMultiplier(period) {
  const multipliers = {
    monthly: 1,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  };
  return multipliers[period] || 1;
}

function getPeriodName(period) {
  const names = {
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    semiannual: 'Semi-annual',
    annual: 'Annual'
  };
  return names[period] || 'Monthly';
}

function formatPrice(price) {
  return new Intl.NumberFormat('en-US').format(price);
}

async function upgradePlan(planId, billingPeriod) {
  if (subscriptionInfo?.plan === planId) {
    showDashboardBanner('You\'re already on this plan.', 'neutral');
    return;
  }
  
  if (!confirm(`Upgrade to plan "${planId}"?`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=upgrade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': currentSession
      },
      body: JSON.stringify({
        plan: planId,
        billingPeriod: billingPeriod
      })
    });
    
    if (response.ok) {
      showDashboardBanner('Plan updated. Refreshing your account…', 'success');
      await loadSubscriptionInfo();
    } else {
      const error = await response.json();
      showDashboardBanner(error.message || 'Could not change plan. Try again.', 'error');
    }
  } catch (error) {
    console.error('Error upgrading plan:', error);
    showDashboardBanner('Could not change plan. Check your connection and try again.', 'error');
  }
}

async function loadUsageHistory() {
  const usageDetails = document.getElementById('usageDetails');
  if (!usageDetails) return;
  
  usageDetails.innerHTML = '<p class="dashboard-muted-loading">Loading activity…</p>';
  
  try {
    // Load usage history from API
    const historyResponse = await fetch(`${API_BASE_URL}/api/subscription?action=history&session=${currentSession}&limit=100`, {
      headers: {
        'X-Session-Id': currentSession
      }
    });
    
    let history = [];
    if (historyResponse.ok) {
      const historyData = await historyResponse.json();
      history = historyData.history || [];
    }
    
    if (!subscriptionInfo || !subscriptionInfo.usage) {
      usageDetails.innerHTML = '<p class="dashboard-muted-loading">Loading activity…</p>';
      return;
    }
    
    const usage = subscriptionInfo.usage;
    
    // Group history by type
    const historyByType = {
      transcription: history.filter(h => h.type === 'transcription'),
      summarization: history.filter(h => h.type === 'summarization'),
      downloadAudio: history.filter(h => h.type === 'downloadAudio'),
      downloadVideo: history.filter(h => h.type === 'downloadVideo')
    };
    
    // Format history items
    const formatHistoryItem = (item) => {
      const date = new Date(item.date);
      const dateStr = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      let typeLabel = '';
      let icon = '';
      switch(item.type) {
        case 'transcription':
          typeLabel = 'Transcription';
          icon = '📋';
          break;
        case 'summarization':
          typeLabel = 'Summary';
          icon = '📝';
          break;
        case 'downloadAudio':
          typeLabel = 'Audio download';
          icon = '🎵';
          break;
        case 'downloadVideo':
          typeLabel = 'Video download';
          icon = '🎬';
          break;
        default:
          typeLabel = item.type;
          icon = '📄';
      }
      
      const title = item.metadata?.title || 'Untitled';
      const quality = item.metadata?.quality ? ` (${item.metadata.quality})` : '';
      
      return `
        <div class="history-item">
          <div class="history-icon">${icon}</div>
          <div class="history-content">
            <div class="history-title">${title}${quality}</div>
            <div class="history-meta">
              <span class="history-type">${typeLabel}</span>
              <span class="history-date">${dateStr}</span>
            </div>
          </div>
        </div>
      `;
    };
    
    const planIdForUsage = subscriptionInfo.plan || 'free';
    let historyHTML = `
      <div class="usage-summary">
        <h3>This month</h3>
        <div class="usage-stats">
          <div class="usage-stat-item">
            <span class="usage-stat-label">Videos processed (~est.):</span>
            <span class="usage-stat-value">~${videosUsedEstimate(usage.monthly.minutes || 0)}</span>
          </div>
          <div class="usage-stat-item">
            <span class="usage-stat-label">Videos left (~est.):</span>
            <span class="usage-stat-value">${isAdvancedFairUsePlan(planIdForUsage) ? 'Fair use pool' : `~${videosRemainingEstimate(usage.monthly.minutes || 0, subscriptionInfo.usage.monthlyLimit || 0)}`}</span>
          </div>
          ${usage.downloads ? `
          <div class="usage-stat-item">
            <span class="usage-stat-label">Audio downloads:</span>
            <span class="usage-stat-value">${usage.downloads.audio?.count || 0}${usage.downloads.audio?.limit ? ` / ${usage.downloads.audio.limit}` : ''}</span>
          </div>
          <div class="usage-stat-item">
            <span class="usage-stat-label">Video downloads:</span>
            <span class="usage-stat-value">${usage.downloads.video?.count || 0}${usage.downloads.video?.limit ? ` / ${usage.downloads.video.limit}` : ''}</span>
          </div>
          ` : ''}
        </div>
        <p class="info-text" style="margin-top:14px;font-size:14px;color:#666;max-width:560px;line-height:1.5;">
          Numbers are friendly estimates: we map your real usage into ~<strong>5–10 minute</strong> “typical video” chunks. One long lecture can count as several chunks.
        </p>
      </div>
      <div class="usage-history">
        <h3>Activity history</h3>
        ${history.length > 0 ? `
          <div class="history-list">
            ${history.map(formatHistoryItem).join('')}
          </div>
        ` : `
          <p class="info-text">No activity yet—run a job from the home page and it will show up here.</p>
        `}
      </div>
    `;
    
    usageDetails.innerHTML = historyHTML;
  } catch (error) {
    console.error('Error loading usage history:', error);
    usageDetails.innerHTML = '<p class="dashboard-empty-note">Could not load activity. Refresh the page or try again shortly.</p>';
  }
}

// Shopping Cart Functions
function addToCartFromCard(planId) {
  const sel = document.querySelector(`select.billing-period-select[data-plan-id="${planId}"]`);
  const period = sel && sel.value ? sel.value : 'monthly';
  addToCart(planId, period);
}

async function startStripeCheckout(priceKey) {
  const key = ['starter', 'pro', 'advanced'].includes(priceKey) ? priceKey : 'pro';
  trackConversionEvent('upgrade_clicked', {
    source: 'stripe_subscribe_button',
    plan: key
  });
  try {
    const response = await fetch(`${API_BASE_URL}/api/stripe/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': currentSession
      },
      body: JSON.stringify({ priceKey: key })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.url) {
      window.location.href = data.url;
    } else {
      console.error('[dashboard] Stripe checkout error', response.status, data);
      showDashboardBanner('Payment could not be started. Please try again.', 'error');
    }
  } catch (e) {
    console.error('[dashboard] Stripe checkout failed', e);
    showDashboardBanner('Payment could not be started. Please try again.', 'error');
  }
}
window.startStripeCheckout = startStripeCheckout;

function addToCart(planId, billingPeriod) {
  if (!subscriptionInfo) {
    showDashboardBanner('Still loading your account—try again in a second.', 'info');
    return;
  }
  
  if (planId === subscriptionInfo?.plan) {
    showDashboardBanner('You\'re already on this plan.', 'neutral');
    return;
  }
  
  fetch(`${API_BASE_URL}/api/subscription?action=plans`)
    .then(response => response.json())
    .then(data => {
      const plan = data.plans.find(p => p.id === planId);
      if (!plan) {
        showDashboardBanner('That plan isn\'t available. Refresh the page.', 'error');
        return;
      }
      
      const price = plan.price[billingPeriod] || plan.price.monthly;
      const originalPrice = plan.price.monthly * getPeriodMultiplier(billingPeriod);
      const discount = billingPeriod !== 'monthly' ? 
        Math.round(((originalPrice - price) / originalPrice) * 100) : 0;
      
      const cartItem = {
        id: Date.now(),
        planId: planId,
        planName: plan.name,
        billingPeriod: billingPeriod,
        price: price,
        originalPrice: originalPrice,
        discount: discount,
        monthlyLimit: plan.monthlyLimit
      };
      
      shoppingCart.push(cartItem);
      updateCartUI();
      updateCartBadge();
      showCartNotification();
    })
    .catch(error => {
      console.error('Error loading plan:', error);
      showDashboardBanner('Could not load plan details. Check your connection.', 'error');
    });
}

function removeFromCart(itemId) {
  shoppingCart = shoppingCart.filter(item => item.id !== itemId);
  updateCartUI();
  updateCartBadge();
  loadCartSection();
}

function updateCartUI() {
  localStorage.setItem('cutup_cart', JSON.stringify(shoppingCart));
}

function updateCartBadge() {
  const cartBadge = document.getElementById('cartBadge');
  if (cartBadge) {
    if (shoppingCart.length > 0) {
      cartBadge.textContent = shoppingCart.length;
      cartBadge.style.display = 'inline-block';
    } else {
      cartBadge.style.display = 'none';
    }
  }
}

function showCartNotification() {
  const notification = document.createElement('div');
  notification.className = 'cart-notification';
  notification.textContent = 'Added to cart.';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

function loadCart() {
  const savedCart = localStorage.getItem('cutup_cart');
  if (savedCart) {
    try {
      shoppingCart = JSON.parse(savedCart);
      updateCartBadge();
    } catch (e) {
      shoppingCart = [];
    }
  }
}

function loadCartSection() {
  const cartItems = document.getElementById('cartItems');
  const cartSummary = document.getElementById('cartSummary');
  
  if (!cartItems || !cartSummary) return;
  
  if (shoppingCart.length === 0) {
    cartItems.innerHTML = '<div class="empty-cart"><p>Your cart is empty.</p></div>';
    cartSummary.innerHTML = '';
    return;
  }
  
  let total = 0;
  let totalDiscount = 0;
  
  cartItems.innerHTML = shoppingCart.map(item => {
    total += item.price;
    totalDiscount += (item.originalPrice - item.price);
    
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <h4>${item.planName}</h4>
          <p>Billing: ${getPeriodName(item.billingPeriod)}</p>
          <p>~${Math.max(1, Math.round(item.monthlyLimit / AVG_VIDEO_MINUTES))} videos / month included (typical 5–10 min each)</p>
        </div>
        <div class="cart-item-price">
          <div class="cart-item-price-main">${formatPrice(item.price)} IRR</div>
          ${item.discount > 0 ? `
            <div class="cart-item-price-original">${formatPrice(item.originalPrice)} IRR</div>
            <div class="cart-item-discount">${item.discount}% off</div>
          ` : ''}
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${item.id})">🗑️</button>
      </div>
    `;
  }).join('');
  
  cartSummary.innerHTML = `
    <div class="cart-summary-content">
      <div class="summary-row">
        <span>Subtotal:</span>
        <span>${formatPrice(total)} IRR</span>
      </div>
      ${totalDiscount > 0 ? `
      <div class="summary-row discount">
        <span>Discount:</span>
        <span>-${formatPrice(totalDiscount)} IRR</span>
      </div>
      ` : ''}
      <div class="summary-row total">
        <span>Total:</span>
        <span>${formatPrice(total)} IRR</span>
      </div>
      <button class="checkout-btn" onclick="checkout()">Checkout</button>
    </div>
  `;
}

function checkout() {
  if (shoppingCart.length === 0) {
    showDashboardBanner('Your cart is empty—add a plan first.', 'neutral');
    return;
  }
  
  if (!confirm(`Purchase ${shoppingCart.length} item(s)?`)) {
    return;
  }
  
  // Create invoice
  const invoice = {
    id: Date.now(),
    items: [...shoppingCart],
    total: shoppingCart.reduce((sum, item) => sum + item.price, 0),
    discount: shoppingCart.reduce((sum, item) => sum + (item.originalPrice - item.price), 0),
    date: new Date().toISOString(),
    status: 'pending' // pending, paid, cancelled
  };
  
  // Save invoice
  let invoices = [];
  const savedInvoices = localStorage.getItem('cutup_invoices');
  if (savedInvoices) {
    try {
      invoices = JSON.parse(savedInvoices);
    } catch (e) {
      invoices = [];
    }
  }
  
  invoices.unshift(invoice);
  localStorage.setItem('cutup_invoices', JSON.stringify(invoices));
  
  // Clear cart
  shoppingCart = [];
  updateCartUI();
  updateCartBadge();
  loadCartSection();
  
  // Show invoice
  showInvoice(invoice);
  
  // Reload financial section
  loadFinancialSection();
}

function showInvoice(invoice) {
  const invoiceHTML = `
    <div class="invoice-modal" id="invoiceModal">
      <div class="invoice-modal-content">
        <div class="invoice-header">
          <h2>Invoice</h2>
          <button class="close-btn" onclick="closeInvoiceModal()">✕</button>
        </div>
        <div class="invoice-body">
          <div class="invoice-info">
            <p><strong>Invoice #:</strong> ${invoice.id}</p>
            <p><strong>Date:</strong> ${new Date(invoice.date).toLocaleDateString('en-US')}</p>
            <p><strong>Time:</strong> ${new Date(invoice.date).toLocaleTimeString('en-US')}</p>
            <p><strong>Status:</strong> <span class="invoice-status ${invoice.status}">${getInvoiceStatusText(invoice.status)}</span></p>
          </div>
          <div class="invoice-items">
            <h3>Items</h3>
            ${invoice.items.map(item => `
              <div class="invoice-item">
                <span>${item.planName} - ${getPeriodName(item.billingPeriod)}</span>
                <span>${formatPrice(item.price)} IRR</span>
              </div>
            `).join('')}
          </div>
          <div class="invoice-total">
            <div class="total-row">
              <span>Subtotal:</span>
              <span>${formatPrice(invoice.total)} IRR</span>
            </div>
            ${invoice.discount > 0 ? `
            <div class="total-row discount">
              <span>Discount:</span>
              <span>-${formatPrice(invoice.discount)} IRR</span>
            </div>
            ` : ''}
            <div class="total-row final">
              <span>Total:</span>
              <span>${formatPrice(invoice.total)} IRR</span>
            </div>
          </div>
          <div class="invoice-actions">
            <button class="btn-download-pdf" onclick="downloadInvoicePDF(${invoice.id})">Download PDF</button>
            ${invoice.status === 'pending' || invoice.status === 'cancelled' ? `
            <button class="btn-delete-invoice" onclick="deleteInvoice(${invoice.id})">Delete invoice</button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', invoiceHTML);
  document.getElementById('invoiceModal').style.display = 'flex';
}

function closeInvoiceModal() {
  const modal = document.getElementById('invoiceModal');
  if (modal) {
    modal.style.display = 'none';
    setTimeout(() => modal.remove(), 300);
  }
}

function getInvoiceStatusText(status) {
  const statusTexts = {
    pending: 'Pending payment',
    paid: 'Paid',
    cancelled: 'Cancelled'
  };
  return statusTexts[status] || status;
}

function downloadInvoicePDF(invoiceId) {
  void invoiceId;
  showDashboardBanner('PDF download isn\'t available yet. Use your email receipts or contact support.', 'info');
}

function deleteInvoice(invoiceId) {
  if (!confirm('Delete this invoice?')) {
    return;
  }
  
  let invoices = [];
  const savedInvoices = localStorage.getItem('cutup_invoices');
  if (savedInvoices) {
    try {
      invoices = JSON.parse(savedInvoices);
    } catch (e) {
      invoices = [];
    }
  }
  
  invoices = invoices.filter(inv => inv.id !== invoiceId);
  localStorage.setItem('cutup_invoices', JSON.stringify(invoices));
  
  loadFinancialSection();
  closeInvoiceModal();
}

function loadFinancialSection() {
  const financialInfo = document.getElementById('financialInfo');
  if (!financialInfo) return;
  
  let invoices = [];
  const savedInvoices = localStorage.getItem('cutup_invoices');
  if (savedInvoices) {
    try {
      invoices = JSON.parse(savedInvoices);
    } catch (e) {
      invoices = [];
    }
  }
  
  if (invoices.length === 0) {
    financialInfo.innerHTML = '<div class="empty-state"><p>No invoices yet.</p></div>';
    return;
  }
  
  financialInfo.innerHTML = `
    <div class="invoices-list">
      ${invoices.map(invoice => `
        <div class="invoice-card">
          <div class="invoice-card-header">
            <div class="invoice-card-id">#${invoice.id}</div>
            <div class="invoice-card-status ${invoice.status}">${getInvoiceStatusText(invoice.status)}</div>
          </div>
          <div class="invoice-card-body">
            <div class="invoice-card-info">
              <p><strong>Date:</strong> ${new Date(invoice.date).toLocaleDateString('en-US')}</p>
              <p><strong>Time:</strong> ${new Date(invoice.date).toLocaleTimeString('en-US')}</p>
              <p><strong>Items:</strong> ${invoice.items.length}</p>
              <p><strong>Amount:</strong> ${formatPrice(invoice.total)} IRR</p>
            </div>
            <div class="invoice-card-actions">
              <button class="btn-view-invoice" onclick="showInvoice(${JSON.stringify(invoice).replace(/"/g, '&quot;')})">View invoice</button>
              <button class="btn-download-pdf" onclick="downloadInvoicePDF(${invoice.id})">Download PDF</button>
              ${invoice.status === 'pending' || invoice.status === 'cancelled' ? `
              <button class="btn-delete-invoice" onclick="deleteInvoice(${invoice.id})">Delete</button>
              ` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function loadSupportSection() {
  const supportTickets = document.getElementById('supportTickets');
  if (!supportTickets) return;
  
  let tickets = [];
  const savedTickets = localStorage.getItem('cutup_tickets');
  if (savedTickets) {
    try {
      tickets = JSON.parse(savedTickets);
    } catch (e) {
      tickets = [];
    }
  }
  
  supportTickets.innerHTML = `
    <div class="support-header">
      <button class="btn-new-ticket" onclick="showNewTicketModal()">New ticket</button>
    </div>
    <div class="tickets-list">
      ${tickets.length === 0 ? '<div class="empty-state"><p>No support tickets yet.</p></div>' : tickets.map(ticket => `
        <div class="ticket-card">
          <div class="ticket-header">
            <div class="ticket-id">#${ticket.id}</div>
            <div class="ticket-status ${ticket.status}">${getTicketStatusText(ticket.status)}</div>
          </div>
          <div class="ticket-body">
            <h4>${ticket.subject}</h4>
            <p>${ticket.message.substring(0, 100)}...</p>
            <p class="ticket-date">${new Date(ticket.date).toLocaleDateString('en-US')}</p>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function showNewTicketModal() {
  const modalHTML = `
    <div class="ticket-modal" id="ticketModal">
      <div class="ticket-modal-content">
        <div class="ticket-modal-header">
          <h2>New support ticket</h2>
          <button class="close-btn" onclick="closeTicketModal()">✕</button>
        </div>
        <div class="ticket-modal-body">
          <form id="newTicketForm" onsubmit="submitTicket(event)">
            <div class="form-group">
              <label>Subject</label>
              <input type="text" name="subject" required>
            </div>
            <div class="form-group">
              <label>Message</label>
              <textarea name="message" rows="5" required></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-submit">Submit</button>
              <button type="button" class="btn-cancel" onclick="closeTicketModal()">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  document.getElementById('ticketModal').style.display = 'flex';
}

function closeTicketModal() {
  const modal = document.getElementById('ticketModal');
  if (modal) {
    modal.style.display = 'none';
    setTimeout(() => modal.remove(), 300);
  }
}

function submitTicket(event) {
  event.preventDefault();
  
  const form = event.target;
  const formData = new FormData(form);
  
  const ticket = {
    id: Date.now(),
    subject: formData.get('subject'),
    message: formData.get('message'),
    date: new Date().toISOString(),
    status: 'open'
  };
  
  let tickets = [];
  const savedTickets = localStorage.getItem('cutup_tickets');
  if (savedTickets) {
    try {
      tickets = JSON.parse(savedTickets);
    } catch (e) {
      tickets = [];
    }
  }
  
  tickets.unshift(ticket);
  localStorage.setItem('cutup_tickets', JSON.stringify(tickets));
  
  closeTicketModal();
  loadSupportSection();
  showDashboardBanner('Thanks—we saved your ticket.', 'success');
}

function getTicketStatusText(status) {
  const statusTexts = {
    open: 'Open',
    closed: 'Closed',
    pending: 'Pending'
  };
  return statusTexts[status] || status;
}

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.dashboard-section');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetSection = item.dataset.section;
      
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      sections.forEach(section => section.classList.remove('active'));
      const targetSectionElement = document.getElementById(`${targetSection}-section`);
      if (targetSectionElement) {
        targetSectionElement.classList.add('active');
      }
      
      // Load section data if needed
      if (targetSection === 'cart') {
        loadCartSection();
      } else if (targetSection === 'financial') {
        loadFinancialSection();
      } else if (targetSection === 'support') {
        loadSupportSection();
      }
    });
  });
  
  // Handle user profile link click
  const userProfileLink = document.getElementById('userProfileLink');
  if (userProfileLink) {
    userProfileLink.addEventListener('click', (e) => {
      e.preventDefault();
      // Navigate to overview
      const overviewNav = document.querySelector('[data-section="overview"]');
      if (overviewNav) {
        overviewNav.click();
      }
    });
  }
}

function setupEventListeners() {
  document.getElementById('logoutBtnHeader').addEventListener('click', async () => {
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
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
    localStorage.removeItem('cutup_session');
    window.location.href = 'index.html';
  });
}

// Make functions available globally
window.upgradePlan = upgradePlan;
window.addToCart = addToCart;
window.updatePlanPrice = updatePlanPrice;
window.removeFromCart = removeFromCart;
window.checkout = checkout;
window.showInvoice = showInvoice;
window.closeInvoiceModal = closeInvoiceModal;
window.downloadInvoicePDF = downloadInvoicePDF;
window.deleteInvoice = deleteInvoice;
window.showNewTicketModal = showNewTicketModal;
window.closeTicketModal = closeTicketModal;
window.submitTicket = submitTicket;
window.updateDashboardFromLocalStorage = updateDashboardFromLocalStorage;
window.getUsageFromLocalHistory = getUsageFromLocalHistory;

// Function to clear audio downloads from localStorage for h.asgarizade@gmail.com
async function clearAudioDownloadsFromLocalStorage() {
  try {
    // Get user email from API
    const userResponse = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${currentSession}`);
    if (!userResponse.ok) return;
    
    const userData = await userResponse.json();
    if (!userData.user || userData.user.email !== 'h.asgarizade@gmail.com') return;
    
    // Clear audio downloads from localStorage
    const keys = Object.keys(localStorage);
    const resultKeys = keys.filter(k => k.startsWith('cutup_result_'));
    
    let cleared = 0;
    resultKeys.forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const item = JSON.parse(raw);
          if (item.type === 'downloadAudio') {
            localStorage.removeItem(key);
            cleared++;
          }
        } catch (e) {
          // Skip invalid items
        }
      }
    });
    
    console.log(`[dashboard] Cleared ${cleared} audio download items from localStorage`);
    
    // Also clear from cutup_dashboard_history if exists
    const historyRaw = localStorage.getItem('cutup_dashboard_history');
    if (historyRaw) {
      try {
        const history = JSON.parse(historyRaw);
        const filtered = history.filter(item => item.type !== 'downloadAudio');
        localStorage.setItem('cutup_dashboard_history', JSON.stringify(filtered));
        console.log(`[dashboard] Cleared audio downloads from dashboard history`);
      } catch (e) {
        // Skip if invalid
      }
    }
    
    // Refresh dashboard from API only (backend-driven)
    loadSubscriptionInfo();
  } catch (error) {
    console.error('[dashboard] Error clearing audio downloads:', error);
  }
}

// Auto-clear on page load if user is h.asgarizade@gmail.com
document.addEventListener('DOMContentLoaded', async () => {
  // Wait a bit for session to load
  setTimeout(async () => {
    if (currentSession) {
      try {
        const userResponse = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${currentSession}`);
        if (userResponse.ok) {
          const userData = await userResponse.json();
          if (userData.user && userData.user.email === 'h.asgarizade@gmail.com') {
            // Reset in backend
            await fetch(`${API_BASE_URL}/api/subscription?action=resetAudioDownloads`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': currentSession
              }
            });
            // Clear from localStorage
            await clearAudioDownloadsFromLocalStorage();
          }
        }
      } catch (e) {
        console.error('[dashboard] Error in auto-reset:', e);
      }
    }
  }, 1000);
});


// Debug function - can be called from console
window.debugDashboard = function() {
  console.log('=== Dashboard Debug ===');
  console.log('Current origin:', window.location.origin);
  console.log('Looking for key:', DASHBOARD_HISTORY_KEY);
  console.log('All localStorage keys:', Object.keys(localStorage));
  const raw = localStorage.getItem(DASHBOARD_HISTORY_KEY);
  console.log('localStorage raw:', raw);
  if (raw) {
    const history = JSON.parse(raw);
    console.log('History length:', history.length);
    console.log('History items:', history);
    const usage = getUsageFromLocalHistory();
    console.log('Calculated usage:', usage);
  } else {
    console.log('No history in localStorage!');
    console.log('Available keys:', Object.keys(localStorage));
  }
  console.log('======================');
};
