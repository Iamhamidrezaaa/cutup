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
const API_BASE_URL = 'https://cutup.shop';
const DASHBOARD_HISTORY_KEY = 'cutup_dashboard_history'; // Shared key for localStorage
let currentSession = null;

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
    window.location.href = `index.html?session=${sessionId}`;
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
  alert('خطا در ورود. لطفاً دوباره تلاش کنید.');
}

// Load user profile on page load
window.addEventListener('DOMContentLoaded', () => {
  console.log('[script] DOMContentLoaded event fired');
  const savedSession = localStorage.getItem('cutup_session');
  console.log('[script] Saved session from localStorage:', savedSession);
  
  // Ensure login button is visible by default
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.style.display = 'block';
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
          'youtube': 'لینک یوتیوب را وارد کنید',
          'instagram': 'لینک اینستاگرام را وارد کنید',
          'tiktok': 'لینک تیک‌تاک را وارد کنید',
          'audiofile': 'فایل صوتی انتخاب کنید'
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

async function updateButtonsBasedOnSubscription(sessionId) {
  try {
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    if (!subResponse.ok) {
      // Default to free plan if can't fetch
      setButtonsForFreePlan();
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
    
    // Get plan limits
    const planLimits = {
      free: { audio: 3, video: 3, minutes: 20 },
      starter: { audio: 20, video: 20, minutes: 120 },
      pro: { audio: 100, video: 100, minutes: 300 },
      business: { audio: null, video: null, minutes: 600 }
    };
    
    const limits = planLimits[userPlan] || planLimits.free;
    
    // Use API counts (which are reset for h.asgarizade@gmail.com)
    const audioCount = apiAudio.count || 0;
    const videoCount = apiVideo.count || 0;
    const minutesUsed = apiUsage.monthly?.minutes || 0;
    
    // Store subscription info globally
    window.userSubscription = {
      plan: userPlan,
      features: features,
      usage: {
        ...subData.usage,
        downloads: {
          audio: { count: audioCount, limit: limits.audio },
          video: { count: videoCount, limit: limits.video }
        },
        monthly: { minutes: minutesUsed, limit: limits.minutes }
      }
    };
    
    // Check if limits are exceeded (using API data)
    const audioExceeded = limits.audio !== null && audioCount >= limits.audio;
    const videoExceeded = limits.video !== null && videoCount >= limits.video;
    const minutesExceeded = minutesUsed >= limits.minutes;
    
    console.log('[script] Button state update:', {
      audioCount,
      audioLimit: limits.audio,
      audioExceeded,
      videoCount,
      videoLimit: limits.video,
      videoExceeded
    });
    
    if (userPlan === 'free') {
      setButtonsForFreePlan(audioExceeded, videoExceeded, minutesExceeded);
    } else {
      setButtonsForPaidPlan(audioExceeded, videoExceeded, minutesExceeded, limits);
    }
  } catch (error) {
    console.error('Error loading subscription info:', error);
    // Default to free plan on error
    setButtonsForFreePlan();
  }
}

// Set buttons state for free plan
function setButtonsForFreePlan(audioExceeded = false, videoExceeded = false, minutesExceeded = false) {
  // Subtitle button should be disabled/hidden for free users
  if (downloadSubtitleBtnMain) {
    downloadSubtitleBtnMain.style.opacity = '0.5';
    downloadSubtitleBtnMain.style.cursor = 'not-allowed';
    downloadSubtitleBtnMain.title = 'این ویژگی فقط برای کاربران Paid در دسترس است';
    downloadSubtitleBtnMain.disabled = true;
  }
  
  // Audio button - check limit
  if (downloadAudioBtnMain) {
    if (audioExceeded) {
      downloadAudioBtnMain.style.opacity = '0.5';
      downloadAudioBtnMain.style.cursor = 'not-allowed';
      downloadAudioBtnMain.title = 'حد مجاز دانلود موزیک شما تمام شده است. برای دانلود نامحدود، لطفاً پلن خود را ارتقا دهید.';
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
      downloadVideoBtnMain.title = 'حد مجاز دانلود ویدئو شما تمام شده است. برای دانلود نامحدود، لطفاً پلن خود را ارتقا دهید.';
      downloadVideoBtnMain.disabled = true;
    } else {
      downloadVideoBtnMain.style.opacity = '1';
      downloadVideoBtnMain.style.cursor = 'pointer';
      downloadVideoBtnMain.title = '';
      downloadVideoBtnMain.disabled = false;
    }
  }
  
  // Summarize and full text - check minutes limit
  if (summarizeBtnMain) {
    if (minutesExceeded) {
      summarizeBtnMain.style.opacity = '0.5';
      summarizeBtnMain.style.cursor = 'not-allowed';
      summarizeBtnMain.title = 'حد مجاز استفاده شما تمام شده است. برای استفاده نامحدود، لطفاً پلن خود را ارتقا دهید.';
      summarizeBtnMain.disabled = true;
    } else {
      summarizeBtnMain.style.opacity = '1';
      summarizeBtnMain.style.cursor = 'pointer';
      summarizeBtnMain.title = '';
      summarizeBtnMain.disabled = false;
    }
  }
  
  if (fullTextBtnMain) {
    if (minutesExceeded) {
      fullTextBtnMain.style.opacity = '0.5';
      fullTextBtnMain.style.cursor = 'not-allowed';
      fullTextBtnMain.title = 'حد مجاز استفاده شما تمام شده است. برای استفاده نامحدود، لطفاً پلن خود را ارتقا دهید.';
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
function setButtonsForPaidPlan(audioExceeded = false, videoExceeded = false, minutesExceeded = false, limits = null) {
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
      downloadAudioBtnMain.title = 'حد مجاز دانلود موزیک شما تمام شده است. برای دانلود نامحدود، لطفاً پلن خود را ارتقا دهید.';
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
      downloadVideoBtnMain.title = 'حد مجاز دانلود ویدئو شما تمام شده است. برای دانلود نامحدود، لطفاً پلن خود را ارتقا دهید.';
      downloadVideoBtnMain.disabled = true;
    } else {
      downloadVideoBtnMain.style.opacity = '1';
      downloadVideoBtnMain.style.cursor = 'pointer';
      downloadVideoBtnMain.title = '';
      downloadVideoBtnMain.disabled = false;
    }
  }
  
  // Summarize and full text - check minutes limit
  if (summarizeBtnMain) {
    if (minutesExceeded) {
      summarizeBtnMain.style.opacity = '0.5';
      summarizeBtnMain.style.cursor = 'not-allowed';
      summarizeBtnMain.title = 'حد مجاز استفاده شما تمام شده است. برای استفاده نامحدود، لطفاً پلن خود را ارتقا دهید.';
      summarizeBtnMain.disabled = true;
    } else {
      summarizeBtnMain.style.opacity = '1';
      summarizeBtnMain.style.cursor = 'pointer';
      summarizeBtnMain.title = '';
      summarizeBtnMain.disabled = false;
    }
  }
  
  if (fullTextBtnMain) {
    if (minutesExceeded) {
      fullTextBtnMain.style.opacity = '0.5';
      fullTextBtnMain.style.cursor = 'not-allowed';
      fullTextBtnMain.title = 'حد مجاز استفاده شما تمام شده است. برای استفاده نامحدود، لطفاً پلن خود را ارتقا دهید.';
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
  document.getElementById('loginBtn').style.display = 'block';
  document.getElementById('userProfile').style.display = 'none';
}

function showUserProfile(user) {
  console.log('[script] showUserProfile called with:', user);
  
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
    dashboardLink.href = `dashboard.html?session=${sessionId}`;
    dashboardLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `dashboard.html?session=${sessionId}`;
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
    });
  }
  
  console.log('[script] User profile displayed successfully');
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

// Logout button is now handled in showUserProfile function

// Download functionality - wait for DOM to be ready
let youtubeUrlInput, audioFileInput, downloadVideoBtnMain, downloadAudioBtnMain;
let downloadSubtitleBtnMain, summarizeBtnMain, fullTextBtnMain, downloadMessage;

document.addEventListener('DOMContentLoaded', () => {
  youtubeUrlInput = document.getElementById('youtubeUrlInput');
  audioFileInput = document.getElementById('audioFileInput');
  downloadVideoBtnMain = document.getElementById('downloadVideoBtnMain');
  downloadAudioBtnMain = document.getElementById('downloadAudioBtnMain');
  downloadSubtitleBtnMain = document.getElementById('downloadSubtitleBtnMain');
  downloadMessage = document.getElementById('downloadMessage');
  summarizeBtnMain = document.getElementById('summarizeBtnMain');
  fullTextBtnMain = document.getElementById('fullTextBtnMain');
  
  // Setup login button event listener using event delegation (simple and reliable)
  document.addEventListener('click', async function(e) {
    const btn = e.target.closest('#loginBtn');
    if (!btn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Disable button to prevent double clicks
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'در حال اتصال...';
    
    try {
      console.log('[script] Login button clicked, fetching auth URL from /api/oauth/google/start...');
      const response = await fetch(`${API_BASE_URL}/api/oauth/google/start`, { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[script] Auth response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[script] Auth error response:', response.status, errorText);
        throw new Error(`Server error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[script] Auth data received:', data);
      
      if (!data?.authUrl) {
        console.error('[script] No authUrl in response:', data);
        throw new Error('No authUrl returned from server');
      }
      
      console.log('[script] Redirecting to Google OAuth:', data.authUrl);
      window.location.href = data.authUrl;
    } catch (error) {
      console.error('[script] Google login failed:', error);
      btn.disabled = false;
      btn.innerHTML = originalText;
      alert('ورود با گوگل با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
    }
  });
  
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
  
  if (summarizeBtnMain) {
    summarizeBtnMain.addEventListener('click', async () => {
      await handleSummarize();
    });
  }
  
  if (fullTextBtnMain) {
    fullTextBtnMain.addEventListener('click', async () => {
      await handleFullText();
    });
  }
  
  if (downloadSubtitleBtnMain) {
    downloadSubtitleBtnMain.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) return;
      
      const url = getCurrentUrl();
      if (!isValidUrl(url)) {
        showMessage('لینک یوتیوب معتبر نیست', 'error');
        return;
      }
      
      try {
        const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
        const subData = await subResponse.ok ? await subResponse.json() : { plan: 'free' };
        const userPlan = subData.plan || 'free';
        
        if (userPlan === 'free') {
          showMessage('دانلود زیرنویس فقط برای کاربران Paid در دسترس است. لطفاً پلن خود را ارتقا دهید.', 'error');
          window.open(`dashboard.html?session=${sessionId}`, '_blank');
          return;
        }
        
        // Show progress bar
        showProgressBar('در حال دریافت ویدئو و استخراج زیرنویس...', false);
        updateProgressBar(0, 0, 0, 'در حال دریافت اطلاعات ویدئو...');
        
        animateProgressTo(30, 'در حال دریافت اطلاعات ویدئو...', 2000);
        const videoId = extractVideoId(url);
        const youtubeResponse = await fetch(`${API_BASE_URL}/api/youtube`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId
        },
          body: JSON.stringify({ videoId, url })
        });
        
        if (!youtubeResponse.ok) {
          throw new Error('خطا در دریافت ویدئو');
        }
        
        const youtubeData = await youtubeResponse.json();
        
        if (!youtubeData.subtitles) {
          showMessage('زیرنویس برای این ویدئو در دسترس نیست.', 'error');
          hideProgressBar();
          return;
        }
        
        updateProgressBar(0, 0, 30, 'اطلاعات ویدئو دریافت شد');
        animateProgressTo(90, 'در حال پردازش زیرنویس...', 2000);
        const srtContent = generateSRTFromSubtitles(youtubeData.subtitles, youtubeData.subtitleLanguage);
        updateProgressBar(0, 0, 100, 'زیرنویس آماده شد');
        
        showSubtitleModal(srtContent, youtubeData.subtitleLanguage || 'en', videoId, sessionId);
        hideProgressBar();
        
    } catch (error) {
        console.error('Error:', error);
        showMessage('خطا در دریافت زیرنویس: ' + error.message, 'error');
      }
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

// Get platform name in Persian
function getPlatformName(platform) {
  const names = {
    'youtube': 'یوتیوب',
    'tiktok': 'تیک‌تاک',
    'instagram': 'اینستاگرام'
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

// Show message
function showMessage(text, type = 'info') {
  downloadMessage.textContent = text;
  downloadMessage.className = `download-message ${type}`;
  downloadMessage.style.display = 'block';
  
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      downloadMessage.style.display = 'none';
    }, 5000);
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
    
    showMessage('برای استفاده از این قابلیت، لطفاً ابتدا وارد حساب کاربری خود شوید.', 'error');
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
          showMessage('لطفاً یکی از گزینه‌های بالا را انتخاب کنید', 'info');
        }
        // Error message is already shown in checkInput() if URL is invalid
      }
    } else {
      showMessage('کلیپ‌بورد خالی است', 'error');
    }
  } catch (error) {
    console.error('Error reading clipboard:', error);
    showMessage('خطا در خواندن کلیپ‌بورد. لطفاً لینک را دستی وارد کنید.', 'error');
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
  
  const summarizeBtnInstagram = document.getElementById('summarizeBtnInstagram');
  if (summarizeBtnInstagram) {
    summarizeBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleSummarize();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnInstagram = document.getElementById('fullTextBtnInstagram');
  if (fullTextBtnInstagram) {
    fullTextBtnInstagram.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'instagram';
      await handleFullText();
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
  
  const summarizeBtnTiktok = document.getElementById('summarizeBtnTiktok');
  if (summarizeBtnTiktok) {
    summarizeBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleSummarize();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnTiktok = document.getElementById('fullTextBtnTiktok');
  if (fullTextBtnTiktok) {
    fullTextBtnTiktok.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'tiktok';
      await handleFullText();
      currentPlatform = originalPlatform;
    });
  }
  
  // Audio file buttons
  const summarizeBtnAudiofile = document.getElementById('summarizeBtnAudiofile');
  if (summarizeBtnAudiofile) {
    summarizeBtnAudiofile.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'audiofile';
      await handleSummarize();
      currentPlatform = originalPlatform;
    });
  }
  
  const fullTextBtnAudiofile = document.getElementById('fullTextBtnAudiofile');
  if (fullTextBtnAudiofile) {
    fullTextBtnAudiofile.addEventListener('click', async () => {
      const originalPlatform = currentPlatform;
      currentPlatform = 'audiofile';
      await handleFullText();
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
});

// Extract common handlers
async function handleVideoDownload() {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = getCurrentUrl();
  if (!isValidUrl(url)) {
    const platformName = currentPlatform === 'youtube' ? 'یوتیوب' : 
                         currentPlatform === 'tiktok' ? 'تیک‌تاک' : 
                         currentPlatform === 'instagram' ? 'اینستاگرام' : '';
    showMessage(`لینک ${platformName} معتبر نیست`, 'error');
    return;
  }
  
  try {
    const limitCheck = await checkSubscriptionLimit(sessionId, 'downloadVideo', 0);
    if (limitCheck && !limitCheck.allowed && limitCheck.reason && !limitCheck.reason.includes('proceeding anyway')) {
      showMessage(limitCheck.reason || 'حد مجاز دانلود ویدئو شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      return;
    }
    
    showMessage('در حال دریافت کیفیت‌های موجود...', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url, platform: currentPlatform })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('خطا در دریافت کیفیت‌ها');
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
    showMessage('خطا در دریافت کیفیت‌ها: ' + error.message, 'error');
    // Hide the "در حال دریافت کیفیت‌های موجود..." message
    setTimeout(() => {
      const downloadMessage = document.getElementById('downloadMessage');
      if (downloadMessage && downloadMessage.textContent.includes('در حال دریافت کیفیت')) {
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
    const platformName = currentPlatform === 'youtube' ? 'یوتیوب' : 
                         currentPlatform === 'tiktok' ? 'تیک‌تاک' : 
                         currentPlatform === 'instagram' ? 'اینستاگرام' : '';
    showMessage(`لینک ${platformName} معتبر نیست`, 'error');
    return;
  }
  
  try {
    const limitCheck = await checkSubscriptionLimit(sessionId, 'downloadAudio', 0);
    if (limitCheck && !limitCheck.allowed && limitCheck.reason && !limitCheck.reason.includes('proceeding anyway')) {
      showMessage(limitCheck.reason || 'حد مجاز دانلود موزیک شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      return;
    }
    
    showMessage('در حال دریافت کیفیت‌های موجود...', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url, platform: currentPlatform })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('خطا در دریافت کیفیت‌ها');
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
    showMessage('خطا در دریافت کیفیت‌ها: ' + error.message, 'error');
    // Hide the "در حال دریافت کیفیت‌های موجود..." message
    setTimeout(() => {
      const downloadMessage = document.getElementById('downloadMessage');
      if (downloadMessage && downloadMessage.textContent.includes('در حال دریافت کیفیت')) {
        downloadMessage.style.display = 'none';
  }
    }, 3000);
  }
}

async function handleSummarize() {
  const sessionId = checkLogin();
  if (!sessionId) {
    showMessage('لطفاً ابتدا وارد حساب کاربری خود شوید', 'error');
    return;
  }
  
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
  
  if (!url && !file) {
    if (currentPlatform === 'audiofile') {
      showMessage('لطفاً فایل صوتی را انتخاب کنید', 'error');
    } else {
      showMessage('لطفاً لینک را وارد کنید', 'error');
    }
      return;
    }
    
  if (file && url.startsWith('📁')) {
    await processSummarizeFile(file, sessionId);
  } else if (isValidUrl(url)) {
    await processSummarize(url, sessionId);
  } else {
    showMessage('لینک معتبر نیست', 'error');
  }
}

async function handleFullText() {
  const sessionId = checkLogin();
  if (!sessionId) {
    showMessage('لطفاً ابتدا وارد حساب کاربری خود شوید', 'error');
    return;
    }
    
  const url = getCurrentUrl();
  const file = audioFileInput && audioFileInput.files[0];
    
  if (!url && !file) {
    if (currentPlatform === 'audiofile') {
      showMessage('لطفاً فایل صوتی را انتخاب کنید', 'error');
    } else {
      showMessage('لطفاً لینک را وارد کنید', 'error');
    }
      return;
    }
    
  if (file && url.startsWith('📁')) {
    await processFullTextFile(file, sessionId);
  } else if (isValidUrl(url)) {
    await processFullText(url, sessionId);
  } else {
    showMessage('لینک معتبر نیست', 'error');
  }
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

// Check subscription limit before processing
async function checkSubscriptionLimit(sessionId, feature, videoDurationMinutes = 0) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ feature, videoDurationMinutes })
    });
    
    if (!response.ok) {
      // If check fails, log but don't block - allow the operation
      console.warn('Subscription check failed with status:', response.status, 'Allowing operation to continue');
      const errorText = await response.text().catch(() => '');
      console.warn('Error response:', errorText);
      // Return allowed: true to not block the operation
      return { allowed: true, reason: 'Unable to verify limit, proceeding anyway' };
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error checking subscription limit:', error);
    // Don't block on network errors - allow operation to continue
    return { allowed: true, reason: 'Network error checking limit, proceeding anyway' };
  }
}

// Event listeners are now set up in DOMContentLoaded above

// Process summarize for file
async function processSummarizeFile(file, sessionId) {
  try {
    // Show progress bar
    showProgressBar('در حال پردازش فایل...', false);
    updateProgressBar(0, 0, 0, 'در حال بررسی فایل...');
    
    // Check file size (limit to 100MB like extension)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxFileSize) {
      showMessage(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxFileSize / 1024 / 1024}MB است.`, 'error');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 5, 'بررسی فایل انجام شد');
    
    // Estimate duration for limit check
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    
    // Check subscription limit
    updateProgressBar(0, 0, 8, 'در حال بررسی محدودیت‌ها...');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', estimatedDurationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || 'حد مجاز شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 10, 'بررسی محدودیت‌ها انجام شد');
    
    // Transcribe using transcribeAudio (like extension)
    animateProgressTo(60, 'در حال تبدیل صوت به متن...', 6000);
    const transcription = await transcribeAudio(file, null);
    updateProgressBar(0, 0, 60, 'تبدیل صوت به متن انجام شد');
    
    // Summarize (unlimited for all tiers)
    animateProgressTo(90, 'در حال خلاصه‌سازی...', 4000);
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, transcription.language);
      updateProgressBar(0, 0, 90, 'خلاصه‌سازی انجام شد');
    } catch (error) {
      console.error('Error in summarization:', error);
      // Continue without summary if check fails
      summary = {
        keyPoints: ['خطا در خلاصه‌سازی'],
        summary: 'متن با موفقیت تبدیل شد اما خلاصه‌سازی در دسترس نیست.'
      };
    }
    
    updateProgressBar(0, 0, 100, 'پردازش کامل شد');
    
    // Display results in result section - تب خلاصه به صورت پیش‌فرض فعال باشد
    displayResults(summary, transcription.text, transcription.segments || [], {
      originalLanguage: transcription.language || 'en',
      activeTab: 'summary'
    });
    
    // Record usage (estimate from file size: ~1MB per minute)
    await recordUsage(sessionId, 'summarization', estimatedDurationMinutes, {
      title: file.name,
      fileName: file.name,
      fileSize: file.size
    });
    
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
    
    // Hide progress bar
    hideProgressBar();
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
    hideProgressBar();
  }
}

// Process full text for file
async function processFullTextFile(file, sessionId) {
  try {
    // Show progress bar
    showProgressBar('در حال پردازش فایل...', false);
    updateProgressBar(0, 0, 0, 'در حال بررسی فایل...');
    
    // Check file size (limit to 100MB like extension)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxFileSize) {
      showMessage(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxFileSize / 1024 / 1024}MB است.`, 'error');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 5, 'بررسی فایل انجام شد');
    
    // Estimate duration for limit check
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    
    // Check subscription limit
    updateProgressBar(0, 0, 8, 'در حال بررسی محدودیت‌ها...');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', estimatedDurationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || 'حد مجاز شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      hideProgressBar();
      return;
    }
    
    updateProgressBar(0, 0, 10, 'بررسی محدودیت‌ها انجام شد');
    
    // Transcribe using transcribeAudio (like extension)
    animateProgressTo(90, 'در حال تبدیل صوت به متن...', 6000);
    const transcription = await transcribeAudio(file, null);
    updateProgressBar(0, 0, 90, 'تبدیل صوت به متن انجام شد');
    
    updateProgressBar(0, 0, 100, 'پردازش کامل شد');
    
    // Display results in result section - تب متن کامل به صورت پیش‌فرض فعال باشد
    displayResults(null, transcription.text, transcription.segments || [], {
      originalLanguage: transcription.language || 'en',
      activeTab: 'fulltext'
    });
    
    // Record usage (estimate from file size: ~1MB per minute)
    // Use the same estimatedDurationMinutes that was calculated earlier
    await recordUsage(sessionId, 'transcription', estimatedDurationMinutes, {
      title: file.name,
      fileName: file.name,
      fileSize: file.size
    });
    
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
    
    // Hide progress bar
    hideProgressBar();
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
    hideProgressBar();
  }
}

// Extract YouTube audio (like extension)
async function extractYouTubeAudio(url) {
    const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('لینک یوتیوب معتبر نیست');
  }
  
  console.log('YOUTUBE: Extracting audio for video ID:', videoId);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/youtube`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoId, url }),
      signal: AbortSignal.timeout(300000) // 5 minutes timeout
    });

    console.log('YOUTUBE: Response status:', response.status);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('YOUTUBE: Error:', error);
      
      let errorMessage = error.message || error.details || `استخراج صوت از یوتیوب ناموفق بود (${response.status})`;
      
      if (error.error === 'YOUTUBE_ERROR' && error.details?.includes('yt-dlp')) {
        errorMessage = 'yt-dlp روی سرور نصب نیست. لطفاً با مدیر سرور تماس بگیرید.';
      } else if (error.error === 'FILE_TOO_LARGE') {
        errorMessage = error.message || 'ویدئو خیلی بزرگ است. لطفاً ویدئوی کوتاه‌تری انتخاب کنید.';
      }
      
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
      throw new Error('درخواست timeout شد. لطفاً دوباره تلاش کنید یا ویدئوی کوتاه‌تری انتخاب کنید.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('YOUTUBE: Network error', error);
      throw new Error('خطای اتصال. لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.');
    } else {
      throw error;
    }
  }
}

// Transcribe audio (like extension)
async function transcribeAudio(audioUrlOrFile, languageHint = null) {
  try {
    let response;
    
    // If it's a File object, send to upload endpoint
    if (audioUrlOrFile instanceof File) {
      const formData = new FormData();
      formData.append('file', audioUrlOrFile);
      
      console.log('TRANSCRIBE: Sending file to upload endpoint, size:', audioUrlOrFile.size, 'bytes');
      
      response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(900000) // 15 minutes timeout
      });
    } else {
      // Handle JSON request (audioUrl)
      console.log('TRANSCRIBE: Sending request to', `${API_BASE_URL}/api/transcribe`);
      
      const body = { audioUrl: audioUrlOrFile, languageHint };
      
      console.log('TRANSCRIBE: Body size:', JSON.stringify(body).length, 'bytes');
      
      response = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json'
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
      
      let errorMessage = error.message || error.details || `تبدیل صوت به متن ناموفق بود (${response.status})`;
      
      if (error.error === 'QUOTA_ERROR' || error.errorType === 'QuotaError') {
        errorMessage = 'سهمیه OpenAI شما تمام شده است. لطفاً به حساب OpenAI خود بروید و سهمیه یا روش پرداخت را بررسی کنید.';
      } else if (error.error === 'AUTH_ERROR' || error.errorType === 'AuthError') {
        errorMessage = 'کلید API معتبر نیست. لطفاً کلید API را در فایل .env سرور بررسی کنید.';
      } else if (error.retryable || error.error === 'CONNECTION_ERROR') {
        errorMessage = 'خطای اتصال به سرور. لطفاً دوباره تلاش کنید. اگر مشکل ادامه داشت، فایل ممکن است خیلی بزرگ باشد.';
      }
      
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
      throw new Error(`متن تبدیل شده در دسترس نیست. ${result.error ? 'خطا: ' + result.message : 'لطفاً دوباره تلاش کنید.'}`);
    }
    
    console.log('TRANSCRIBE: Success, text length:', result.text.length);
    console.log('TRANSCRIBE: Segments count:', result.segments?.length || 0);
    
    return {
      text: result.text,
      language: result.language || 'unknown',
      segments: (result.segments && Array.isArray(result.segments)) ? result.segments : []
    };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error('TRANSCRIBE: Request timeout');
      throw new Error('درخواست timeout شد. لطفاً دوباره تلاش کنید یا فایل کوچکتری انتخاب کنید.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('TRANSCRIBE: Network error', error);
      throw new Error('خطای اتصال. لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.');
    } else {
      throw error;
    }
  }
}

