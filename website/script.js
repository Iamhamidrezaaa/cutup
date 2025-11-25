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
  // Remove query params from URL
  window.history.replaceState({}, document.title, window.location.pathname);
  // Load user profile
  loadUserProfile();
} else if (authError) {
  console.error('Auth error:', authError);
  alert('خطا در ورود. لطفاً دوباره تلاش کنید.');
}

// Load user profile on page load
window.addEventListener('DOMContentLoaded', () => {
  const savedSession = localStorage.getItem('cutup_session');
  if (savedSession) {
    currentSession = savedSession;
    loadUserProfile();
  } else {
    showLoginButton();
  }
});

async function loadUserProfile() {
  const sessionId = localStorage.getItem('cutup_session');
  if (!sessionId) {
    showLoginButton();
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth?action=me&session=${sessionId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.user) {
        showUserProfile(data.user);
        currentSession = sessionId;
      } else {
        showLoginButton();
      }
    } else {
      // Session expired or invalid
      localStorage.removeItem('cutup_session');
      showLoginButton();
    }
  } catch (error) {
    console.error('Error loading user profile:', error);
    showLoginButton();
  }
}

function showLoginButton() {
  document.getElementById('loginBtn').style.display = 'block';
  document.getElementById('userProfile').style.display = 'none';
}

function showUserProfile(user) {
  document.getElementById('loginBtn').style.display = 'none';
  document.getElementById('userProfile').style.display = 'flex';
  document.getElementById('userAvatar').src = user.picture || '';
  document.getElementById('userName').textContent = user.name || user.email;
}

// Login button click
document.getElementById('loginBtn').addEventListener('click', async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth?action=login`);
    const data = await response.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      alert('خطا در دریافت لینک ورود. لطفاً دوباره تلاش کنید.');
    }
  } catch (error) {
    console.error('Error initiating login:', error);
    alert('خطا در ورود. لطفاً دوباره تلاش کنید.');
  }
});

// Logout button click
document.getElementById('logoutBtn').addEventListener('click', async () => {
  const sessionId = localStorage.getItem('cutup_session');
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
  showLoginButton();
});

// Download functionality
const youtubeUrlInput = document.getElementById('youtubeUrlInput');
const downloadBtnMain = document.getElementById('downloadBtnMain');
const downloadOptions = document.getElementById('downloadOptions');
const downloadVideoBtnMain = document.getElementById('downloadVideoBtnMain');
const downloadAudioBtnMain = document.getElementById('downloadAudioBtnMain');
const summarizeBtnMain = document.getElementById('summarizeBtnMain');
const downloadMessage = document.getElementById('downloadMessage');

// Check if YouTube URL is valid
function isYouTubeUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/,
    /^https?:\/\/youtube\.com\/watch\?v=.+/,
    /^https?:\/\/youtu\.be\/.+/
  ];
  return patterns.some(pattern => pattern.test(url));
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

// Handle main download button
downloadBtnMain.addEventListener('click', async () => {
  const url = youtubeUrlInput.value.trim();
  
  if (!url) {
    showMessage('لطفاً لینک یوتیوب را وارد کنید', 'error');
    return;
  }
  
  if (!isYouTubeUrl(url)) {
    showMessage('لینک یوتیوب معتبر نیست. لطفاً لینک صحیح را وارد کنید.', 'error');
    return;
  }
  
  // Show options
  downloadOptions.style.display = 'block';
  showMessage('لطفاً یکی از گزینه‌های زیر را انتخاب کنید', 'info');
});

// Handle video download
downloadVideoBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  if (!isYouTubeUrl(url)) {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
    return;
  }
  
  try {
    // Get available formats
    showMessage('در حال دریافت کیفیت‌های موجود...', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('خطا در دریافت کیفیت‌ها');
    }
    
    const formatsData = await formatsResponse.json();
    
    // Get user subscription info
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    const subData = await subResponse.ok ? await subResponse.json() : { plan: 'free' };
    const userPlan = subData.plan || 'free';
    const isPro = userPlan !== 'free';
    
    // Show quality modal
    showQualityModal(formatsData.videoFormats || [], url, sessionId, isPro, 'video');
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در دریافت کیفیت‌ها: ' + error.message, 'error');
  }
});

// Handle audio download
downloadAudioBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  if (!isYouTubeUrl(url)) {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
    return;
  }
  
  try {
    showMessage('در حال دریافت کیفیت‌های موجود...', 'info');
    const formatsResponse = await fetch(`${API_BASE_URL}/api/youtube-formats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ url })
    });
    
    if (!formatsResponse.ok) {
      throw new Error('خطا در دریافت کیفیت‌ها');
    }
    
    const formatsData = await formatsResponse.json();
    
    // Show quality modal for audio
    showQualityModal(formatsData.audioFormats || [], url, sessionId, true, 'audio');
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در دریافت کیفیت‌ها: ' + error.message, 'error');
  }
});

