// Dashboard JavaScript
const API_BASE_URL = 'https://cutup.shop';
let currentSession = null;
let currentUser = null;
let subscriptionInfo = null;
let shoppingCart = [];

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
  
  initDashboard();
});

async function initDashboard() {
  const savedSession = localStorage.getItem('cutup_session');
  if (!savedSession) {
    window.location.href = '/';
    return;
  }
  
  currentSession = savedSession;
  localStorage.setItem('cutup_session', savedSession);
  
  // Load cart
  loadCart();
  
  // Load user profile
  await loadUserProfile();
  
  // Load subscription info
  await loadSubscriptionInfo();
  
  // Setup navigation
  setupNavigation();
  
  // Setup event listeners
  setupEventListeners();
  
  // Load sections
  loadCartSection();
  loadFinancialSection();
  loadSupportSection();
  
  // Auto-refresh subscription info every 5 seconds (aggressive polling)
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
        loadSubscriptionInfo();
      }
    }
  }, 2000); // Check every 2 seconds
  
  // Listen for cutupDownloadRecorded event (from main page)
  window.addEventListener('cutupDownloadRecorded', async (event) => {
    console.log('[dashboard] Received cutupDownloadRecorded event:', event.detail);
    await loadSubscriptionInfo();
  });
  
  // Listen for storage events (cross-tab sync)
  window.addEventListener('storage', async (event) => {
    if (event.key === 'cutup_dashboard_history') {
      console.log('[dashboard] Storage event detected for cutup_dashboard_history');
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
        window.location.href = '/';
      }
    } else {
      localStorage.removeItem('cutup_session');
      window.location.href = '/';
    }
  } catch (error) {
    console.error('Error loading user profile:', error);
    localStorage.removeItem('cutup_session');
    window.location.href = '/';
  }
}

function showUserProfile(user) {
  document.getElementById('userAvatarHeader').src = user.picture || '';
  document.getElementById('userNameHeader').textContent = user.name || user.email;
  document.getElementById('welcomeMessage').textContent = `خوش آمدید ${user.name || user.email}!`;
}

// Get usage statistics from localStorage history
function getUsageFromLocalHistory() {
  try {
    const raw = localStorage.getItem('cutup_dashboard_history');
    if (!raw) {
      return {
        audioDownloads: 0,
        videoDownloads: 0,
        usedMinutes: 0,
      };
    }

    const history = JSON.parse(raw);
    let audio = 0;
    let video = 0;
    let minutes = 0;

    for (const item of history) {
      if (!item || !item.type) continue;

      if (item.type === 'downloadAudio') audio += 1;
      if (item.type === 'downloadVideo') video += 1;

      // If it's a usage type (summary, transcription), add minutes
      if (
        (item.type === 'summary' || item.type === 'summarization' || item.type === 'transcription') &&
        typeof item.minutes === 'number'
      ) {
        minutes += item.minutes;
      }
    }

    return {
      audioDownloads: audio,
      videoDownloads: video,
      usedMinutes: minutes,
    };
  } catch (e) {
    console.error('[dashboard] getUsageFromLocalHistory error', e);
    return {
      audioDownloads: 0,
      videoDownloads: 0,
      usedMinutes: 0,
    };
  }
}