// Summarize text (like extension)
async function summarizeText(text, language = null) {
  console.log('SUMMARIZE: Sending request, text length:', text.length, 'language:', language);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, language }),
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
      throw new Error(error.details || error.message || `خلاصه‌سازی ناموفق بود (${response.status})`);
    }

    const result = await response.json();
    console.log('SUMMARIZE: Success');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      console.error('SUMMARIZE: Request timeout');
      throw new Error('درخواست خلاصه‌سازی timeout شد. لطفاً دوباره تلاش کنید.');
    } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('SUMMARIZE: Network error', error);
      throw new Error('خطای اتصال. لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.');
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
    language: language || 'en',
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
async function processSummarize(url, sessionId) {
  try {
    // Show progress bar
    showProgressBar('در حال پردازش...', false);
    updateProgressBar(0, 0, 0, 'در حال استخراج صوت از ویدئو...');
    
    // Extract audio from YouTube (like extension)
    animateProgressTo(25, 'در حال استخراج صوت از ویدئو...', 2000);
    const youtubeResult = await extractYouTubeAudio(url);
    const audioUrl = youtubeResult.audioUrl;
    const youtubeLanguage = youtubeResult.language || null;
    
    if (!audioUrl) {
      throw new Error('خطا در استخراج صوت از ویدئو');
    }
    
    updateProgressBar(0, 0, 25, 'استخراج صوت انجام شد');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    // Check subscription limit with actual duration
    updateProgressBar(0, 0, 28, 'در حال بررسی محدودیت‌ها...');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || 'حد مجاز شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      hideProgressBar();
      return;
    }
    
    // Check if YouTube subtitles are available (like extension)
    let transcription = null;
    if (youtubeResult.subtitles) {
      // Use YouTube subtitles if available
      console.log('YOUTUBE: Using YouTube subtitles');
      animateProgressTo(60, 'در حال پردازش زیرنویس‌های یوتیوب...', 3000);
      transcription = await parseYouTubeSubtitles(youtubeResult.subtitles, youtubeResult.subtitleLanguage);
      updateProgressBar(0, 0, 60, 'زیرنویس پردازش شد');
    } else {
      // Fallback to audio transcription
      console.log('YOUTUBE: No subtitles available, transcribing audio');
      animateProgressTo(60, 'در حال تبدیل صوت به متن...', 5000);
      transcription = await transcribeAudio(audioUrl, youtubeLanguage);
      updateProgressBar(0, 0, 60, 'تبدیل صوت به متن انجام شد');
    }
    
    // Summarize (unlimited for all tiers)
    animateProgressTo(90, 'در حال خلاصه‌سازی...', 4000);
    let summary = null;
    try {
      summary = await summarizeText(transcription.text, transcription.language);
      updateProgressBar(0, 0, 90, 'خلاصه‌سازی انجام شد');
    } catch (error) {
      console.error('Error in summarization:', error);
      // Continue without summary if check fails
      summary = {
        keyPoints: ['خطا در خلاصه‌سازی'],
        summary: 'متن با موفقیت تبدیل شد اما خلاصه‌سازی در دسترس نیست.'
      };
    }
    
    updateProgressBar(0, 0, 100, 'پردازش کامل شد');
    
    // Display results در بخش نتیجه - تب خلاصه فعال باشد
    displayResults(summary, transcription.text, transcription.segments || [], {
      isYouTubeSubtitle: !!youtubeResult.subtitles,
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      activeTab: 'summary'
    });
    
    // Record usage
    const duration = youtubeResult.duration ? Math.ceil(youtubeResult.duration / 60) : 0;
    await recordUsage(sessionId, 'summarization', duration, {
      title: youtubeResult.title || 'ویدئو یوتیوب',
      videoId: extractVideoId(url),
      url: url
    });
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: youtubeResult.title || 'ویدئو یوتیوب',
      type: 'summarize',
      transcription: transcription.text,
      summary,
      keyPoints: summary.keyPoints || [],
      duration: youtubeResult.duration || 0
    });
    
    // Update buttons after usage
    await updateButtonsBasedOnSubscription(sessionId);
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
  }
}

