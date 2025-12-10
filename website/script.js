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
  
  const avatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  
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
  
  // Make avatar and name clickable to go to dashboard
  const sessionId = localStorage.getItem('cutup_session');
  if (sessionId) {
    avatar.style.cursor = 'pointer';
    userName.style.cursor = 'pointer';
    avatar.onclick = () => {
      window.location.href = `dashboard.html?session=${sessionId}`;
    };
    userName.onclick = () => {
      window.location.href = `dashboard.html?session=${sessionId}`;
    };
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
const audioFileInput = document.getElementById('audioFileInput');
// Removed downloadBtnMain - using pasteBtnMain instead
const downloadOptions = document.getElementById('downloadOptions');
const downloadVideoBtnMain = document.getElementById('downloadVideoBtnMain');
const downloadAudioBtnMain = document.getElementById('downloadAudioBtnMain');
const downloadSubtitleBtnMain = document.getElementById('downloadSubtitleBtnMain');
const summarizeBtnMain = document.getElementById('summarizeBtnMain');
const fullTextBtnMain = document.getElementById('fullTextBtnMain');
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

// Handle paste button
const pasteBtnMain = document.getElementById('pasteBtnMain');
pasteBtnMain.addEventListener('click', async () => {
  try {
    // Read from clipboard
    const text = await navigator.clipboard.readText();
    if (text) {
      // Clear file selection if pasting URL
      if (audioFileInput) {
        audioFileInput.value = '';
      }
      youtubeUrlInput.value = text;
      checkInput();
      if (isYouTubeUrl(text)) {
        showMessage('لطفاً یکی از گزینه‌های زیر را انتخاب کنید', 'info');
      }
    } else {
      showMessage('کلیپ‌بورد خالی است', 'error');
    }
  } catch (error) {
    console.error('Error reading clipboard:', error);
    showMessage('خطا در خواندن کلیپ‌بورد. لطفاً لینک را دستی وارد کنید.', 'error');
  }
});

// Also check input when URL is entered manually
youtubeUrlInput.addEventListener('input', () => {
  // Clear file selection if typing URL
  if (audioFileInput) {
    audioFileInput.value = '';
  }
  checkInput();
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
    
    // Use available formats from API or default
    const availableFormats = formatsData.available?.video || ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
    
    // Show quality modal
    showQualityModal(availableFormats, url, sessionId, isPro, 'video');
    
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
    
    // Use available formats from API or default
    const availableFormats = formatsData.available?.audio || ['best', '320k', '256k', '192k', '128k', '96k', '64k'];
    
    // Show quality modal for audio
    showQualityModal(availableFormats, url, sessionId, true, 'audio');
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در دریافت کیفیت‌ها: ' + error.message, 'error');
  }
});