async function loadSubscriptionInfo() {
  try {
    // Try to load from API first (for plan info, limits, etc.)
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${currentSession}`, {
      headers: {
        'X-Session-Id': currentSession
      }
    });
    
    if (response.ok) {
      subscriptionInfo = await response.json();
      console.log('[dashboard] Subscription info loaded from API:', subscriptionInfo);
    } else {
      const errorText = await response.text().catch(() => '');
      console.error('[dashboard] Failed to load subscription info from API:', response.status, errorText);
      // Create a default subscriptionInfo structure if API fails
      subscriptionInfo = {
        plan: 'free',
        planName: 'رایگان',
        usage: {
          monthly: { minutes: 0 },
          monthlyLimit: 20,
          downloads: {
            audio: { count: 0, limit: 3 },
            video: { count: 0, limit: 3 }
          }
        }
      };
    }
    
    // Get local usage from history (this is the source of truth for counts)
    const localUsage = getUsageFromLocalHistory();
    console.log('[dashboard] Local usage from history:', localUsage);
    
    // Merge local usage into subscriptionInfo
    if (subscriptionInfo && subscriptionInfo.usage) {
      // Update download counts from localStorage
      if (!subscriptionInfo.usage.downloads) {
        subscriptionInfo.usage.downloads = {};
      }
      if (!subscriptionInfo.usage.downloads.audio) {
        subscriptionInfo.usage.downloads.audio = { count: 0, limit: 3 };
      }
      if (!subscriptionInfo.usage.downloads.video) {
        subscriptionInfo.usage.downloads.video = { count: 0, limit: 3 };
      }
      
      subscriptionInfo.usage.downloads.audio.count = localUsage.audioDownloads;
      subscriptionInfo.usage.downloads.video.count = localUsage.videoDownloads;
      
      // Update minutes from localStorage
      subscriptionInfo.usage.monthly.minutes = localUsage.usedMinutes;
      
      // Recalculate remaining minutes
      const limit = subscriptionInfo.usage.monthlyLimit || 20;
      subscriptionInfo.usage.monthly.remaining = Math.max(0, limit - localUsage.usedMinutes);
    }
    
    console.log('[dashboard] Final subscription info with local usage:', subscriptionInfo);
    updateDashboard();
    loadPlans();
  } catch (error) {
    console.error('[dashboard] Error loading subscription info:', error);
    // Fallback to local usage only
    const localUsage = getUsageFromLocalHistory();
    subscriptionInfo = {
      plan: 'free',
      planName: 'رایگان',
      usage: {
        monthly: { minutes: localUsage.usedMinutes, remaining: Math.max(0, 20 - localUsage.usedMinutes) },
        monthlyLimit: 20,
        downloads: {
          audio: { count: localUsage.audioDownloads, limit: 3 },
          video: { count: localUsage.videoDownloads, limit: 3 }
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
  const remaining = Math.max(0, limit - usedMinutes);
  
  // Update stats with null checks
  const usedMinutesEl = document.getElementById('usedMinutes');
  const remainingMinutesEl = document.getElementById('remainingMinutes');
  const currentPlanEl = document.getElementById('currentPlan');
  const expiryDateEl = document.getElementById('expiryDate');
  
  if (usedMinutesEl) usedMinutesEl.textContent = usedMinutes;
  if (remainingMinutesEl) remainingMinutesEl.textContent = remaining;
  if (currentPlanEl) currentPlanEl.textContent = subscriptionInfo.planName;
  
  if (expiryDateEl) {
    if (subscriptionInfo.subscription.endDate) {
      const endDate = new Date(subscriptionInfo.subscription.endDate);
      expiryDateEl.textContent = endDate.toLocaleDateString('fa-IR');
    } else {
      expiryDateEl.textContent = 'نامحدود';
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
            <div class="stat-label">دانلود (موزیک: ${audioCount}${audioLimit ? `/${audioLimit}` : ''} | ویدئو: ${videoCount}${videoLimit ? `/${videoLimit}` : ''})</div>
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
        labelEl.textContent = `دانلود (موزیک: ${audioCount}${audioLimit ? `/${audioLimit}` : ''} | ویدئو: ${videoCount}${videoLimit ? `/${videoLimit}` : ''})`;
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
      minutes: 0
    });
  }
  
  history.forEach(item => {
    const itemDate = new Date(item.date).toDateString();
    const dayData = last7Days.find(d => d.date === itemDate);
    if (dayData) {
      dayData.minutes += item.minutes || 0;
    }
  });
  
  // Draw daily usage bars
  const barWidth = (width - 60) / 7;
  const maxMinutes = Math.max(...last7Days.map(d => d.minutes), 1);
  const barHeight = 200;
  
  last7Days.forEach((day, index) => {
    const x = 30 + index * barWidth;
    const barH = maxMinutes > 0 ? (day.minutes / maxMinutes) * barHeight : 0;
    const y = 50 + barHeight - barH;
    
    // Draw bar
    ctx.fillStyle = subscriptionInfo.plan === 'free' ? '#ef4444' : '#6366f1';
    ctx.fillRect(x, y, barWidth - 5, barH);
    
    // Draw day label
    const dayName = new Date(day.date).toLocaleDateString('fa-IR', { weekday: 'short' });
    ctx.fillStyle = '#666';
    ctx.font = '12px Vazirmatn';
    ctx.textAlign = 'center';
    ctx.fillText(dayName, x + barWidth / 2 - 2.5, height - 10);
    
    // Draw minutes label
    if (day.minutes > 0) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = '10px Vazirmatn';
      ctx.fillText(`${day.minutes}د`, x + barWidth / 2 - 2.5, y - 5);
    }
  });
  
  // Draw summary text
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '16px Vazirmatn';
  ctx.textAlign = 'right';
  ctx.fillText(`مجموع: ${used} / ${limit} دقیقه (${percentage.toFixed(1)}%)`, width - 20, 30);
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
        showPlansError('داده‌های پلن نامعتبر است');
      }
    } else {
      const errorData = await response.json().catch(() => ({}));
      console.error('Error loading plans:', response.status, errorData);
      showPlansError('خطا در بارگذاری پلن‌ها');
    }
  } catch (error) {
    console.error('Error loading plans:', error);
    showPlansError('خطا در اتصال به سرور');
  }
}

function showPlansError(message) {
  const plansGrid = document.getElementById('plansGrid');
  if (plansGrid) {
    plansGrid.innerHTML = `<div class="error-message" style="text-align: center; padding: 48px; color: #ef4444;">
      <p>${message}</p>
      <button onclick="loadPlans()" style="margin-top: 16px; padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">تلاش مجدد</button>
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
    plansGrid.innerHTML = '<div class="empty-state"><p>پلنی یافت نشد</p></div>';
    return;
  }
  
  // Find free plan
  const freePlan = plans.find(p => p.id === 'free');
  const paidPlans = plans.filter(p => p.id !== 'free');
  
  // Sort paid plans: starter, pro, business
  const sortedPaidPlans = ['starter', 'pro', 'business']
    .map(id => paidPlans.find(p => p.id === id))
    .filter(p => p);
  
  plansGrid.innerHTML = '';
  
  // Display free plan info first (just text, no card)
  if (freePlan) {
    const freeInfo = document.createElement('div');
    freeInfo.className = 'free-plan-text';
    freeInfo.innerHTML = `
      <h3 class="free-plan-title">💎 پلن رایگان</h3>
      <p class="free-plan-description">
        در حالت عادی یا همان عضویت رایگان، شما محدودیت‌های زیر را دارید:
      </p>
      <ul class="free-plan-limits">
        <li>✅ حداکثر 3 دقیقه خلاصه‌سازی در روز یا 20 دقیقه در ماه</li>
        <li>✅ دانلود موزیک: 3 دانلود در ماه</li>
        <li>✅ دانلود ویدئو: 3 دانلود در ماه (فقط تا کیفیت 480p)</li>
        <li>❌ بدون ویژگی‌های پیشرفته مثل زیرنویس‌سازی و خلاصه</li>
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
    const audioText = audioLimit ? `${audioLimit} دانلود در ماه` : 'نامحدود';
    const videoText = videoLimit ? `${videoLimit} دانلود در ماه` : 'نامحدود';
    
    planCard.innerHTML = `
      <div class="paid-plan-header">
        <div class="paid-plan-name">${plan.name}</div>
        ${plan.id === subscriptionInfo?.plan ? '<div class="current-badge">پلن فعلی</div>' : ''}
      </div>
      <div class="plan-billing-selector">
        <label>انتخاب دوره:</label>
        <select class="billing-period-select" data-plan-id="${plan.id}" onchange="updatePlanPrice('${plan.id}', this.value)">
          <option value="monthly">ماهانه</option>
          <option value="quarterly">سه‌ماهه (10% تخفیف)</option>
          <option value="semiannual">شش‌ماهه (15% تخفیف)</option>
          <option value="annual">سالانه (25% تخفیف)</option>
        </select>
      </div>
      <div class="plan-price-section" id="price-${plan.id}">
        ${calculatePlanPriceHTML(plan, 'monthly')}
      </div>
      <ul class="plan-features">
        <li>${plan.monthlyLimit} دقیقه در ماه</li>
        <li>✅ خلاصه‌سازی هوشمند</li>
        <li>✅ زیرنویس SRT</li>
        <li>✅ دانلود موزیک: ${audioText}</li>
        <li>✅ دانلود ویدئو: ${videoText}</li>
      </ul>
      <button class="plan-btn ${plan.id === subscriptionInfo?.plan ? 'current' : ''}" 
              onclick="addToCart('${plan.id}', document.querySelector('[data-plan-id=\\'${plan.id}\\'] .billing-period-select').value)">
        ${plan.id === subscriptionInfo?.plan ? 'پلن فعلی' : 'افزودن به سبد خرید'}
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
      <span class="price-main">${formatPrice(price)} تومان</span>
      ${discount > 0 ? `
        <span class="price-original">${formatPrice(originalPrice)} تومان</span>
        <span class="price-discount">${discount}% تخفیف</span>
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
    monthly: 'ماهانه',
    quarterly: 'سه‌ماهه',
    semiannual: 'شش‌ماهه',
    annual: 'سالانه'
  };
  return names[period] || 'ماهانه';
}

function formatPrice(price) {
  return new Intl.NumberFormat('fa-IR').format(price);
}

async function upgradePlan(planId, billingPeriod) {
  if (subscriptionInfo?.plan === planId) {
    alert('شما در حال حاضر این پلن را دارید');
    return;
  }
  
  if (!confirm(`آیا می‌خواهید به پلن ${planId} ارتقا دهید؟`)) {
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
      alert('پلن شما با موفقیت ارتقا یافت!');
      await loadSubscriptionInfo();
    } else {
      const error = await response.json();
      alert(`خطا: ${error.message || 'ارتقای پلن ناموفق بود'}`);
    }
  } catch (error) {
    console.error('Error upgrading plan:', error);
    alert('خطا در ارتقای پلن');
  }
}

async function loadUsageHistory() {
  const usageDetails = document.getElementById('usageDetails');
  if (!usageDetails) return;
  
  usageDetails.innerHTML = '<p>در حال بارگذاری...</p>';
  
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
      usageDetails.innerHTML = '<p>در حال بارگذاری...</p>';
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
      const dateStr = date.toLocaleDateString('fa-IR', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      let typeLabel = '';
      let icon = '';
      switch(item.type) {
        case 'transcription':
          typeLabel = 'تبدیل به متن';
          icon = '📋';
          break;
        case 'summarization':
          typeLabel = 'خلاصه‌سازی';
          icon = '📝';
          break;
        case 'downloadAudio':
          typeLabel = 'دانلود موزیک';
          icon = '🎵';
          break;
        case 'downloadVideo':
          typeLabel = 'دانلود ویدئو';
          icon = '🎬';
          break;
        default:
          typeLabel = item.type;
          icon = '📄';
      }
      
      const title = item.metadata?.title || 'بدون عنوان';
      const quality = item.metadata?.quality ? ` (${item.metadata.quality})` : '';
      const minutes = item.minutes > 0 ? ` - ${item.minutes} دقیقه` : '';
      
      return `
        <div class="history-item">
          <div class="history-icon">${icon}</div>
          <div class="history-content">
            <div class="history-title">${title}${quality}</div>
            <div class="history-meta">
              <span class="history-type">${typeLabel}</span>
              ${minutes ? `<span class="history-duration">${minutes}</span>` : ''}
              <span class="history-date">${dateStr}</span>
            </div>
          </div>
        </div>
      `;
    };
    
    let historyHTML = `
      <div class="usage-summary">
        <h3>خلاصه استفاده این ماه</h3>
        <div class="usage-stats">
          <div class="usage-stat-item">
            <span class="usage-stat-label">دقیقه استفاده شده:</span>
            <span class="usage-stat-value">${usage.monthly.minutes || 0} دقیقه</span>
          </div>
          <div class="usage-stat-item">
            <span class="usage-stat-label">حد مجاز:</span>
            <span class="usage-stat-value">${subscriptionInfo.usage.monthlyLimit || 0} دقیقه</span>
          </div>
          ${usage.downloads ? `
          <div class="usage-stat-item">
            <span class="usage-stat-label">دانلود موزیک:</span>
            <span class="usage-stat-value">${usage.downloads.audio?.count || 0}${usage.downloads.audio?.limit ? ` / ${usage.downloads.audio.limit}` : ''}</span>
          </div>
          <div class="usage-stat-item">
            <span class="usage-stat-label">دانلود ویدئو:</span>
            <span class="usage-stat-value">${usage.downloads.video?.count || 0}${usage.downloads.video?.limit ? ` / ${usage.downloads.video.limit}` : ''}</span>
          </div>
          ` : ''}
        </div>
      </div>
      <div class="usage-history">
        <h3>تاریخچه استفاده</h3>
        ${history.length > 0 ? `
          <div class="history-list">
            ${history.map(formatHistoryItem).join('')}
          </div>
        ` : `
          <p class="info-text">هنوز فعالیتی ثبت نشده است.</p>
        `}
      </div>
    `;
    
    usageDetails.innerHTML = historyHTML;
  } catch (error) {
    console.error('Error loading usage history:', error);
    usageDetails.innerHTML = '<p>خطا در بارگذاری تاریخچه استفاده</p>';
  }
}

// Shopping Cart Functions
function addToCart(planId, billingPeriod) {
  if (!subscriptionInfo) {
    alert('لطفاً صبر کنید تا اطلاعات بارگذاری شود');
    return;
  }
  
  if (planId === subscriptionInfo?.plan) {
    alert('شما در حال حاضر این پلن را دارید');
    return;
  }
  
  fetch(`${API_BASE_URL}/api/subscription?action=plans`)
    .then(response => response.json())
    .then(data => {
      const plan = data.plans.find(p => p.id === planId);
      if (!plan) {
        alert('پلن یافت نشد');
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
      alert('خطا در بارگذاری اطلاعات پلن');
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
  notification.textContent = 'به سبد خرید اضافه شد!';
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
    cartItems.innerHTML = '<div class="empty-cart"><p>سبد خرید شما خالی است</p></div>';
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
          <p>دوره: ${getPeriodName(item.billingPeriod)}</p>
          <p>محدودیت: ${item.monthlyLimit} دقیقه در ماه</p>
        </div>
        <div class="cart-item-price">
          <div class="cart-item-price-main">${formatPrice(item.price)} تومان</div>
          ${item.discount > 0 ? `
            <div class="cart-item-price-original">${formatPrice(item.originalPrice)} تومان</div>
            <div class="cart-item-discount">${item.discount}% تخفیف</div>
          ` : ''}
        </div>
        <button class="cart-item-remove" onclick="removeFromCart(${item.id})">🗑️</button>
      </div>
    `;
  }).join('');
  
  cartSummary.innerHTML = `
    <div class="cart-summary-content">
      <div class="summary-row">
        <span>جمع کل:</span>
        <span>${formatPrice(total)} تومان</span>
      </div>
      ${totalDiscount > 0 ? `
      <div class="summary-row discount">
        <span>تخفیف:</span>
        <span>-${formatPrice(totalDiscount)} تومان</span>
      </div>
      ` : ''}
      <div class="summary-row total">
        <span>مبلغ نهایی:</span>
        <span>${formatPrice(total)} تومان</span>
      </div>
      <button class="checkout-btn" onclick="checkout()">تسویه حساب</button>
    </div>
  `;
}