// Process full text (using extension logic)
async function processFullText(url, sessionId) {
  try {
    // Show progress bar
    showProgressBar('در حال پردازش...', false);
    updateProgressBar(0, 0, 0, 'در حال استخراج صوت از ویدئو...');
    
    // Extract audio from YouTube (like extension)
    animateProgressTo(25, 'در حال استخراج صوت از ویدئو...', 2000);
    const youtubeResult = await extractYouTubeAudio(url);
    const audioUrl = youtubeResult.audioUrl;
    const youtubeLanguage = youtubeResult.language || null;
    
    if (!audioUrl) {
      throw new Error('خطا در استخراج صوت از ویدئو');
    }
    
    updateProgressBar(0, 0, 25, 'استخراج صوت انجام شد');
    
    // Get actual duration and check limit
    const durationSeconds = youtubeResult.duration || 0;
    const durationMinutes = Math.ceil(durationSeconds / 60);
    
    // Check subscription limit with actual duration
    updateProgressBar(0, 0, 28, 'در حال بررسی محدودیت‌ها...');
    const limitCheck = await checkSubscriptionLimit(sessionId, 'transcription', durationMinutes);
    if (!limitCheck.allowed) {
      showMessage(limitCheck.reason || 'حد مجاز شما تمام شده است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      hideProgressBar();
      return;
    }
    
    // Check if YouTube subtitles are available (like extension)
    let transcription = null;
    if (youtubeResult.subtitles) {
      // Use YouTube subtitles if available
      console.log('YOUTUBE: Using YouTube subtitles');
      animateProgressTo(90, 'در حال پردازش زیرنویس‌های یوتیوب...', 3000);
      transcription = await parseYouTubeSubtitles(youtubeResult.subtitles, youtubeResult.subtitleLanguage);
      updateProgressBar(0, 0, 90, 'زیرنویس پردازش شد');
    } else {
      // Fallback to audio transcription
      console.log('YOUTUBE: No subtitles available, transcribing audio');
      animateProgressTo(90, 'در حال تبدیل صوت به متن...', 5000);
      transcription = await transcribeAudio(audioUrl, youtubeLanguage);
      updateProgressBar(0, 0, 90, 'تبدیل صوت به متن انجام شد');
    }
    
    updateProgressBar(0, 0, 100, 'پردازش کامل شد');
    
    // Display results در بخش نتیجه - تب متن کامل فعال باشد
    displayResults(null, transcription.text, transcription.segments || [], {
      isYouTubeSubtitle: !!youtubeResult.subtitles,
      availableLanguages: youtubeResult.availableLanguages || [],
      originalLanguage: transcription.language,
      activeTab: 'fulltext'
    });
    
    // Record usage
    const duration = youtubeResult.duration ? Math.ceil(youtubeResult.duration / 60) : 0;
    await recordUsage(sessionId, 'transcription', duration, {
      title: youtubeResult.title || 'ویدئو یوتیوب',
      videoId: extractVideoId(url),
      url: url
    });
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: youtubeResult.title || 'ویدئو یوتیوب',
      type: 'transcription',
      transcription: transcription.text,
      segments: transcription.segments || [],
      duration: youtubeResult.duration || 0
    });
    
    // Update buttons after usage
    await updateButtonsBasedOnSubscription(sessionId);
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
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
  const plan = subscription.plan || 'free';
  const features = subscription.features || {};
  const hasSubtitleFeature = !!(features.subtitles || plan !== 'free');

  // Show or hide SRT tab based on subtitle access
  const srtTabBtn = resultSection.querySelector('.tab-btn[data-tab="srt"]');
  const srtTab = document.getElementById('srt-tab');
  if (!hasSubtitleFeature) {
    if (srtTabBtn) srtTabBtn.style.display = 'none';
    if (srtTab) {
      srtTab.style.display = 'none';
      srtTab.classList.remove('active');
    }
  } else {
    if (srtTabBtn) srtTabBtn.style.display = '';
    if (srtTab) srtTab.style.display = '';
  }

  // Display summary - handle both object and string formats
  // Format summary as beautiful paragraphs (at least 2 paragraphs)
  let summaryTextContent = 'خلاصه در دسترس نیست';
  let keyPointsArray = [];
  
  if (summary) {
    if (typeof summary === 'string') {
      summaryTextContent = summary;
    } else if (typeof summary === 'object' && summary.summary) {
      summaryTextContent = summary.summary;
      keyPointsArray = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
    } else if (typeof summary === 'object' && summary.keyPoints) {
      keyPointsArray = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
      summaryTextContent = summary.summary || '';
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
  
  // Add key points if available
  if (keyPointsArray.length > 0) {
    formattedSummary += '<div class="key-points-container"><h4 class="key-points-title">نکات کلیدی:</h4><ul class="key-points-list">';
    keyPointsArray.forEach((kp, i) => {
      formattedSummary += `<li class="key-point-item">${kp}</li>`;
    });
    formattedSummary += '</ul></div>';
  }
  
  const summaryTextEl = document.getElementById('summaryText');
  if (summaryTextEl) {
    summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">خلاصه در دسترس نیست</p>';
  }

  // Store original texts for translation
  window.originalFullText = fullText;
  window.originalSummary = typeof summary === 'string' ? summary : (summary?.summary || summaryTextContent);
  window.originalTextLanguage = (options && options.originalLanguage) || 'en';

  // Display full text
  const fulltextEl = document.getElementById('fulltext');
  if (fulltextEl) {
    fulltextEl.textContent = fullText;
  }

  // Generate and display SRT فقط در صورتی که کاربر به زیرنویس دسترسی داشته باشد
  if (hasSubtitleFeature) {
    if (segments && Array.isArray(segments) && segments.length > 0) {
      const validSegments = segments.filter(s => 
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
          srtPreviewEl.textContent = srtContent;
        }
        window.currentSrtContent = srtContent;
      } else {
        // Create simple SRT with full text
        const wordCount = fullText.split(/\s+/).length;
        const estimatedDuration = Math.max(wordCount / 2.5, 10);
        const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${fullText}\n\n`;
        const srtPreviewEl = document.getElementById('srtPreview');
        if (srtPreviewEl) {
          srtPreviewEl.textContent = simpleSrt;
        }
        window.currentSrtContent = simpleSrt;
      }
    } else {
      // If no segments, create a simple SRT with full text
      const wordCount = fullText.split(/\s+/).length;
      const estimatedDuration = Math.max(wordCount / 2.5, 10);
      const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${fullText}\n\n`;
      const srtPreviewEl = document.getElementById('srtPreview');
      if (srtPreviewEl) {
        srtPreviewEl.textContent = simpleSrt;
      }
      window.currentSrtContent = simpleSrt;
    }

    // Store original SRT for translation
    window.originalSrtContent = window.currentSrtContent;
    window.originalSrtSegments = segments;
    window.originalSrtLanguage = (options && options.originalLanguage) || 'en';
    window.availableLanguages = (options && options.availableLanguages) || [];
  } else {
    // اگر دسترسی زیرنویس ندارد، state مربوط به SRT را پاک کنیم
    window.currentSrtContent = null;
    window.originalSrtContent = null;
    window.originalSrtSegments = null;
  }

  // Show result section
  resultSection.style.display = 'block';
  
  // Switch to مناسب‌ترین تب بر اساس اکشن فعلی
  const activeTab = options.activeTab || (summary ? 'summary' : 'fulltext');
  // اگر تب انتخابی قفل/پنهان است، برگردیم روی متن کامل
  if (activeTab === 'srt' && !hasSubtitleFeature) {
    switchTab('fulltext');
  } else {
    switchTab(activeTab);
  }
  
  // Hide tabs that are not relevant based on what was requested
  const allTabBtns = resultSection.querySelectorAll('.tab-btn');
  const allTabContents = resultSection.querySelectorAll('.tab-content');
  
  if (activeTab === 'summary') {
    // Only show summary tab, hide fulltext and srt
    allTabBtns.forEach(btn => {
      const tabName = btn.dataset.tab;
      if (tabName === 'summary') {
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
    });
    allTabContents.forEach(content => {
      const tabId = content.id;
      if (tabId === 'summary-tab') {
        content.style.display = '';
      } else {
        content.style.display = 'none';
      }
    });
  } else if (activeTab === 'fulltext') {
    // Only show fulltext tab, hide summary and srt
    allTabBtns.forEach(btn => {
      const tabName = btn.dataset.tab;
      if (tabName === 'fulltext') {
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
    });
    allTabContents.forEach(content => {
      const tabId = content.id;
      if (tabId === 'fulltext-tab') {
        content.style.display = '';
      } else {
        content.style.display = 'none';
      }
    });
  } else if (activeTab === 'srt' && hasSubtitleFeature) {
    // Only show srt tab
    allTabBtns.forEach(btn => {
      const tabName = btn.dataset.tab;
      if (tabName === 'srt') {
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
    });
    allTabContents.forEach(content => {
      const tabId = content.id;
      if (tabId === 'srt-tab') {
        content.style.display = '';
      } else {
        content.style.display = 'none';
      }
    });
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

// Switch tab function (فقط برای تب‌های بخش نتیجه)
function switchTab(tabName) {
  const resultSection = document.getElementById('resultSection');
  if (!resultSection) return;

  // Remove active class from result tabs and contents فقط داخل resultSection
  resultSection.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  resultSection.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // Add active class to selected tab and content
  const tabBtn = resultSection.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(`${tabName}-tab`);
  
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.add('active');
}

// Format SRT time
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
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
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Copy button
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab) {
        const text = activeTab.querySelector('p, div')?.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          showMessage('متن کپی شد!', 'success');
        }).catch(() => {
          showMessage('خطا در کپی کردن', 'error');
        });
      }
    });
  }
  
  // Download buttons
  setupDownloadButtons();
  
  // Translate buttons
  setupTranslateButtons();
});