// Handle subtitle download
downloadSubtitleBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  if (!isYouTubeUrl(url)) {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
    return;
  }
  
  try {
    // Check if user has SRT feature
    const subResponse = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${sessionId}`);
    const subData = await subResponse.ok ? await subResponse.json() : { plan: 'free' };
    const userPlan = subData.plan || 'free';
    
    if (userPlan === 'free') {
      showMessage('دانلود زیرنویس فقط برای کاربران Paid در دسترس است. لطفاً پلن خود را ارتقا دهید.', 'error');
      window.open(`dashboard.html?session=${sessionId}`, '_blank');
      return;
    }
    
    showMessage('در حال دریافت ویدئو و استخراج زیرنویس...', 'info');
    
    // Extract video and get subtitles
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
      return;
    }
    
    // Generate SRT from subtitles
    const srtContent = generateSRTFromSubtitles(youtubeData.subtitles, youtubeData.subtitleLanguage);
    
    // Show subtitle modal like extension
    showSubtitleModal(srtContent, youtubeData.subtitleLanguage || 'en', videoId, sessionId);
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا در دریافت زیرنویس: ' + error.message, 'error');
  }
});

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

// Handle summarize
summarizeBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  const file = audioFileInput && audioFileInput.files[0];
  
  if (!url && !file) {
    showMessage('لطفاً لینک یوتیوب یا فایل صوتی را وارد کنید', 'error');
    return;
  }
  
  // Process summarize and save to dashboard
  if (file && url.startsWith('📁')) {
    // File selected
    await processSummarizeFile(file, sessionId);
  } else if (isYouTubeUrl(url)) {
    // YouTube URL
    await processSummarize(url, sessionId);
  } else {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
  }
});

// Handle full text
fullTextBtnMain.addEventListener('click', async () => {
  const sessionId = checkLogin();
  if (!sessionId) return;
  
  const url = youtubeUrlInput.value.trim();
  const file = audioFileInput && audioFileInput.files[0];
  
  if (!url && !file) {
    showMessage('لطفاً لینک یوتیوب یا فایل صوتی را وارد کنید', 'error');
    return;
  }
  
  // Process transcription and save to dashboard
  if (file && url.startsWith('📁')) {
    // File selected
    await processFullTextFile(file, sessionId);
  } else if (isYouTubeUrl(url)) {
    // YouTube URL
    await processFullText(url, sessionId);
  } else {
    showMessage('لینک یوتیوب معتبر نیست', 'error');
  }
});

// Process summarize for file
async function processSummarizeFile(file, sessionId) {
  try {
    showMessage('در حال پردازش فایل...', 'info');
    
    // Convert file to data URL (like extension)
    const fileDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    // Transcribe
    showMessage('در حال تبدیل به متن...', 'info');
    const transcribeResponse = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ audioUrl: fileDataUrl })
    });
    
    if (!transcribeResponse.ok) {
      let errorMessage = 'خطا در تبدیل به متن';
      try {
        const errorData = await transcribeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await transcribeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const transcribeData = await transcribeResponse.json();
    
    // Check for error in response
    if (transcribeData.error) {
      throw new Error(transcribeData.message || transcribeData.details || transcribeData.error || 'خطا در تبدیل به متن');
    }
    
    const transcription = transcribeData.text || transcribeData.transcription;
    
    if (!transcription) {
      throw new Error('متن دریافت نشد. پاسخ API: ' + JSON.stringify(transcribeData).substring(0, 200));
    }
    
    // Summarize (unlimited for all tiers)
    showMessage('در حال خلاصه‌سازی...', 'info');
    const summarizeResponse = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ text: transcription, language: transcribeData.language || 'en' })
    });
    
    if (!summarizeResponse.ok) {
      let errorMessage = 'خطا در خلاصه‌سازی';
      try {
        const errorData = await summarizeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await summarizeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const summarizeData = await summarizeResponse.json();
    
    // Check for error in response
    if (summarizeData.error) {
      throw new Error(summarizeData.message || summarizeData.details || summarizeData.error || 'خطا در خلاصه‌سازی');
    }
    
    const summary = summarizeData.summary || summarizeData;
    const keyPoints = summarizeData.keyPoints || [];
    
    // Show summary modal
    showSummaryModal(summary, keyPoints, transcription, file.name, sessionId, transcribeData.language || 'en');
    
    // Record usage (estimate from file size: ~1MB per minute)
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    await recordUsage(sessionId, 'transcription', estimatedDurationMinutes);
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: file.name,
      type: 'summarize',
      transcription,
      summary,
      keyPoints,
      duration: estimatedDurationMinutes * 60
    });
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
  }
}

// Process full text for file
async function processFullTextFile(file, sessionId) {
  try {
    showMessage('در حال پردازش فایل...', 'info');
    
    // Convert file to data URL (like extension)
    const fileDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    
    // Transcribe
    showMessage('در حال تبدیل به متن...', 'info');
    const transcribeResponse = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ audioUrl: fileDataUrl })
    });
    
    if (!transcribeResponse.ok) {
      let errorMessage = 'خطا در تبدیل به متن';
      try {
        const errorData = await transcribeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await transcribeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const transcribeData = await transcribeResponse.json();
    
    // Check for error in response
    if (transcribeData.error) {
      throw new Error(transcribeData.message || transcribeData.details || transcribeData.error || 'خطا در تبدیل به متن');
    }
    
    const transcription = transcribeData.text || transcribeData.transcription;
    
    if (!transcription) {
      throw new Error('متن دریافت نشد. پاسخ API: ' + JSON.stringify(transcribeData).substring(0, 200));
    }
    
    // Show full text modal
    showFullTextModal(transcription, file.name, sessionId, transcribeData.language || 'en');
    
    // Record usage (estimate from file size: ~1MB per minute)
    const estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2);
    await recordUsage(sessionId, 'transcription', estimatedDurationMinutes);
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: file.name,
      type: 'transcription',
      transcription,
      segments: transcribeData.segments || [],
      duration: estimatedDurationMinutes * 60
    });
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
  }
}

// Process summarize
async function processSummarize(url, sessionId) {
  try {
    showMessage('در حال پردازش...', 'info');
    
    // Extract video
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
      const errorData = await youtubeResponse.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'خطا در دریافت ویدئو');
    }
    
    const youtubeData = await youtubeResponse.json();
    const audioUrl = youtubeData.audioUrl;
    
    if (!audioUrl) {
      throw new Error('خطا در استخراج صوت از ویدئو');
    }
    
    // Transcribe
    showMessage('در حال تبدیل به متن...', 'info');
    const transcribeResponse = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ audioUrl, language: youtubeData.language })
    });
    
    if (!transcribeResponse.ok) {
      let errorMessage = 'خطا در تبدیل به متن';
      try {
        const errorData = await transcribeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await transcribeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const transcribeData = await transcribeResponse.json();
    
    // Check for error in response
    if (transcribeData.error) {
      throw new Error(transcribeData.message || transcribeData.details || transcribeData.error || 'خطا در تبدیل به متن');
    }
    
    const transcription = transcribeData.text || transcribeData.transcription;
    
    if (!transcription) {
      throw new Error('متن دریافت نشد. پاسخ API: ' + JSON.stringify(transcribeData).substring(0, 200));
    }
    
    // Summarize (unlimited for all tiers)
    showMessage('در حال خلاصه‌سازی...', 'info');
    const summarizeResponse = await fetch(`${API_BASE_URL}/api/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ text: transcription, language: transcribeData.language || 'en' })
    });
    
    if (!summarizeResponse.ok) {
      let errorMessage = 'خطا در خلاصه‌سازی';
      try {
        const errorData = await summarizeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await summarizeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const summarizeData = await summarizeResponse.json();
    
    // Check for error in response
    if (summarizeData.error) {
      throw new Error(summarizeData.message || summarizeData.details || summarizeData.error || 'خطا در خلاصه‌سازی');
    }
    
    const summary = summarizeData.summary || summarizeData;
    const keyPoints = summarizeData.keyPoints || [];
    
    // Show summary modal
    showSummaryModal(summary, keyPoints, transcription, youtubeData.title || 'ویدئو یوتیوب', sessionId, transcribeData.language || 'en');
    
    // Record usage
    const duration = youtubeData.duration ? Math.ceil(youtubeData.duration / 60) : 0;
    await recordUsage(sessionId, 'transcription', duration);
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: youtubeData.title || 'ویدئو یوتیوب',
      type: 'summarize',
      transcription,
      summary,
      keyPoints,
      duration: youtubeData.duration || 0
    });
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
  }
}