function checkout() {
  if (shoppingCart.length === 0) {
    alert('سبد خرید شما خالی است');
    return;
  }
  
  if (!confirm(`آیا می‌خواهید ${shoppingCart.length} آیتم را خریداری کنید؟`)) {
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
          <h2>فاکتور</h2>
          <button class="close-btn" onclick="closeInvoiceModal()">✕</button>
        </div>
        <div class="invoice-body">
          <div class="invoice-info">
            <p><strong>شماره فاکتور:</strong> ${invoice.id}</p>
            <p><strong>تاریخ:</strong> ${new Date(invoice.date).toLocaleDateString('fa-IR')}</p>
            <p><strong>زمان:</strong> ${new Date(invoice.date).toLocaleTimeString('fa-IR')}</p>
            <p><strong>وضعیت:</strong> <span class="invoice-status ${invoice.status}">${getInvoiceStatusText(invoice.status)}</span></p>
          </div>
          <div class="invoice-items">
            <h3>آیتم‌ها:</h3>
            ${invoice.items.map(item => `
              <div class="invoice-item">
                <span>${item.planName} - ${getPeriodName(item.billingPeriod)}</span>
                <span>${formatPrice(item.price)} تومان</span>
              </div>
            `).join('')}
          </div>
          <div class="invoice-total">
            <div class="total-row">
              <span>جمع کل:</span>
              <span>${formatPrice(invoice.total)} تومان</span>
            </div>
            ${invoice.discount > 0 ? `
            <div class="total-row discount">
              <span>تخفیف:</span>
              <span>-${formatPrice(invoice.discount)} تومان</span>
            </div>
            ` : ''}
            <div class="total-row final">
              <span>مبلغ نهایی:</span>
              <span>${formatPrice(invoice.total)} تومان</span>
            </div>
          </div>
          <div class="invoice-actions">
            <button class="btn-download-pdf" onclick="downloadInvoicePDF(${invoice.id})">دانلود PDF</button>
            ${invoice.status === 'pending' || invoice.status === 'cancelled' ? `
            <button class="btn-delete-invoice" onclick="deleteInvoice(${invoice.id})">حذف فاکتور</button>
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
    pending: 'در انتظار پرداخت',
    paid: 'پرداخت شده',
    cancelled: 'لغو شده'
  };
  return statusTexts[status] || status;
}

function downloadInvoicePDF(invoiceId) {
  // This will be implemented with a PDF library
  alert('دانلود PDF به زودی فعال می‌شود');
}

function deleteInvoice(invoiceId) {
  if (!confirm('آیا مطمئن هستید که می‌خواهید این فاکتور را حذف کنید؟')) {
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
    financialInfo.innerHTML = '<div class="empty-state"><p>فاکتوری وجود ندارد</p></div>';
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
              <p><strong>تاریخ:</strong> ${new Date(invoice.date).toLocaleDateString('fa-IR')}</p>
              <p><strong>زمان:</strong> ${new Date(invoice.date).toLocaleTimeString('fa-IR')}</p>
              <p><strong>تعداد آیتم:</strong> ${invoice.items.length}</p>
              <p><strong>مبلغ:</strong> ${formatPrice(invoice.total)} تومان</p>
            </div>
            <div class="invoice-card-actions">
              <button class="btn-view-invoice" onclick="showInvoice(${JSON.stringify(invoice).replace(/"/g, '&quot;')})">مشاهده فاکتور</button>
              <button class="btn-download-pdf" onclick="downloadInvoicePDF(${invoice.id})">دانلود PDF</button>
              ${invoice.status === 'pending' || invoice.status === 'cancelled' ? `
              <button class="btn-delete-invoice" onclick="deleteInvoice(${invoice.id})">حذف</button>
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
      <button class="btn-new-ticket" onclick="showNewTicketModal()">ثبت تیکت جدید</button>
    </div>
    <div class="tickets-list">
      ${tickets.length === 0 ? '<div class="empty-state"><p>تیکتی وجود ندارد</p></div>' : tickets.map(ticket => `
        <div class="ticket-card">
          <div class="ticket-header">
            <div class="ticket-id">#${ticket.id}</div>
            <div class="ticket-status ${ticket.status}">${getTicketStatusText(ticket.status)}</div>
          </div>
          <div class="ticket-body">
            <h4>${ticket.subject}</h4>
            <p>${ticket.message.substring(0, 100)}...</p>
            <p class="ticket-date">${new Date(ticket.date).toLocaleDateString('fa-IR')}</p>
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
          <h2>ثبت تیکت جدید</h2>
          <button class="close-btn" onclick="closeTicketModal()">✕</button>
        </div>
        <div class="ticket-modal-body">
          <form id="newTicketForm" onsubmit="submitTicket(event)">
            <div class="form-group">
              <label>موضوع:</label>
              <input type="text" name="subject" required>
            </div>
            <div class="form-group">
              <label>پیام:</label>
              <textarea name="message" rows="5" required></textarea>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-submit">ثبت تیکت</button>
              <button type="button" class="btn-cancel" onclick="closeTicketModal()">انصراف</button>
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
  alert('تیکت شما با موفقیت ثبت شد');
}

function getTicketStatusText(status) {
  const statusTexts = {
    open: 'باز',
    closed: 'بسته',
    pending: 'در انتظار'
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
    window.location.href = '/';
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