// Setup translate buttons
function setupTranslateButtons() {
  // Translate fulltext button
  const translateFulltextBtn = document.getElementById('translateFulltextBtn');
  if (translateFulltextBtn) {
    translateFulltextBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('لطفاً ابتدا وارد حساب کاربری خود شوید', 'error');
        return;
      }
      
      const originalLanguage = window.originalTextLanguage || 'en';
      await translateFulltextContent(sessionId, originalLanguage);
    });
  }
  
  // Translate summary button
  const translateSummaryBtn = document.getElementById('translateSummaryBtn');
  if (translateSummaryBtn) {
    translateSummaryBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('لطفاً ابتدا وارد حساب کاربری خود شوید', 'error');
        return;
      }
      
      const originalLanguage = window.originalTextLanguage || 'en';
      await translateSummaryContent(sessionId, originalLanguage);
    });
  }
  
  // Translate SRT button
  const translateSrtBtn = document.getElementById('translateSrtBtn');
  if (translateSrtBtn) {
    translateSrtBtn.addEventListener('click', async () => {
      const sessionId = checkLogin();
      if (!sessionId) {
        showMessage('لطفاً ابتدا وارد حساب کاربری خود شوید', 'error');
        return;
      }
      
      const originalLanguage = window.originalSrtLanguage || 'en';
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
    btn.textContent = '⏳ در حال ترجمه...';
  }
  
  try {
    const fulltext = window.originalFullText || '';
    if (!fulltext) {
      throw new Error('متن برای ترجمه موجود نیست');
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
        sourceLanguage: originalLanguage || 'en'
      })
    });
    
    if (!response.ok) {
      throw new Error('خطا در ترجمه');
    }
    
    const data = await response.json();
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    
    const fulltextEl = document.getElementById('fulltext');
    if (fulltextEl) {
      fulltextEl.textContent = translatedText;
    }
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 ترجمه';
    }
  }
}