// Handle summarize
summarizeBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  if (!isYouTubeUrl(url)) {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
    return;
  }
  
  // Redirect to dashboard or show message
  showMessage('در حال انتقال به صفحه خلاصه‌سازی...', 'info');
  window.location.href = `dashboard.html?action=summarize&url=${encodeURIComponent(url)}&session=${sessionId}`;
});

// Show quality modal
function showQualityModal(formats, url, sessionId, isPro, type) {
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
  
  // Sort formats by quality (highest first)
  const sortedFormats = formats.sort((a, b) => {
    const qualityA = parseInt(a.quality || a.height || '0');
    const qualityB = parseInt(b.quality || b.height || '0');
    return qualityB - qualityA;
  });
  
  sortedFormats.forEach(format => {
    const quality = format.quality || format.height || format.abr || 'unknown';
    const isLocked = !isPro && (quality === '720p' || quality === '1080p' || quality === '1440p' || quality === '2160p' || quality === '4K');
    
    const item = document.createElement('div');
    item.className = `quality-item ${isLocked ? 'locked' : ''}`;
    item.innerHTML = `
      ${isLocked ? '<span class="pro-badge">Pro</span>' : ''}
      ${type === 'video' ? quality : quality + ' kbps'}
      ${format.filesize ? `(${(format.filesize / 1024 / 1024).toFixed(2)} MB)` : ''}
    `;
    
    if (!isLocked) {
      item.addEventListener('click', async () => {
        modal.classList.remove('active');
        await downloadFile(url, format, sessionId, type);
      });
    } else {
      item.addEventListener('click', () => {
        showMessage('این کیفیت فقط برای کاربران Pro در دسترس است. لطفاً پلن خود را ارتقا دهید.', 'error');
        window.open(`dashboard.html?session=${sessionId}`, '_blank');
      });
    }
    
    qualityList.appendChild(item);
  });
  
  modal.classList.add('active');
}

// Download file
async function downloadFile(url, format, sessionId, type) {
  try {
    showMessage('در حال آماده‌سازی دانلود...', 'info');
    
    const response = await fetch(`${API_BASE_URL}/api/youtube-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        url,
        formatId: format.format_id || format.itag,
        type: type
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'خطا در دانلود');
    }
    
    // Get download URL from response
    const data = await response.json();
    const downloadUrl = data.downloadUrl || data.url;
    
    if (downloadUrl) {
      // Create download link
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = data.filename || 'download';
      link.click();
      showMessage('دانلود با موفقیت شروع شد!', 'success');
    } else {
      throw new Error('لینک دانلود دریافت نشد');
    }
    
  } catch (error) {
    console.error('Download error:', error);
    showMessage('خطا در دانلود: ' + error.message, 'error');
  }
}

// Allow Enter key to trigger download
youtubeUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    downloadBtnMain.click();
  }
});