// Process full text
async function processFullText(url, sessionId) {
  try {
    showMessage('در حال پردازش...', 'info');
    
    // Extract video
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
      const errorData = await youtubeResponse.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || 'خطا در دریافت ویدئو');
    }
    
    const youtubeData = await youtubeResponse.json();
    const audioUrl = youtubeData.audioUrl;
    
    if (!audioUrl) {
      throw new Error('خطا در استخراج صوت از ویدئو');
    }
    
    // Transcribe
    showMessage('در حال تبدیل به متن...', 'info');
    const transcribeResponse = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ audioUrl, language: youtubeData.language })
    });
    
    if (!transcribeResponse.ok) {
      let errorMessage = 'خطا در تبدیل به متن';
      try {
        const errorData = await transcribeResponse.json();
        errorMessage = errorData.message || errorData.details || errorData.error || errorMessage;
      } catch (e) {
        const errorText = await transcribeResponse.text().catch(() => '');
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    
    const transcribeData = await transcribeResponse.json();
    
    // Check for error in response
    if (transcribeData.error) {
      throw new Error(transcribeData.message || transcribeData.details || transcribeData.error || 'خطا در تبدیل به متن');
    }
    
    const transcription = transcribeData.text || transcribeData.transcription;
    
    if (!transcription) {
      throw new Error('متن دریافت نشد. پاسخ API: ' + JSON.stringify(transcribeData).substring(0, 200));
    }
    
    // Show full text modal
    showFullTextModal(transcription, youtubeData.title || 'ویدئو یوتیوب', sessionId, transcribeData.language || 'en');
    
    // Record usage
    const duration = youtubeData.duration ? Math.ceil(youtubeData.duration / 60) : 0;
    await recordUsage(sessionId, 'transcription', duration);
    
    // Save to dashboard
    await saveToDashboard(sessionId, {
      title: youtubeData.title || 'ویدئو یوتیوب',
      type: 'transcription',
      transcription,
      segments: transcribeData.segments || [],
      duration: youtubeData.duration || 0
    });
    
  } catch (error) {
    console.error('Error:', error);
    showMessage('خطا: ' + error.message, 'error');
  }
}