// Translate summary content
async function translateSummaryContent(sessionId, originalLanguage) {
  const targetLanguage = document.getElementById('summaryLanguage')?.value;
  if (!targetLanguage || targetLanguage === 'original') {
    const summaryTextEl = document.getElementById('summaryText');
    if (summaryTextEl && window.originalSummary) {
      // Restore original summary HTML
      const summary = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary.summary || '');
      // Re-format summary
      const paragraphs = summary.split(/\n\s*\n/).filter(p => p.trim());
      const formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
      summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">خلاصه در دسترس نیست</p>';
    }
    return;
  }
  
  const btn = document.getElementById('translateSummaryBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ در حال ترجمه...';
  }
  
  try {
    const summary = typeof window.originalSummary === 'string' ? window.originalSummary : (window.originalSummary?.summary || '');
    if (!summary) {
      throw new Error('خلاصه برای ترجمه موجود نیست');
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
        sourceLanguage: originalLanguage || 'en'
      })
    });
    
    if (!response.ok) {
      throw new Error('خطا در ترجمه');
    }
    
    const data = await response.json();
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    
    // Format translated summary
    const paragraphs = translatedText.split(/\n\s*\n/).filter(p => p.trim());
    const formattedSummary = paragraphs.map(p => `<p class="summary-paragraph">${p}</p>`).join('');
    
    const summaryTextEl = document.getElementById('summaryText');
    if (summaryTextEl) {
      summaryTextEl.innerHTML = formattedSummary || '<p class="summary-paragraph">خلاصه در دسترس نیست</p>';
    }
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 ترجمه';
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
    btn.textContent = '⏳ در حال ترجمه...';
  }
  
  try {
    const srtContent = window.originalSrtContent || '';
    if (!srtContent) {
      throw new Error('زیرنویس برای ترجمه موجود نیست');
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
        sourceLanguage: originalLanguage || 'en'
      })
    });
    
    if (!response.ok) {
      throw new Error('خطا در ترجمه');
    }
    
    const data = await response.json();
    window.currentSrtContent = data.srtContent;
    
    const srtPreviewEl = document.getElementById('srtPreview');
    if (srtPreviewEl) {
      srtPreviewEl.textContent = data.srtContent;
    }
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔄 ترجمه';
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
        downloadAsTxt(fulltext, 'متن_کامل');
      }
    });
  }
  
  // Download fulltext as DOCX
  const downloadFulltextDocxBtn = document.getElementById('downloadFulltextDocxBtn');
  if (downloadFulltextDocxBtn) {
    downloadFulltextDocxBtn.addEventListener('click', () => {
      const fulltext = document.getElementById('fulltext')?.textContent || '';
      if (fulltext) {
        downloadAsDocx(fulltext, 'متن_کامل');
      }
    });
  }
  
  // Download summary as TXT
  const downloadSummaryTxtBtn = document.getElementById('downloadSummaryTxtBtn');
  if (downloadSummaryTxtBtn) {
    downloadSummaryTxtBtn.addEventListener('click', () => {
      const summary = document.getElementById('summaryText')?.textContent || '';
      if (summary) {
        downloadAsTxt(summary, 'خلاصه');
      }
    });
  }
  
  // Download summary as DOCX
  const downloadSummaryDocxBtn = document.getElementById('downloadSummaryDocxBtn');
  if (downloadSummaryDocxBtn) {
    downloadSummaryDocxBtn.addEventListener('click', () => {
      const summary = document.getElementById('summaryText')?.textContent || '';
      if (summary) {
        downloadAsDocx(summary, 'خلاصه');
      }
    });
  }
  
  // Download SRT
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  if (downloadSrtBtn) {
    downloadSrtBtn.addEventListener('click', () => {
      const srtContent = window.currentSrtContent || '';
      if (srtContent) {
        downloadAsTxt(srtContent, 'زیرنویس', 'srt');
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
    showMessage('در حال ساخت فایل DOCX...', 'info');
    
    const response = await fetch(`${API_BASE_URL}/api/generate-docx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content, filename })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || errorData.error || `خطا در ساخت فایل DOCX (${response.status})`;
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
    
    showMessage('فایل DOCX با موفقیت دانلود شد', 'success');
  } catch (error) {
    console.error('Error downloading DOCX:', error);
    showMessage('خطا در دانلود فایل DOCX: ' + error.message, 'error');
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
          <h3 class="quality-modal-title">خلاصه</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="summary-modal-body">
          <div class="srt-controls">
            <label for="summaryLanguageSelect" class="srt-language-label">زبان ترجمه:</label>
            <select id="summaryLanguageSelect" class="srt-language-select">
              <option value="original">زبان اصلی</option>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
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
            <button class="translate-srt-btn" id="translateSummaryBtnMain">🔄 ترجمه</button>
          </div>
          <div class="summary-content">
            <div class="key-points-section" style="margin-bottom: 20px;">
              <h4 style="margin-bottom: 10px;">نکات کلیدی:</h4>
              <ul id="keyPointsList" style="list-style: none; padding: 0;"></ul>
            </div>
            <div class="summary-text-section">
              <h4 style="margin-bottom: 10px;">خلاصه:</h4>
              <div id="summaryTextMain" style="line-height: 1.8; text-align: right;"></div>
            </div>
          </div>
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
    keyPointsList.innerHTML = '<li>نکات کلیدی در دسترس نیست</li>';
  }
  
  // Display summary
  document.getElementById('summaryTextMain').textContent = typeof summary === 'string' ? summary : (summary.summary || 'خلاصه در دسترس نیست');
  
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
  btn.textContent = '⏳ در حال ترجمه...';
  
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
        sourceLanguage: originalLanguage || 'en'
      })
    });
    
    if (!response.ok) {
      throw new Error('خطا در ترجمه');
    }
    
    const data = await response.json();
    // Extract text from SRT
    const translatedText = data.srtContent.split('\n').slice(2).join('\n').trim();
    document.getElementById('summaryTextMain').textContent = translatedText;
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 ترجمه';
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
          <h3 class="quality-modal-title">متن کامل</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="summary-modal-body">
          <div class="srt-controls">
            <label for="fullTextLanguageSelect" class="srt-language-label">زبان ترجمه:</label>
            <select id="fullTextLanguageSelect" class="srt-language-select">
              <option value="original">زبان اصلی</option>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
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
            <button class="translate-srt-btn" id="translateFullTextBtnMain">🔄 ترجمه</button>
          </div>
          <div class="fulltext-content" id="fullTextMain" style="max-height: 500px; overflow-y: auto; margin-top: 20px; padding: 16px; background: #f5f5f5; border-radius: 8px; line-height: 1.8; text-align: right;"></div>
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
  btn.textContent = '⏳ در حال ترجمه...';
  
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
          sourceLanguage: originalLanguage || 'en'
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
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 ترجمه';
  }
}

// Save to dashboard
async function saveToDashboard(sessionId, data) {
  try {
    console.log('[script] saveToDashboard called with:', data);
    
    // Save to localStorage history for dashboard to pick up
    const resultId = Date.now();
    const resultData = {
      id: resultId,
      ...data,
      date: new Date().toISOString(),
      sessionId: sessionId,
      // Add minutes if it's a usage type
      minutes: data.duration ? Math.ceil(data.duration / 60) : (data.minutes || 0)
    };
    
    console.log('[script] Prepared resultData:', resultData);
    
    // Get existing history
    const raw = localStorage.getItem(DASHBOARD_HISTORY_KEY);
    console.log('[script] Existing history raw (key: ' + DASHBOARD_HISTORY_KEY + '):', raw);
    console.log('[script] Current origin:', window.location.origin);
    
    let history = [];
    if (raw) {
      try {
        history = JSON.parse(raw);
        console.log('[script] Parsed existing history, length:', history.length);
      } catch (e) {
        console.error('[script] Error parsing existing history:', e);
        history = [];
      }
    }
    
    // Add new item to beginning
    history.unshift(resultData);
    console.log('[script] Added new item, history length now:', history.length);
    
    // Limit to 1000 items
    if (history.length > 1000) {
      history.pop();
    }
    
    // Save back to localStorage
    const historyString = JSON.stringify(history);
    localStorage.setItem(DASHBOARD_HISTORY_KEY, historyString);
    console.log('[script] Saved to localStorage, key:', DASHBOARD_HISTORY_KEY);
    console.log('[script] Current origin:', window.location.origin);
    console.log('[script] History length:', history.length);
    console.log('[script] Saved to dashboard:', resultData);
    
    // Verify it was saved
    const verify = localStorage.getItem(DASHBOARD_HISTORY_KEY);
    if (verify) {
      const verifyParsed = JSON.parse(verify);
      console.log('[script] ✅ Verification: localStorage contains', verifyParsed.length, 'items');
      console.log('[script] First item type:', verifyParsed[0]?.type);
      console.log('[script] All localStorage keys:', Object.keys(localStorage));
    } else {
      console.error('[script] ❌ ERROR: Could not verify save!');
      console.error('[script] All localStorage keys:', Object.keys(localStorage));
    }
    
    // Signal activity
    localStorage.setItem('cutup_last_activity', Date.now().toString());
    
    // Dispatch event for dashboard to listen
    const customEvent = new CustomEvent('cutupDownloadRecorded', { detail: resultData });
    window.dispatchEvent(customEvent);
    console.log('[script] Dispatched cutupDownloadRecorded event');
    
  } catch (error) {
    console.error('[script] Error saving to dashboard:', error);
    console.error('[script] Error stack:', error.stack);
  }
}

// Record usage
async function recordUsage(sessionId, type, duration, metadata = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ 
        minutes: duration,
        type: type,
        metadata: metadata
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[script] Usage recorded successfully:', data);
      
      // Signal dashboard to refresh by updating localStorage
      localStorage.setItem('cutup_last_activity', Date.now().toString());
      
      // Dispatch event for dashboard refresh (if dashboard is open in another tab)
      window.dispatchEvent(new CustomEvent('cutupUsageRecorded', {
        detail: {
          type: type,
          duration: duration,
          metadata: metadata
        }
      }));
    } else {
      const errorText = await response.text().catch(() => '');
      console.error('[script] Failed to record usage:', response.status, errorText);
    }
  } catch (error) {
    console.error('[script] Error recording usage:', error);
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
          <h3 class="quality-modal-title">انتخاب کیفیت</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="quality-list" id="qualityList"></div>
      </div>
    `;
    document.body.appendChild(modal);
    
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
    qualityList.innerHTML = '<p style="text-align: center; padding: 20px;">کیفیت در دسترس نیست</p>';
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
    const lockIcon = isLocked ? '<span class="lock-icon" title="برای دسترسی به این کیفیت، پلن خود را ارتقا دهید">🔒</span>' : '';
    
    item.innerHTML = `
      <span class="quality-text">${type === 'video' ? quality : quality === 'best' ? 'بهترین کیفیت' : quality + ' kbps'}</span>
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
          window.open(`dashboard.html?session=${sessionId}#subscription`, '_blank');
        });
        lockIconEl.style.cursor = 'pointer';
      }
      item.addEventListener('click', () => {
        showMessage('این کیفیت فقط برای کاربران با پلن بالاتر در دسترس است. لطفاً پلن خود را ارتقا دهید.', 'info');
        window.open(`dashboard.html?session=${sessionId}#subscription`, '_blank');
      });
      item.style.cursor = 'not-allowed';
      item.style.opacity = '0.6';
    }
    
    qualityList.appendChild(item);
  });
  
  modal.classList.add('active');
}

// Show progress bar
function showProgressBar(title = 'در حال پردازش...', showFileSize = true) {
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
      fileSize.textContent = 'حجم فایل: در حال محاسبه...';
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
    progressTitle.textContent = statusText;
  }
  
  // Only show file size if total > 0 (download operation)
  if (total > 0) {
    if (fileSize) {
      const totalMB = (total / 1024 / 1024).toFixed(2);
      fileSize.textContent = `حجم فایل: ${totalMB} MB`;
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

// Animate progress bar incrementally from current to target
let progressInterval = null;
function animateProgressTo(targetPercent, statusText = '', duration = 2000) {
  // Clear any existing interval
  if (progressInterval) {
    clearInterval(progressInterval);
  }
  
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const progressTitle = document.getElementById('progressTitle');
  
  if (!progressPercent || !progressFill) return;
  
  // Get current progress
  const currentPercent = parseFloat(progressFill.style.width) || 0;
  const target = Math.min(100, Math.max(0, targetPercent));
  
  if (currentPercent >= target) {
    // Already at or past target, just update
    updateProgressBar(0, 0, target, statusText);
    return;
  }
  
  // Update status text immediately
  if (statusText && progressTitle) {
    progressTitle.textContent = statusText;
  }
  
  // Calculate steps
  const steps = Math.max(10, Math.ceil((target - currentPercent) / 2)); // At least 10 steps
  const stepSize = (target - currentPercent) / steps;
  const stepDuration = duration / steps;
  
  let current = currentPercent;
  let step = 0;
  
  progressInterval = setInterval(() => {
    step++;
    current = Math.min(target, currentPercent + (stepSize * step));
    
    if (progressFill) {
      progressFill.style.width = `${current}%`;
    }
    if (progressPercent) {
      progressPercent.textContent = `${Math.round(current)}%`;
    }
    
    if (current >= target || step >= steps) {
      clearInterval(progressInterval);
      progressInterval = null;
      // Ensure we end at exact target
      updateProgressBar(0, 0, target, statusText);
    }
  }, stepDuration);
}

// Simulate progress during async operation
function simulateProgressDuringOperation(startPercent, endPercent, statusText, operationPromise) {
  // Start animation
  animateProgressTo(endPercent - 5, statusText, 3000); // Animate to 5% before end
  
  // Return a promise that resolves when operation completes
  return operationPromise.then(result => {
    // Complete the progress
    clearInterval(progressInterval);
    progressInterval = null;
    updateProgressBar(0, 0, endPercent, statusText);
    return result;
  }).catch(error => {
    // Stop animation on error
    clearInterval(progressInterval);
    progressInterval = null;
    throw error;
  });
}

// Hide progress bar
function hideProgressBar() {
  // Clear any active progress animation
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  
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
    showProgressBar('در حال دانلود...');
    
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
        headers: { 'Content-Type': 'application/json' },
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
        throw new Error(errorData.error || errorData.message || 'خطا در دانلود');
      } catch (parseError) {
        // If not JSON, use text as error message
        throw new Error(errorText || 'خطا در دانلود');
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
        const downloadType = type === 'audio' ? 'موزیک' : 'ویدئو';
        const audioCount = usageData.usage?.downloads?.audio?.count || 0;
        const audioLimit = usageData.usage?.downloads?.audio?.limit || null;
        const videoCount = usageData.usage?.downloads?.video?.count || 0;
        const videoLimit = usageData.usage?.downloads?.video?.limit || null;
        
        // Show toast with usage info
        if (type === 'audio' && audioLimit !== null) {
          showMessage(`دانلود ${downloadType} ثبت شد: ${audioCount} از ${audioLimit}`, 'success');
        } else if (type === 'video' && videoLimit !== null) {
          showMessage(`دانلود ${downloadType} ثبت شد: ${videoCount} از ${videoLimit}`, 'success');
        } else {
          showMessage(`دانلود ${downloadType} ثبت شد!`, 'success');
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
    showMessage('خطا در دانلود: ' + error.message, 'error');
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
          showMessage('لطفاً یکی از گزینه‌های بالا را انتخاب کنید', 'info');
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
    showMessage(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxSize / 1024 / 1024}MB است.`, 'error');
    audioFileInput.value = ''; // Clear selection
    checkInput();
    return;
  }
  
  // Check if it's audio or video file
  const isAudio = file.type.startsWith('audio/');
  const isVideo = file.type.startsWith('video/');
  
  if (!isAudio && !isVideo) {
    showMessage('لطفاً فایل صوتی یا ویدئویی انتخاب کنید', 'error');
    audioFileInput.value = ''; // Clear selection
    checkInput();
    return;
  }
  
  // Store file for later use
  window.selectedFile = file;
  
  // Show success message
  showMessage(`فایل "${file.name}" انتخاب شد (${(file.size / 1024 / 1024).toFixed(2)}MB)`, 'success');
  
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
      const wrongPlatform = isTikTok ? 'تیک‌تاک' : 'اینستاگرام';
      showMessage(`این لینک مربوط به ${wrongPlatform} است. لطفاً لینک یوتیوب وارد کنید. مثال: ${getExampleUrl('youtube')}`, 'error');
      return;
    } else if (currentPlatform === 'instagram' && !isInstagram && (isYouTube || isTikTok)) {
      const wrongPlatform = isYouTube ? 'یوتیوب' : 'تیک‌تاک';
      showMessage(`این لینک مربوط به ${wrongPlatform} است. لطفاً لینک اینستاگرام وارد کنید. مثال: ${getExampleUrl('instagram')}`, 'error');
      return;
    } else if (currentPlatform === 'tiktok' && !isTikTok && (isYouTube || isInstagram)) {
      const wrongPlatform = isYouTube ? 'یوتیوب' : 'اینستاگرام';
      showMessage(`این لینک مربوط به ${wrongPlatform} است. لطفاً لینک تیک‌تاک وارد کنید. مثال: ${getExampleUrl('tiktok')}`, 'error');
      return;
    } else if (!isYouTube && !isTikTok && !isInstagram) {
      // URL is not from any known platform
      const platformName = getPlatformName(currentPlatform);
      showMessage(`لینک وارد شده معتبر نیست. لطفاً لینک ${platformName} وارد کنید. مثال: ${getExampleUrl(currentPlatform)}`, 'error');
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
          <h3 class="quality-modal-title">زیرنویس</h3>
          <button class="quality-modal-close">×</button>
        </div>
        <div class="subtitle-modal-body">
          <div class="srt-controls">
            <label for="srtLanguageSelect" class="srt-language-label">زبان زیرنویس:</label>
            <select id="srtLanguageSelect" class="srt-language-select">
              <option value="original">زبان اصلی</option>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
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
            <button class="translate-srt-btn" id="translateSrtBtnMain">🔄 ترجمه</button>
          </div>
          <button class="download-srt-btn" id="downloadSrtBtnMain">📥 دانلود فایل SRT</button>
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
  btn.textContent = '⏳ در حال ترجمه...';
  
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
        sourceLanguage: window.originalSrtLanguage || 'en'
      })
    });
    
    if (!response.ok) {
      throw new Error('خطا در ترجمه');
    }
    
    const data = await response.json();
    window.currentSrtContent = data.srtContent;
    document.getElementById('srtPreviewMain').textContent = data.srtContent;
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در ترجمه: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 ترجمه';
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
  showMessage('زیرنویس با موفقیت دانلود شد!', 'success');
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