// Show summary modal
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
    // Save to localStorage for dashboard to pick up
    const resultId = Date.now();
    const resultData = {
      id: resultId,
      ...data,
      date: new Date().toISOString(),
      sessionId: sessionId
    };
    localStorage.setItem(`cutup_result_${resultId}`, JSON.stringify(resultData));
    
    // Also save to a list
    const resultsList = JSON.parse(localStorage.getItem('cutup_results_list') || '[]');
    resultsList.push(resultId);
    localStorage.setItem('cutup_results_list', JSON.stringify(resultsList));
    
    console.log('Saved to dashboard:', resultData);
  } catch (error) {
    console.error('Error saving to dashboard:', error);
  }
}

// Record usage
async function recordUsage(sessionId, type, duration) {
  try {
    await fetch(`${API_BASE_URL}/api/subscription?action=check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ type, duration })
    });
  } catch (error) {
    console.error('Error recording usage:', error);
  }
}

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
  
  // Formats is now an array of quality strings
  if (!Array.isArray(formats) || formats.length === 0) {
    qualityList.innerHTML = '<p style="text-align: center; padding: 20px;">کیفیت در دسترس نیست</p>';
    modal.classList.add('active');
    return;
  }
  
  formats.forEach(quality => {
    // Check if quality is locked for free users
    const isLocked = !isPro && (quality === '720p' || quality === '1080p' || quality === '1440p' || quality === '2160p' || quality === '4K');
    
    const item = document.createElement('div');
    item.className = `quality-item ${isLocked ? 'locked' : ''}`;
    item.innerHTML = `
      ${isLocked ? '<span class="pro-badge">Pro</span>' : ''}
      ${type === 'video' ? quality : quality === 'best' ? 'بهترین کیفیت' : quality + ' kbps'}
    `;
    
    if (!isLocked) {
      item.addEventListener('click', async () => {
        modal.classList.remove('active');
        await downloadFile(url, { quality: quality }, sessionId, type);
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
    
    const videoId = extractVideoId(url);
    const quality = format.quality || format.format_id || format.itag;
    
    const response = await fetch(`${API_BASE_URL}/api/youtube-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({
        url,
        videoId: videoId,
        quality: quality,
        type: type
      })
    });
    
    if (!response.ok) {
      // Try to get error message
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || 'خطا در دانلود');
      } else {
        const errorText = await response.text();
        throw new Error(errorText || 'خطا در دانلود');
      }
    }
    
    // API returns file directly, not JSON
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    
    // Create download link
    const link = document.createElement('a');
    link.href = downloadUrl;
    const extension = type === 'video' ? 'mp4' : 'mp3';
    link.download = `youtube_${videoId}_${quality}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
    
    showMessage('دانلود با موفقیت شروع شد!', 'success');
    
    // Record usage and save to dashboard
    await recordUsage(sessionId, type === 'video' ? 'downloadVideo' : 'downloadAudio', 0);
    await saveToDashboard(sessionId, {
      title: `ویدئو یوتیوب - ${quality}`,
      type: type === 'video' ? 'downloadVideo' : 'downloadAudio',
      quality: quality,
      url: url,
      videoId: videoId
    });
    
  } catch (error) {
    console.error('Download error:', error);
    showMessage('خطا در دانلود: ' + error.message, 'error');
  }
}

// Allow Enter key to check URL
youtubeUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const url = youtubeUrlInput.value.trim();
    if (url && isYouTubeUrl(url)) {
      downloadOptions.style.display = 'block';
      showMessage('لطفاً یکی از گزینه‌های زیر را انتخاب کنید', 'info');
    } else {
      showMessage('لینک یوتیوب معتبر نیست', 'error');
    }
  }
});

// Handle audio file input (like extension)
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) {
    // If no file selected, clear input and reset
    youtubeUrlInput.value = '';
    checkInput();
    return;
  }
  
  // Check file size (max 100MB)
  const maxSize = 100 * 1024 * 1024; // 100MB
  if (file.size > maxSize) {
    showMessage(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxSize / 1024 / 1024}MB است.`, 'error');
    audioFileInput.value = ''; // Clear selection
    youtubeUrlInput.value = '';
    checkInput();
    return;
  }
  
  // Check if it's audio or video file
  const isAudio = file.type.startsWith('audio/');
  const isVideo = file.type.startsWith('video/');
  
  if (!isAudio && !isVideo) {
    showMessage('لطفاً فایل صوتی یا ویدئویی انتخاب کنید', 'error');
    audioFileInput.value = ''; // Clear selection
    youtubeUrlInput.value = '';
    checkInput();
    return;
  }
  
  // Show file name in input (like extension)
  youtubeUrlInput.value = `📁 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
  
  // Store file for later use
  window.selectedFile = file;
  
  // Check input to show/hide buttons
  checkInput();
}

// Check input and show/hide appropriate buttons
function checkInput() {
  const url = youtubeUrlInput.value.trim();
  const hasFile = audioFileInput && audioFileInput.files.length > 0;
  const isYouTube = url && isYouTubeUrl(url);
  const isFile = hasFile && url.startsWith('📁');
  
  // Show download options if we have URL or file
  if (url || hasFile) {
    downloadOptions.style.display = 'block';
  } else {
    downloadOptions.style.display = 'none';
    return;
  }
  
  // For YouTube URLs: show all buttons
  if (isYouTube) {
    downloadVideoBtnMain.style.display = 'flex';
    downloadAudioBtnMain.style.display = 'flex';
    downloadSubtitleBtnMain.style.display = 'flex';
    summarizeBtnMain.disabled = false;
    fullTextBtnMain.disabled = false;
  } 
  // For files: hide YouTube-specific buttons, show only summarize and full text
  else if (isFile) {
    downloadVideoBtnMain.style.display = 'none';
    downloadAudioBtnMain.style.display = 'none';
    downloadSubtitleBtnMain.style.display = 'none';
    summarizeBtnMain.disabled = false;
    fullTextBtnMain.disabled = false;
  }
  // For other URLs: show only summarize and full text
  else {
    downloadVideoBtnMain.style.display = 'none';
    downloadAudioBtnMain.style.display = 'none';
    downloadSubtitleBtnMain.style.display = 'none';
    summarizeBtnMain.disabled = false;
    fullTextBtnMain.disabled = false;
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

