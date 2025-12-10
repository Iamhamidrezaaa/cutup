// API Configuration
// برای استفاده از سرور پارس پک:
const API_BASE_URL = 'http://195.248.240.108:3001';
// یا اگر domain دارید:
// const API_BASE_URL = 'https://yourdomain.com';

// DOM Elements
const youtubeUrlInput = document.getElementById('youtubeUrl');
const audioFileInput = document.getElementById('audioFile');
const pasteBtn = document.getElementById('pasteBtn');
const summarizeBtn = document.getElementById('summarizeBtn');
const resultSection = document.getElementById('resultSection');
const themeToggle = document.getElementById('themeToggle');
const copyBtn = document.getElementById('copyBtn');
const summaryText = document.getElementById('summaryText');
const fulltext = document.getElementById('fulltext');
const historyList = document.getElementById('historyList');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const srtContainer = document.getElementById('srtContainer');
const srtPreview = document.getElementById('srtPreview');
const downloadSrtBtn = document.getElementById('downloadSrtBtn');
const srtLanguageSelect = document.getElementById('srtLanguage');
const translateSrtBtn = document.getElementById('translateSrtBtn');
const translateFulltextBtn = document.getElementById('translateFulltextBtn');
const translateSummaryBtn = document.getElementById('translateSummaryBtn');
const fulltextLanguageSelect = document.getElementById('fulltextLanguage');
const summaryLanguageSelect = document.getElementById('summaryLanguage');
const saveHistoryBtn = document.getElementById('saveHistoryBtn');
const deleteHistoryBtn = document.getElementById('deleteHistoryBtn');
const historyControls = document.getElementById('historyControls');
const selectAllHistory = document.getElementById('selectAllHistory');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const saveSelectedBtn = document.getElementById('saveSelectedBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressDetails = document.getElementById('progressDetails');
const loginBtnExtension = document.getElementById('loginBtnExtension');
const logoutBtnExtension = document.getElementById('logoutBtnExtension');
const userProfileExtension = document.getElementById('userProfileExtension');
const userAvatarExtension = document.getElementById('userAvatarExtension');
const authSectionExtension = document.getElementById('authSectionExtension');
const downloadButtons = document.getElementById('downloadButtons');
const downloadAudioBtn = document.getElementById('downloadAudioBtn');
const downloadVideoBtn = document.getElementById('downloadVideoBtn');
const audioQualityDropdown = document.getElementById('audioQualityDropdown');
const videoQualityDropdown = document.getElementById('videoQualityDropdown');

// Auth state
let currentSession = null;

// Listen for storage changes (when session is updated from another tab/dashboard)
// This must be set up BEFORE DOMContentLoaded to catch early changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.cutup_session) {
    const newSession = changes.cutup_session.newValue;
    const oldSession = changes.cutup_session.oldValue;
    
    // If session was removed (logout)
    if (!newSession && oldSession) {
      console.log('Popup: Session removed from storage (logout)');
      currentSession = null;
      showLoginButton();
      showLoginPrompt();
      return;
    }
    
    // If session was added or changed
    if (newSession && newSession !== currentSession) {
      console.log('Popup: Session changed in storage:', newSession);
      currentSession = newSession;
      verifySession(newSession);
    }
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'session_updated' && message.session) {
    console.log('Popup: Session updated from background:', message.session);
    if (message.session !== currentSession) {
      currentSession = message.session;
      verifySession(message.session);
    }
    sendResponse({ success: true });
  }
  return true;
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Load saved state (YouTube URL)
  chrome.storage.local.get(['savedYoutubeUrl'], (result) => {
    if (result.savedYoutubeUrl) {
      youtubeUrlInput.value = result.savedYoutubeUrl;
      checkInput();
    }
  });
  
  // Save YouTube URL when it changes
  youtubeUrlInput.addEventListener('input', () => {
    const url = youtubeUrlInput.value.trim();
    if (url) {
      chrome.storage.local.set({ savedYoutubeUrl: url });
    } else {
      chrome.storage.local.remove(['savedYoutubeUrl']);
    }
  });
  
  // Check if user is logged in first
  initAuth().then(() => {
    loadTheme();
    loadHistory();
    setupEventListeners();
    checkInput();
  });
  
  // Check for session in URL params (if opened from dashboard)
  const urlParams = new URLSearchParams(window.location.search);
  const sessionFromUrl = urlParams.get('session');
  if (sessionFromUrl) {
    currentSession = sessionFromUrl;
    chrome.storage.local.set({ cutup_session: sessionFromUrl });
    verifySession(sessionFromUrl);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  
  // Periodically check for session updates (in case dashboard updated it)
  // This helps sync when user logs in from dashboard
  setInterval(() => {
    chrome.storage.local.get(['cutup_session'], (result) => {
      if (result.cutup_session && result.cutup_session !== currentSession) {
        console.log('Popup: Session found in storage (polling):', result.cutup_session);
        currentSession = result.cutup_session;
        verifySession(result.cutup_session);
      }
    });
  }, 1000); // Check every 1 second for faster sync
});

// Theme Management
function loadTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    const theme = result.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
  });
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
  updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
  const icon = themeToggle.querySelector('.theme-icon');
  icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Event Listeners
function setupEventListeners() {
  themeToggle.addEventListener('click', toggleTheme);
  pasteBtn.addEventListener('click', pasteFromClipboard);
  summarizeBtn.addEventListener('click', handleSummarize);
  audioFileInput.addEventListener('change', handleFileSelect);
  youtubeUrlInput.addEventListener('input', checkInput);
  copyBtn.addEventListener('click', copyResult);
  downloadSrtBtn.addEventListener('click', downloadSrtFile);
  translateSrtBtn.addEventListener('click', handleTranslateSRT);
  if (translateFulltextBtn) {
    translateFulltextBtn.addEventListener('click', () => handleTranslateText('fulltext'));
  }
  if (translateSummaryBtn) {
    translateSummaryBtn.addEventListener('click', () => handleTranslateText('summary'));
  }
  saveHistoryBtn.addEventListener('click', toggleSaveMode);
  deleteHistoryBtn.addEventListener('click', toggleDeleteMode);
  selectAllHistory.addEventListener('change', handleSelectAll);
  deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
  saveSelectedBtn.addEventListener('click', handleSaveSelected);
  
  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchTab(tabName);
    });
  });
  
  // Auth event listeners
  if (loginBtnExtension) {
    loginBtnExtension.addEventListener('click', handleLogin);
  }
  if (logoutBtnExtension) {
    logoutBtnExtension.addEventListener('click', handleLogout);
  }
  
  // Download button event listeners
  if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener('click', toggleAudioQualityDropdown);
  }
  if (downloadVideoBtn) {
    downloadVideoBtn.addEventListener('click', toggleVideoQualityDropdown);
  }
  
  // Quality option event listeners
  document.querySelectorAll('#audioQualityDropdown .quality-option').forEach(option => {
    option.addEventListener('click', (e) => {
      if (!option.classList.contains('pro-locked')) {
        const quality = option.dataset.quality;
        downloadAudio(quality);
      }
    });
  });
  
  document.querySelectorAll('#videoQualityDropdown .quality-option').forEach(option => {
    option.addEventListener('click', (e) => {
      if (!option.classList.contains('pro-locked')) {
        const quality = option.dataset.quality;
        downloadVideo(quality);
      }
    });
  });
}

function checkInput() {
  const hasUrl = youtubeUrlInput.value.trim().length > 0;
  const hasFile = audioFileInput.files.length > 0;
  const isYouTube = hasUrl && isYouTubeUrl(youtubeUrlInput.value.trim());
  
  summarizeBtn.disabled = !(hasUrl || hasFile);
  
  // Show/hide download buttons for YouTube URLs
  if (isYouTube) {
    downloadButtons.style.display = 'flex';
    downloadAudioBtn.disabled = false;
    downloadVideoBtn.disabled = false;
    // Update quality dropdown based on subscription
    updateVideoQualityDropdown();
  } else {
    downloadButtons.style.display = 'none';
    audioQualityDropdown.style.display = 'none';
    videoQualityDropdown.style.display = 'none';
    downloadAudioBtn.classList.remove('active');
    downloadVideoBtn.classList.remove('active');
  }
}

async function pasteFromClipboard() {
  try {
    // Try using Clipboard API first
    if (navigator.clipboard && navigator.clipboard.readText) {
    const text = await navigator.clipboard.readText();
    youtubeUrlInput.value = text;
    checkInput();
      return;
    }
    
    // Fallback: Try using document.execCommand
    youtubeUrlInput.focus();
    const pasted = document.execCommand('paste');
    if (pasted) {
      checkInput();
      return;
    }
    
    // If both fail, show error
    throw new Error('Clipboard access not available');
  } catch (err) {
    console.error('Failed to read clipboard:', err);
    // Try alternative method: ask user to paste manually
    youtubeUrlInput.focus();
    youtubeUrlInput.select();
    alert('لطفاً متن را با Ctrl+V (یا Cmd+V در Mac) در فیلد وارد کنید.');
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    // بررسی اندازه فایل (حداکثر 100MB - پردازش در chunk برای فایل‌های بزرگ)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      alert(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxSize / 1024 / 1024}MB است.`);
      audioFileInput.value = ''; // پاک کردن انتخاب
      youtubeUrlInput.value = '';
      checkInput();
      return;
    }
    
    // هشدار برای فایل‌های بزرگ
    if (file.size > 25 * 1024 * 1024) {
      console.log(`FILE: Large file detected (${(file.size / 1024 / 1024).toFixed(2)}MB), will be processed in chunks`);
    }
    
    youtubeUrlInput.value = `📁 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
    checkInput();
  }
}

// Main Summarize Function
async function handleSummarize() {
  // Check if user is logged in
  if (!currentSession) {
    alert('لطفاً ابتدا وارد حساب کاربری خود شوید');
    handleLogin();
    return;
  }
  
  // Reset progress at start
  resetProgress();
  
  const url = youtubeUrlInput.value.trim();
  const file = audioFileInput.files[0];
  
  if (!url && !file) {
    alert('لطفاً لینک یوتیوب یا فایل صوتی را وارد کنید');
    return;
  }

  // Estimate video duration for limit check
  let estimatedDurationMinutes = 0;
  if (url && isYouTubeUrl(url)) {
    // Try to get duration from YouTube
    try {
      const videoId = extractVideoId(url);
      const response = await fetch(`${API_BASE_URL}/api/youtube-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, url })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.duration) {
          estimatedDurationMinutes = Math.ceil(data.duration / 60); // Convert seconds to minutes
        }
      }
    } catch (e) {
      console.warn('Could not get video duration:', e);
    }
  } else if (file) {
    // Estimate from file size (rough estimate: ~1MB per minute for audio)
    estimatedDurationMinutes = Math.ceil((file.size / 1024 / 1024) * 1.2); // Add 20% buffer
  }

  // Check subscription limits before processing
  try {
    const limitCheck = await checkSubscriptionLimit('transcription', estimatedDurationMinutes);
    if (!limitCheck.allowed) {
      alert(limitCheck.reason + '\n\nلطفاً پلن خود را ارتقا دهید یا بعداً تلاش کنید.');
      window.open(`${API_BASE_URL}/dashboard.html?session=${currentSession}`, '_blank');
      return;
    }
  } catch (error) {
    console.error('Error checking subscription limit:', error);
    // Continue anyway if check fails
  }

  // Show loading state
  summarizeBtn.disabled = true;
  summarizeBtn.querySelector('.btn-text').textContent = 'در حال پردازش...';
  summarizeBtn.querySelector('.btn-loader').style.display = 'inline-block';
  resultSection.style.display = 'none';
  progressSection.style.display = 'block';
  updateProgress(0, 'در حال آماده‌سازی...', '');

  try {
    let audioUrl = null;
    
    // بررسی اندازه فایل قبل از پردازش
    // محدودیت 100MB - فایل‌های بزرگ به صورت chunk پردازش می‌شوند
    if (file) {
      const maxSize = 100 * 1024 * 1024; // 100MB
      if (file.size > maxSize) {
        throw new Error(`فایل خیلی بزرگ است (${(file.size / 1024 / 1024).toFixed(2)}MB). حداکثر حجم مجاز ${maxSize / 1024 / 1024}MB است.`);
      }
    }
    
    // Handle YouTube URL
    if (url && isYouTubeUrl(url)) {
      // Initialize progress tracking
      resetProgress();
      progressStartTime = Date.now();
      progressEstimatedDuration = null;
      
      // Extract audio from YouTube (5-15% of total)
      updateProgress(5, 'در حال دریافت ویدیو از یوتیوب...', '');
      const youtubeResult = await extractYouTubeAudio(url);
      audioUrl = youtubeResult.audioUrl || youtubeResult; // Support both old and new format
      const youtubeLanguage = youtubeResult.language || null;
      updateProgress(15, 'ویدیو دریافت شد', '');
      
      // Set estimated duration for progress calculation
      if (youtubeResult.duration) {
        progressEstimatedDuration = youtubeResult.duration * 1000; // Convert to milliseconds
        console.log('PROGRESS: Video duration:', youtubeResult.duration, 'seconds');
      }
      
      // Check if YouTube subtitles are available
      let transcription = null;
      if (youtubeResult.subtitles) {
        // Use YouTube subtitles if available (15-60% of total)
        console.log('YOUTUBE: Using YouTube subtitles');
        updateProgress(20, 'در حال پردازش زیرنویس‌های یوتیوب...', '');
        
        // Simulate smooth progress during subtitle parsing
        const subtitleProgressInterval = setInterval(() => {
          if (targetProgress < 60) {
            updateProgress(targetProgress + 2, 'در حال پردازش زیرنویس‌های یوتیوب...', '');
          }
        }, 500);
        
        transcription = await parseYouTubeSubtitles(youtubeResult.subtitles, youtubeResult.subtitleLanguage);
        clearInterval(subtitleProgressInterval);
        updateProgress(60, 'زیرنویس پردازش شد', '');
      } else {
        // Fallback to audio transcription (15-75% of total)
        console.log('YOUTUBE: No subtitles available, transcribing audio');
        const durationText = youtubeResult.duration ? `(حدود ${Math.round(youtubeResult.duration / 60)} دقیقه)` : '';
        updateProgress(20, 'در حال تبدیل صوت به متن...', `این مرحله ممکن است چند دقیقه طول بکشد ${durationText}`);
        
        // Smooth progress based on elapsed time vs estimated duration
        let progressInterval = null;
        if (progressEstimatedDuration) {
          progressInterval = setInterval(() => {
            if (progressStartTime) {
              const elapsed = Date.now() - progressStartTime;
              // Estimate: transcription takes about 1.5x video duration
              const estimatedTranscriptionTime = progressEstimatedDuration * 1.5;
              const progressRatio = Math.min(0.55, elapsed / estimatedTranscriptionTime); // Max 55% (20% to 75%)
              const estimatedProgress = 20 + (progressRatio * 55);
              if (estimatedProgress > targetProgress) {
                updateProgress(estimatedProgress, 'در حال تبدیل صوت به متن...', `زمان سپری شده: ${Math.round(elapsed / 1000)} ثانیه`);
              }
            }
          }, 1000); // Update every second for smoother progress
        } else {
          // If no duration, use time-based estimation
          progressInterval = setInterval(() => {
            if (targetProgress < 75) {
              updateProgress(targetProgress + 1, 'در حال تبدیل صوت به متن...', '');
            }
          }, 2000);
        }
        
        transcription = await transcribeAudio(audioUrl, youtubeLanguage, (progress) => {
          if (progressInterval) clearInterval(progressInterval);
          // Map callback progress (0-100) to our range (20-75%)
          const mappedProgress = 20 + (progress * 0.55);
          updateProgress(mappedProgress, 'در حال تبدیل صوت به متن...', `پیشرفت: ${Math.round(progress)}%`);
        });
        if (progressInterval) clearInterval(progressInterval);
        updateProgress(75, 'تبدیل صوت به متن انجام شد', '');
      }
      
      // Check if summarization is allowed
      let summary = null;
      try {
        // Summarize text (unlimited for all tiers)
        // Summarize text with detected language (75-95% of total)
        updateProgress(80, 'در حال خلاصه‌سازی متن...', '');
        
        // Simulate smooth progress during summarization
        const summaryProgressInterval = setInterval(() => {
          if (targetProgress < 95) {
            updateProgress(targetProgress + 1, 'در حال خلاصه‌سازی متن...', '');
          }
        }, 300);
        
        summary = await summarizeText(transcription.text, transcription.language);
        clearInterval(summaryProgressInterval);
        updateProgress(95, 'خلاصه‌سازی انجام شد', '');
      } catch (error) {
        console.error('Error checking summarization limit:', error);
        // Continue without summary if check fails
        updateProgress(95, 'تبدیل به متن انجام شد', '');
        summary = {
          keyPoints: ['خطا در بررسی محدودیت خلاصه‌سازی'],
          summary: 'متن با موفقیت تبدیل شد اما خلاصه‌سازی در دسترس نیست.'
        };
      }

      // Display results with subtitle info
      displayResults(summary, transcription.text, transcription.segments, {
        isYouTubeSubtitle: !!youtubeResult.subtitles,
        availableLanguages: youtubeResult.availableLanguages || [],
        originalLanguage: transcription.language
      });

      // Save to history with video title if available, otherwise use URL
      // Make sure we use the title from youtubeResult, not the URL
      console.log('HISTORY: youtubeResult object:', youtubeResult);
      console.log('HISTORY: youtubeResult.title:', youtubeResult?.title);
      console.log('HISTORY: youtubeResult keys:', Object.keys(youtubeResult || {}));
      
      let historyTitle = url; // Default to URL
      
      // Check multiple possible locations for title
      const possibleTitle = youtubeResult?.title || 
                           youtubeResult?.videoTitle || 
                           (youtubeResult && typeof youtubeResult === 'object' && youtubeResult.title);
      
      if (possibleTitle && typeof possibleTitle === 'string' && possibleTitle.trim().length > 0) {
        historyTitle = possibleTitle.trim();
        console.log('HISTORY: Using video title:', historyTitle);
      } else {
        console.warn('HISTORY: No title found in youtubeResult, using URL:', url);
        console.warn('HISTORY: youtubeResult structure:', JSON.stringify(youtubeResult, null, 2));
      }
      
      saveToHistory(historyTitle, summary, transcription.text, transcription.segments);
      
      // Smooth final progress to 100%
      updateProgress(98, 'در حال ذخیره...', '');
      setTimeout(() => {
        updateProgress(100, 'تمام!', '');
        setTimeout(() => {
          progressSection.style.display = 'none';
          resetProgress();
        }, 1500);
      }, 500);
    } else if (file) {
      // Handle file upload - send directly to upload endpoint which transcribes
      // This avoids the 4.5MB limit by processing in the upload endpoint
      resetProgress();
      progressStartTime = Date.now();
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      
      // Estimate duration based on file size (rough estimate: ~1MB per minute for MP3)
      const estimatedMinutes = parseFloat(fileSizeMB);
      progressEstimatedDuration = estimatedMinutes * 60 * 1000; // Convert to milliseconds
      
      updateProgress(5, 'در حال آپلود فایل...', `حجم فایل: ${fileSizeMB} MB`);
      
      // Simulate upload progress (5-15%)
      const uploadProgressInterval = setInterval(() => {
        if (targetProgress < 15) {
          updateProgress(targetProgress + 1, 'در حال آپلود فایل...', `حجم فایل: ${fileSizeMB} MB`);
        }
      }, 200);
      
      setTimeout(() => {
        clearInterval(uploadProgressInterval);
        updateProgress(15, 'فایل آپلود شد', '');
      }, 3000);
      
      // Calculate progress based on elapsed time (15-75% for transcription)
      let progressInterval = null;
      if (progressEstimatedDuration) {
        progressInterval = setInterval(() => {
          if (progressStartTime) {
            const elapsed = Date.now() - progressStartTime;
            // Estimate: transcription takes about 1.5x audio duration
            const estimatedTranscriptionTime = progressEstimatedDuration * 1.5;
            const progressRatio = Math.min(0.6, (elapsed - 3000) / estimatedTranscriptionTime); // Subtract upload time
            const estimatedProgress = 15 + (progressRatio * 60); // 15% to 75%
            if (estimatedProgress > targetProgress) {
              updateProgress(estimatedProgress, 'در حال تبدیل صوت به متن...', `زمان سپری شده: ${Math.round(elapsed / 1000)} ثانیه`);
            }
          }
        }, 1000); // Update every second for smoother progress
    } else {
        // If no duration, use time-based estimation
        progressInterval = setInterval(() => {
          if (targetProgress < 75) {
            updateProgress(targetProgress + 1, 'در حال تبدیل صوت به متن...', '');
    }
        }, 2000);
      }
      
      const transcription = await transcribeAudio(file, null, (progress) => {
        if (progressInterval) clearInterval(progressInterval);
        // Map callback progress (0-100) to our range (15-75%)
        const mappedProgress = 15 + (progress * 0.6);
        updateProgress(mappedProgress, 'در حال تبدیل صوت به متن...', `پیشرفت: ${Math.round(progress)}%`);
      });
      if (progressInterval) clearInterval(progressInterval);
      updateProgress(75, 'تبدیل صوت به متن انجام شد', '');
      
      // Check if summarization is allowed
      let summary = null;
      try {
        // Summarize text (unlimited for all tiers)
        // Summarize text with detected language (75-95% of total)
        updateProgress(80, 'در حال خلاصه‌سازی متن...', '');
        
        // Simulate smooth progress during summarization
        const summaryProgressInterval = setInterval(() => {
          if (targetProgress < 95) {
            updateProgress(targetProgress + 1, 'در حال خلاصه‌سازی متن...', '');
          }
        }, 300);
        
        summary = await summarizeText(transcription.text, transcription.language);
        clearInterval(summaryProgressInterval);
        updateProgress(95, 'خلاصه‌سازی انجام شد', '');
      } catch (error) {
        console.error('Error checking summarization limit:', error);
        // Continue without summary if check fails
        updateProgress(95, 'تبدیل به متن انجام شد', '');
        summary = {
          keyPoints: ['خطا در بررسی محدودیت خلاصه‌سازی'],
          summary: 'متن با موفقیت تبدیل شد اما خلاصه‌سازی در دسترس نیست.'
        };
      }

    // Display results
      displayResults(summary, transcription.text, transcription.segments);

    // Save to history
      saveToHistory(file.name, summary, transcription.text, transcription.segments);
      
      // Smooth final progress to 100%
      updateProgress(98, 'در حال ذخیره...', '');
      setTimeout(() => {
        updateProgress(100, 'تمام!', '');
        setTimeout(() => {
          progressSection.style.display = 'none';
          resetProgress();
        }, 1500);
      }, 500);
    } else {
      throw new Error('لینک یوتیوب معتبر نیست');
    }
    

  } catch (error) {
    console.error('Error:', error);
    // Better error message handling
    let errorMessage = 'خطای نامشخص رخ داد';
    if (error && typeof error === 'object') {
      errorMessage = error.message || error.details || error.error || (error.toString ? error.toString() : JSON.stringify(error));
    } else if (error) {
      errorMessage = String(error);
    }
    updateProgress(0, 'خطا رخ داد', errorMessage);
    setTimeout(() => {
      progressSection.style.display = 'none';
      alert(`خطا: ${errorMessage}`);
    }, 2000);
  } finally {
    // Reset button state
    summarizeBtn.disabled = false;
    summarizeBtn.querySelector('.btn-text').textContent = 'خلاصه‌سازی';
    summarizeBtn.querySelector('.btn-loader').style.display = 'none';
  }
}

// YouTube URL validation
function isYouTubeUrl(url) {
  const patterns = [
    /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/,
    /^https?:\/\/youtube\.com\/watch\?v=.+/,
    /^https?:\/\/youtu\.be\/.+/
  ];
  return patterns.some(pattern => pattern.test(url));
}

// Extract YouTube video ID
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

// Extract YouTube video title using backend API
async function extractYouTubeTitleFromAPI(url) {
  try {
    console.log('YOUTUBE: Attempting to extract title from API:', url);
    
    const videoId = extractVideoId(url);
    if (!videoId) {
      console.warn('YOUTUBE: Could not extract video ID from URL');
      return null;
    }
    
    const response = await fetch(`${API_BASE_URL}/api/youtube-title`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ videoId, url }),
      signal: AbortSignal.timeout(30000) // 30 seconds timeout
    });
    
    console.log('YOUTUBE: Title API response status:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('YOUTUBE: Title API result:', result);
      if (result && result.title) {
        console.log('YOUTUBE: Title extracted from API:', result.title);
        return result.title;
      } else {
        console.warn('YOUTUBE: Title API returned no title:', result);
      }
    } else {
      const errorText = await response.text().catch(() => '');
      console.warn('YOUTUBE: Title API failed with status:', response.status, 'Error:', errorText);
    }
    
    return null;
  } catch (error) {
    console.warn('YOUTUBE: Error extracting title from API:', error);
    return null;
  }
}

// Extract YouTube audio using backend API
async function extractYouTubeAudio(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('لینک یوتیوب معتبر نیست');
  }
  
  console.log('YOUTUBE: Extracting audio for video ID:', videoId);
  
  // Try to extract title from API first (fast, no download needed)
  let apiTitle = null;
  try {
    apiTitle = await extractYouTubeTitleFromAPI(url);
  } catch (titleError) {
    console.warn('YOUTUBE: Could not extract title from API:', titleError);
  }
  
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
    console.log('YOUTUBE: Video title from main API:', result.title);
    console.log('YOUTUBE: Video title from title API:', apiTitle);
    
    // Use title from main API first, then title API as fallback
    const finalTitle = result.title || apiTitle;
    if (finalTitle) {
      console.log('YOUTUBE: Final title selected:', finalTitle);
    } else {
      console.warn('YOUTUBE: No title found from any source');
      console.warn('YOUTUBE: Main API result keys:', Object.keys(result || {}));
    }
    
    // Return audioUrl as string (data URL) and language hint
    // Support both old format (just string) and new format (object)
    if (typeof result === 'string') {
      return { 
        audioUrl: result, 
        language: null, 
        subtitles: null, 
        subtitleLanguage: null, 
        availableLanguages: [], 
        title: apiTitle || null,
        duration: null
      };
    }
    return {
      audioUrl: result.audioUrl,
      language: result.language || null,
      subtitles: result.subtitles || null,
      subtitleLanguage: result.subtitleLanguage || null,
      availableLanguages: result.availableLanguages || [],
      title: finalTitle || null, // Use API title or title API result
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

// Upload audio file - return file object for direct transmission
async function uploadAudioFile(file) {
  // Return file object directly - will be sent as FormData
  return file;
}

// Progress Management
let progressStartTime = null;
let progressEstimatedDuration = null;
let currentProgress = 0;
let targetProgress = 0;
let progressAnimationId = null;
let currentProgressText = '';
let currentProgressDetails = '';

// Smooth progress animation
function animateProgress() {
  if (currentProgress < targetProgress) {
    // Smooth increment (easing function for natural feel)
    const diff = targetProgress - currentProgress;
    const increment = Math.max(0.3, diff * 0.15); // 15% of remaining distance per frame, min 0.3%
    currentProgress = Math.min(targetProgress, currentProgress + increment);
    
    // Update UI
    if (progressBar) {
      progressBar.style.width = `${currentProgress}%`;
    }
    const progressPercent = document.getElementById('progressPercent');
    if (progressPercent) {
      progressPercent.textContent = `${Math.round(currentProgress)}%`;
    }
    
    // Continue animation
    progressAnimationId = requestAnimationFrame(animateProgress);
  } else {
    // Animation complete
    currentProgress = targetProgress;
    if (progressBar) {
      progressBar.style.width = `${currentProgress}%`;
    }
    const progressPercent = document.getElementById('progressPercent');
    if (progressPercent) {
      progressPercent.textContent = `${Math.round(currentProgress)}%`;
    }
    progressAnimationId = null; // Reset animation ID when complete
  }
}

function updateProgress(percent, text, details) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  
  // Only update target if it's higher than current (prevent going backwards)
  if (clampedPercent > targetProgress) {
    targetProgress = clampedPercent;
  }
  
  // Update text and details immediately
  if (text) {
    currentProgressText = text;
    if (progressText) {
      progressText.textContent = text;
    }
  }
  
  if (details !== undefined) {
    currentProgressDetails = details;
    if (progressDetails) {
      progressDetails.textContent = details;
    }
  }
  
  // Start smooth animation if not already running
  if (!progressAnimationId) {
    progressAnimationId = requestAnimationFrame(animateProgress);
  }
}

// Reset progress
function resetProgress() {
  // Cancel any running animation first
  if (progressAnimationId) {
    cancelAnimationFrame(progressAnimationId);
    progressAnimationId = null;
  }
  
  // Reset progress values
  currentProgress = 0;
  targetProgress = 0;
  currentProgressText = '';
  currentProgressDetails = '';
  
  // Reset UI immediately
  if (progressBar) {
    progressBar.style.width = '0%';
  }
  const progressPercent = document.getElementById('progressPercent');
  if (progressPercent) {
    progressPercent.textContent = '0%';
  }
  if (progressText) {
    progressText.textContent = 'در حال آماده‌سازی...';
  }
  if (progressDetails) {
    progressDetails.textContent = '';
  }
}

// API Calls
async function transcribeAudio(audioUrlOrVideoId, languageHint = null, onProgress = null) {
  try {
    let response;
    
    // If it's a File object, send to transcribe endpoint (upload endpoint needs redeploy)
    if (audioUrlOrVideoId instanceof File) {
      // Convert file to data URL first (temporary workaround until upload endpoint is redeployed)
      const fileDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
        reader.readAsDataURL(audioUrlOrVideoId);
  });
      
      console.log('TRANSCRIBE: Sending file to transcribe endpoint, size:', audioUrlOrVideoId.size, 'bytes');
      
      response = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ audioUrl: fileDataUrl, languageHint }),
        signal: AbortSignal.timeout(900000) // 15 minutes timeout for larger files (14 min video needs more time)
      });
      
      // Simulate progress for file upload
      if (onProgress) {
        onProgress(10);
        setTimeout(() => onProgress(30), 1000);
        setTimeout(() => onProgress(50), 3000);
        setTimeout(() => onProgress(70), 5000);
      }
    } else {
      // Handle JSON request (audioUrl or videoId) - send to transcribe endpoint
      console.log('TRANSCRIBE: Sending request to', `${API_BASE_URL}/api/transcribe`);
      
      // Handle both audioUrl string and {videoId, url} object (for YouTube)
  const body = typeof audioUrlOrVideoId === 'string' 
        ? { audioUrl: audioUrlOrVideoId, languageHint }
        : { videoId: audioUrlOrVideoId.videoId, languageHint };
  
  console.log('TRANSCRIBE: Body size:', JSON.stringify(body).length, 'bytes');
  
      // Simulate progress for transcription
      if (onProgress) {
        onProgress(10);
        const progressInterval = setInterval(() => {
          const current = parseInt(progressBar?.style.width) || 10;
          if (current < 80) {
            onProgress(Math.min(current + 5, 80));
          }
        }, 5000); // Update every 5 seconds
        
        // Clear interval when done
        setTimeout(() => clearInterval(progressInterval), 900000);
      }
      
      response = await fetch(`${API_BASE_URL}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
        signal: AbortSignal.timeout(900000) // 15 minutes timeout for larger files (14 min video needs more time)
    });
      
      if (onProgress) {
        onProgress(90);
      }
    }

    console.log('TRANSCRIBE: Response status:', response.status);
    console.log('TRANSCRIBE: Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Transcribe error:', {
        status: response.status,
        statusText: response.statusText,
        error: error,
        url: `${API_BASE_URL}/api/transcribe`,
        headers: Object.fromEntries(response.headers.entries()),
        errorDetails: error.details,
        errorType: error.errorType,
        errorCode: error.errorCode,
        retryable: error.retryable
      });
      
      // نمایش خطای دقیق‌تر بر اساس نوع خطا
      let errorMessage = error.message || error.details || `تبدیل صوت به متن ناموفق بود (${response.status})`;
      
      // اگر خطای quota است
      if (error.error === 'QUOTA_ERROR' || error.errorType === 'QuotaError') {
        errorMessage = 'سهمیه OpenAI شما تمام شده است. لطفاً به حساب OpenAI خود بروید و سهمیه یا روش پرداخت را بررسی کنید.';
      }
      // اگر خطای authentication است
      else if (error.error === 'AUTH_ERROR' || error.errorType === 'AuthError') {
        errorMessage = 'کلید API معتبر نیست. لطفاً کلید API را در فایل .env سرور بررسی کنید.';
      }
      // اگر خطای connection است و retryable است
      else if (error.retryable || error.error === 'CONNECTION_ERROR') {
        errorMessage = 'خطای اتصال به سرور. لطفاً دوباره تلاش کنید. اگر مشکل ادامه داشت، فایل ممکن است خیلی بزرگ باشد.';
      }
      
      // اگر errorType وجود دارد، آن را به پیام اضافه نکن (پیام قبلاً تنظیم شده)
      throw new Error(errorMessage);
    }

    // Get response text first to see what we're getting
    const responseText = await response.text();
    console.log('TRANSCRIBE: Response text (first 500 chars):', responseText.substring(0, 500));
    
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('TRANSCRIBE: Failed to parse JSON:', parseError);
      console.error('TRANSCRIBE: Response text:', responseText);
      throw new Error('پاسخ نامعتبر از سرور دریافت شد. لطفاً دوباره تلاش کنید.');
    }
    
    // Log full response for debugging
    console.log('TRANSCRIBE: Response parsed:', {
      hasText: !!result.text,
      textLength: result.text?.length || 0,
      hasSegments: !!result.segments,
      segmentsCount: result.segments?.length || 0,
      hasError: !!result.error,
      error: result.error,
      message: result.message,
      fullResponse: JSON.stringify(result).substring(0, 500)
    });
    
    // Validate result
    if (!result) {
      console.error('TRANSCRIBE: No result received');
      throw new Error('پاسخ نامعتبر از سرور دریافت شد');
    }
    
    if (!result.text || result.text.trim().length === 0) {
      console.error('TRANSCRIBE: No text in result:', result);
      throw new Error(`متن تبدیل شده در دسترس نیست. ${result.error ? 'خطا: ' + result.message : 'لطفاً دوباره تلاش کنید.'}`);
    }
    
    console.log('TRANSCRIBE: Success, text length:', result.text.length);
    console.log('TRANSCRIBE: Segments count:', result.segments?.length || 0);
    
    // Ensure segments is always an array
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

// Parse YouTube VTT subtitles to SRT format
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
// YouTube VTT subtitles are incremental (each segment contains all words up to that point)
// We need to extract only the new words in each segment
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
  // Each segment contains all words up to that point, so we need to extract only new words
  const segments = [];
  let previousText = '';
  
  for (let i = 0; i < rawSegments.length; i++) {
    const current = rawSegments[i];
    const currentText = current.text.trim();
    
    // If current text starts with previous text, extract only the new part
    if (previousText && currentText.startsWith(previousText)) {
      const newText = currentText.substring(previousText.length).trim();
      if (newText.length > 0) {
        // Use the start time of this segment for the new text
        segments.push({
          start: current.start,
          end: current.end,
          text: newText
        });
        previousText = currentText;
      }
    } else {
      // New segment (not incremental)
      segments.push({
        start: current.start,
        end: current.end,
        text: currentText
      });
      previousText = currentText;
    }
  }
  
  // If we still have duplicates, try a different approach: merge segments with same text
  // and only keep unique segments
  const uniqueSegments = [];
  const seenTexts = new Set();
  
  for (const segment of segments) {
    const normalizedText = segment.text.trim().toLowerCase();
    // Only add if we haven't seen this exact text before
    if (!seenTexts.has(normalizedText) || normalizedText.length > 50) {
      uniqueSegments.push(segment);
      seenTexts.add(normalizedText);
    }
  }

  // If we removed too many, use original segments but deduplicate by text similarity
  if (uniqueSegments.length < segments.length * 0.5) {
    // Use a smarter deduplication: keep segments that are significantly different
    const smartSegments = [];
    let lastText = '';
    
    for (const segment of segments) {
      const currentText = segment.text.trim();
      // Calculate similarity with last text
      const similarity = calculateTextSimilarity(lastText, currentText);
      
      // Only add if similarity is low (texts are different) or if it's the first segment
      if (similarity < 0.7 || lastText === '') {
        smartSegments.push(segment);
        lastText = currentText;
      }
    }
    
    return smartSegments.length > 0 ? smartSegments : segments;
  }
  
  return uniqueSegments.length > 0 ? uniqueSegments : segments;
}

// Calculate text similarity (0-1, where 1 is identical)
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

// Parse SRT time to seconds
function parseSRTTimeToSeconds(hours, minutes, seconds, milliseconds) {
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(milliseconds) / 1000;
}

// Display Results
function displayResults(summary, fullText, segments = null, options = {}) {
  // Display summary - handle both object and string formats
  let summaryTextContent = 'خلاصه در دسترس نیست';
  if (summary) {
    if (typeof summary === 'string') {
      summaryTextContent = summary;
    } else if (typeof summary === 'object' && summary.summary) {
      summaryTextContent = summary.summary;
    } else if (typeof summary === 'object' && summary.keyPoints) {
      // If it's an object with keyPoints, format it nicely
      const keyPoints = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
      const summaryPart = summary.summary || '';
      if (keyPoints.length > 0) {
        summaryTextContent = summaryPart + '\n\n' + keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n');
      } else {
        summaryTextContent = summaryPart || JSON.stringify(summary);
      }
    } else {
      summaryTextContent = JSON.stringify(summary);
    }
  }
  summaryText.textContent = summaryTextContent;

  // Store original texts for translation
  window.originalFullText = fullText;
  window.originalSummary = typeof summary === 'string' ? summary : (summary?.summary || summaryTextContent);
  window.originalTextLanguage = (options && options.originalLanguage) || 'en';

  // Display full text
  fulltext.textContent = fullText;

  // Generate and display SRT
  if (segments && Array.isArray(segments) && segments.length > 0) {
    // Validate segments have proper timing
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
      srtPreview.textContent = srtContent;
      window.currentSrtContent = srtContent;
    } else {
      // If segments are invalid, create a simple SRT with full text
      // Estimate duration: ~150 words per minute, minimum 10 seconds
      const wordCount = fullText.split(/\s+/).length;
      const estimatedDuration = Math.max(wordCount / 2.5, 10); // ~2.5 words per second
      const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${fullText}\n\n`;
      srtPreview.textContent = simpleSrt;
      window.currentSrtContent = simpleSrt;
    }
  } else {
    // If no segments, create a simple SRT with full text
    // Estimate duration: ~150 words per minute, minimum 10 seconds
    const wordCount = fullText.split(/\s+/).length;
    const estimatedDuration = Math.max(wordCount / 2.5, 10); // ~2.5 words per second
    const simpleSrt = `1\n00:00:00,000 --> ${formatSRTTime(estimatedDuration)}\n${fullText}\n\n`;
    srtPreview.textContent = simpleSrt;
    window.currentSrtContent = simpleSrt;
  }

  // Store original SRT for translation
  window.originalSrtContent = window.currentSrtContent;
  window.originalSrtSegments = segments;
  window.originalSrtLanguage = (options && options.originalLanguage) || 'en';
  window.availableLanguages = (options && options.availableLanguages) || [];
  
  // Update language select if YouTube subtitles available
  if (options && options.isYouTubeSubtitle && options.availableLanguages && options.availableLanguages.length > 0) {
    // Add available languages to select
    const currentOptions = Array.from(srtLanguageSelect.options);
    const existingValues = currentOptions.map(opt => opt.value);
    
    options.availableLanguages.forEach(lang => {
      if (!existingValues.includes(lang)) {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = getLanguageName(lang);
        srtLanguageSelect.appendChild(option);
      }
    });
  }

  // Show result section
  resultSection.style.display = 'block';
  
  // Switch to fulltext tab (first tab)
  switchTab('fulltext');
  
  // Scroll result section into view (below history)
  setTimeout(() => {
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// Get language name from code
function getLanguageName(code) {
  const names = {
    'fa': 'فارسی',
    'en': 'English',
    'ar': 'العربية',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'it': 'Italiano',
    'ru': 'Русский',
    'tr': 'Türkçe',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어'
  };
  return names[code] || code;
}

// Handle SRT translation
async function handleTranslateSRT() {
  const targetLanguage = srtLanguageSelect.value;
  
  if (targetLanguage === 'original') {
    // Restore original SRT
    if (window.originalSrtContent) {
      srtPreview.textContent = window.originalSrtContent;
      window.currentSrtContent = window.originalSrtContent;
    }
    return;
  }
  
  const srtContent = window.originalSrtContent || window.currentSrtContent;
  if (!srtContent) {
    alert('فایل SRT در دسترس نیست');
    return;
  }
  
  // Show loading state
  translateSrtBtn.disabled = true;
  translateSrtBtn.textContent = '⏳ در حال ترجمه...';
  
  try {
    console.log('TRANSLATE_SRT: Translating to', targetLanguage);
    
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        srtContent: srtContent,
        targetLanguage: targetLanguage,
        sourceLanguage: window.originalSrtLanguage || 'en'
      }),
      signal: AbortSignal.timeout(300000) // 5 minutes timeout
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.details || error.message || `ترجمه ناموفق بود (${response.status})`);
    }
    
    const result = await response.json();
    console.log('TRANSLATE_SRT: Success, translated segments:', result.segmentCount);
    
    // Update preview and current content
    srtPreview.textContent = result.srtContent;
    window.currentSrtContent = result.srtContent;
    
  } catch (error) {
    console.error('TRANSLATE_SRT: Error:', error);
    alert(`خطا در ترجمه: ${error.message}`);
  } finally {
    translateSrtBtn.disabled = false;
    translateSrtBtn.textContent = '🔄 ترجمه';
  }
}

// Get language name from code
function getLanguageName(code) {
  const names = {
    'fa': 'فارسی',
    'en': 'English',
    'ar': 'العربية',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'it': 'Italiano',
    'ru': 'Русский',
    'tr': 'Türkçe',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어'
  };
  return names[code] || code;
}

// Handle SRT translation
async function handleTranslateSRT() {
  const targetLanguage = srtLanguageSelect.value;
  
  if (targetLanguage === 'original') {
    // Restore original SRT
    if (window.originalSrtContent) {
      srtPreview.textContent = window.originalSrtContent;
      window.currentSrtContent = window.originalSrtContent;
    }
    return;
  }
  
  const srtContent = window.originalSrtContent || window.currentSrtContent;
  if (!srtContent) {
    alert('فایل SRT در دسترس نیست');
    return;
  }
  
  // Show loading state
  translateSrtBtn.disabled = true;
  translateSrtBtn.textContent = '⏳ در حال ترجمه...';
  
  try {
    console.log('TRANSLATE_SRT: Translating to', targetLanguage);
    
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        srtContent: srtContent,
        targetLanguage: targetLanguage,
        sourceLanguage: window.originalSrtLanguage || 'en'
      }),
      signal: AbortSignal.timeout(300000) // 5 minutes timeout
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.details || error.message || `ترجمه ناموفق بود (${response.status})`);
    }
    
    const result = await response.json();
    console.log('TRANSLATE_SRT: Success, translated segments:', result.segmentCount);
    
    // Update preview and current content
    srtPreview.textContent = result.srtContent;
    window.currentSrtContent = result.srtContent;
    
  } catch (error) {
    console.error('TRANSLATE_SRT: Error:', error);
    alert(`خطا در ترجمه: ${error.message}`);
  } finally {
    translateSrtBtn.disabled = false;
    translateSrtBtn.textContent = '🔄 ترجمه';
  }
}

// Handle translate text (fulltext or summary)
async function handleTranslateText(type) {
  const targetLanguage = type === 'fulltext' ? fulltextLanguageSelect.value : summaryLanguageSelect.value;
  const btn = type === 'fulltext' ? translateFulltextBtn : translateSummaryBtn;
  const element = type === 'fulltext' ? fulltext : summaryText;
  const originalText = type === 'fulltext' ? window.originalFullText : window.originalSummary;
  
  if (targetLanguage === 'original') {
    element.textContent = originalText;
    return;
  }
  
  if (!originalText) {
    alert('متن اصلی در دسترس نیست');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = '⏳ در حال ترجمه...';
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/translate-srt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        srtContent: `1\n00:00:00,000 --> 00:00:10,000\n${originalText}\n\n`,
        targetLanguage: targetLanguage,
        sourceLanguage: window.originalTextLanguage || 'en'
      }),
      signal: AbortSignal.timeout(300000)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.details || error.message || `ترجمه ناموفق بود (${response.status})`);
    }
    
    const result = await response.json();
    const translatedText = result.srtContent.split('\n').slice(2).join('\n').trim();
    element.textContent = translatedText;
    
  } catch (error) {
    console.error('TRANSLATE_TEXT: Error:', error);
    alert(`خطا در ترجمه: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 ترجمه';
  }
}

// Tab Management
function switchTab(tabName) {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

// Copy Result
async function copyResult() {
  const activeTab = document.querySelector('.tab-content.active');
  let textToCopy = '';
  
  if (activeTab.id === 'summary-tab') {
    textToCopy = summaryText.textContent;
  } else if (activeTab.id === 'srt-tab') {
    textToCopy = window.currentSrtContent || '';
  } else {
    textToCopy = fulltext.textContent;
  }

  try {
    await navigator.clipboard.writeText(textToCopy);
    copyBtn.textContent = '✓';
    setTimeout(() => {
      copyBtn.textContent = '📋';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    alert('کپی ناموفق بود');
  }
}

// Generate SRT file content from segments
function generateSRT(segments) {
  let srtContent = '';
  let segmentIndex = 1;
  
  segments.forEach((segment) => {
    // Validate segment has required fields
    if (!segment || typeof segment.start !== 'number' || typeof segment.end !== 'number') {
      return; // Skip invalid segments
    }
    
    // Ensure end time is after start time
    if (segment.end <= segment.start) {
      return; // Skip invalid timing
    }
    
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);
    const text = (segment.text || '').trim();
    
    // Only add segment if it has text
    if (text.length > 0) {
      srtContent += `${segmentIndex}\n${startTime} --> ${endTime}\n${text}\n\n`;
      segmentIndex++;
    }
  });
  
  return srtContent;
}

// Format time in seconds to SRT format (HH:MM:SS,mmm)
function formatSRTTime(seconds) {
  // Ensure seconds is a valid number
  const secs = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const secsPart = Math.floor(secs % 60);
  const milliseconds = Math.floor((secs % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secsPart).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

// Download SRT file
function downloadSrtFile() {
  const srtContent = window.currentSrtContent || '';
  if (!srtContent) {
    alert('فایل SRT در دسترس نیست');
    return;
  }
  
  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subtitles_${Date.now()}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// History Management
function saveToHistory(title, summary, fullText, segments = null, type = 'transcription', metadata = null) {
  chrome.storage.local.get(['history'], (result) => {
    const history = result.history || [];
    // Truncate title to 80 characters for better display
    const truncatedTitle = title.length > 80 ? title.substring(0, 77) + '...' : title;
    
    // Format date with time (Persian format: HH:MM - YYYY/M/D)
    const now = new Date();
    const persianDate = now.toLocaleDateString('fa-IR', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const persianTime = now.toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const dateWithTime = `${persianTime} - ${persianDate}`;
    
    const newItem = {
      id: Date.now(),
      title: truncatedTitle,
      date: dateWithTime,
      type: type, // 'transcription', 'downloadAudio', 'downloadVideo'
      summary,
      fullText,
      segments,
      metadata: metadata || null // For downloads: { quality, videoId, url }
    };
    
    history.unshift(newItem);
    // Keep only last 20 items
    const limitedHistory = history.slice(0, 20);
    
    chrome.storage.local.set({ history: limitedHistory }, () => {
      loadHistory();
    });
  });
}

// Track which history item is currently loaded in result section
let selectedHistoryId = null;

function loadHistory() {
  chrome.storage.local.get(['history'], (result) => {
    const history = result.history || [];
    
    // If result section was moved, restore it to original position
    const currentParent = resultSection.parentElement;
    if (currentParent && currentParent !== historySection.parentElement) {
      resultSection.remove();
      // Re-append to original position (after history section)
      historySection.parentElement.insertBefore(resultSection, historySection.nextSibling);
    }
    
    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty-state">تاریخچه‌ای وجود ندارد</div>';
      historyControls.style.display = 'none';
      resultSection.style.display = 'none';
      selectedHistoryId = null;
      return;
    }

    const isDeleteMode = historyControls.dataset.mode === 'delete';
    const isSaveMode = historyControls.dataset.mode === 'save';
    const isSelectionMode = isDeleteMode || isSaveMode;

    historyList.innerHTML = history.map(item => {
      const typeIcon = item.type === 'downloadAudio' ? '🎵' : 
                       item.type === 'downloadVideo' ? '🎬' : 
                       '📝';
      const typeLabel = item.type === 'downloadAudio' ? 'موزیک' : 
                        item.type === 'downloadVideo' ? 'ویدئو' : 
                        'خلاصه‌سازی';
      const qualityLabel = item.metadata && item.metadata.quality ? ` (${item.metadata.quality})` : '';
      
      return `
      <div class="history-item" data-id="${item.id}">
        ${isSelectionMode ? `<input type="checkbox" class="history-checkbox" data-id="${item.id}">` : ''}
        <div class="history-item-content" ${!isSelectionMode ? 'style="cursor: pointer;"' : ''}>
        <div class="history-item-title">${typeIcon} ${item.title}${qualityLabel}</div>
        <div class="history-item-date">${item.date} • ${typeLabel}</div>
        </div>
      </div>
    `;
    }).join('');

    // Add click listeners - click on history item to toggle result section
    document.querySelectorAll('.history-item').forEach(item => {
      const content = item.querySelector('.history-item-content');
      if (content && !isSelectionMode) {
        content.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        loadHistoryItem(id, history);
      });
      }
    });
    
    // Add checkbox change listeners
    if (isSelectionMode) {
      document.querySelectorAll('.history-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
          updateDeleteButtonState();
          updateSaveButtonState();
    });
  });
    }
    
    updateDeleteButtonState();
    updateSaveButtonState();
  });
}

// Format summary for display
function formatSummary(summary) {
  if (!summary) return 'بدون خلاصه';
  if (typeof summary === 'string') return summary;
  if (typeof summary === 'object') {
    if (summary.summary) {
      const keyPoints = Array.isArray(summary.keyPoints) ? summary.keyPoints : [];
      if (keyPoints.length > 0) {
        return summary.summary + '\n\n' + keyPoints.map((kp, i) => `${i + 1}. ${kp}`).join('\n');
      }
      return summary.summary;
    }
    return JSON.stringify(summary);
  }
  return String(summary);
}

// Toggle delete mode
function toggleDeleteMode() {
  const isVisible = historyControls.style.display !== 'none';
  const currentMode = historyControls.dataset.mode;
  
  if (isVisible && currentMode === 'delete') {
    // Exit delete mode
    historyControls.style.display = 'none';
    historyControls.dataset.mode = '';
    deleteSelectedBtn.style.display = 'none';
    saveSelectedBtn.style.display = 'none';
    // Remove active state from button
    deleteHistoryBtn.classList.remove('active');
  } else {
    // Exit save mode if active
    if (currentMode === 'save') {
      saveHistoryBtn.classList.remove('active');
    }
    // Enter delete mode - hide save button, show delete button
    historyControls.style.display = 'flex';
    historyControls.dataset.mode = 'delete';
    selectAllHistory.checked = false;
    deleteSelectedBtn.disabled = true;
    deleteSelectedBtn.style.display = 'block';
    saveSelectedBtn.style.display = 'none';
    // Add active state to button
    deleteHistoryBtn.classList.add('active');
    saveHistoryBtn.classList.remove('active');
  }
  
  loadHistory(); // Reload to show/hide checkboxes
}

// Toggle save mode
function toggleSaveMode() {
  const isVisible = historyControls.style.display !== 'none';
  const currentMode = historyControls.dataset.mode;
  
  if (isVisible && currentMode === 'save') {
    // Exit save mode
    historyControls.style.display = 'none';
    historyControls.dataset.mode = '';
    saveSelectedBtn.style.display = 'none';
    deleteSelectedBtn.style.display = 'none';
    // Remove active state from button
    saveHistoryBtn.classList.remove('active');
  } else {
    // Exit delete mode if active
    if (currentMode === 'delete') {
      deleteHistoryBtn.classList.remove('active');
    }
    // Enter save mode - hide delete button, show save button
    historyControls.style.display = 'flex';
    historyControls.dataset.mode = 'save';
    selectAllHistory.checked = false;
    saveSelectedBtn.disabled = true;
    saveSelectedBtn.style.display = 'block';
    deleteSelectedBtn.style.display = 'none';
    // Add active state to button
    saveHistoryBtn.classList.add('active');
    deleteHistoryBtn.classList.remove('active');
  }
  
  loadHistory(); // Reload to show/hide checkboxes
}

// Handle select all
function handleSelectAll() {
  const checkboxes = document.querySelectorAll('.history-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAllHistory.checked;
  });
  updateDeleteButtonState();
  updateSaveButtonState();
}

// Update delete button state
function updateDeleteButtonState() {
  const checkboxes = document.querySelectorAll('.history-checkbox:checked');
  const isDeleteMode = historyControls.dataset.mode === 'delete';
  if (isDeleteMode) {
    deleteSelectedBtn.disabled = checkboxes.length === 0;
  }
}

// Update save button state
function updateSaveButtonState() {
  const checkboxes = document.querySelectorAll('.history-checkbox:checked');
  const isSaveMode = historyControls.dataset.mode === 'save';
  if (isSaveMode) {
    saveSelectedBtn.disabled = checkboxes.length === 0;
  }
}

// Handle delete selected
function handleDeleteSelected() {
  const checkboxes = document.querySelectorAll('.history-checkbox:checked');
  if (checkboxes.length === 0) return;
  
  const idsToDelete = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
  
  if (confirm(`آیا مطمئن هستید که می‌خواهید ${idsToDelete.length} مورد را حذف کنید؟`)) {
    chrome.storage.local.get(['history'], (result) => {
      const history = result.history || [];
      const filteredHistory = history.filter(item => !idsToDelete.includes(item.id));
      
      chrome.storage.local.set({ history: filteredHistory }, () => {
        loadHistory();
        if (filteredHistory.length === 0) {
          toggleDeleteMode(); // Exit delete mode if no items left
        }
      });
    });
  }
}

// Handle save selected history items as ZIP
async function handleSaveSelected() {
  console.log('SAVE: handleSaveSelected called');
  const checkboxes = document.querySelectorAll('.history-checkbox:checked');
  console.log('SAVE: Checked checkboxes:', checkboxes.length);
  if (checkboxes.length === 0) {
    alert('لطفاً حداقل یک تاریخچه را انتخاب کنید');
    return;
  }
  
  const idsToSave = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
  
  chrome.storage.local.get(['history'], async (result) => {
    const history = result.history || [];
    const itemsToSave = history.filter(item => idsToSave.includes(item.id));
    
    if (itemsToSave.length === 0) {
      alert('موردی برای ذخیره انتخاب نشده است');
      return;
    }
    
    try {
      // Check if JSZip is available
      if (typeof JSZip === 'undefined') {
        alert('خطا: کتابخانه JSZip بارگذاری نشده است. لطفاً صفحه را refresh کنید.');
        console.error('JSZip is not defined');
        return;
      }
      
      // Create ZIP file
      const zip = new JSZip();
      
      if (itemsToSave.length === 1) {
        // Single item: Create folder with title, then ZIP it
        const item = itemsToSave[0];
        const folderName = sanitizeFileName(item.title);
        const folder = zip.folder(folderName);
        
        // Add full text
        if (item.fullText) {
          folder.file('متن کامل.txt', item.fullText);
        }
        
          // Add summary
          if (item.summary) {
            const summaryText = formatSummary(item.summary);
            folder.file('خلاصه.txt', summaryText);
          }
        
        // Add SRT
        if (item.segments && item.segments.length > 0) {
          const srtContent = generateSRT(item.segments);
          folder.file('زیرنویس.srt', srtContent);
        }
        
        // Generate and download ZIP
        console.log('SAVE: Generating ZIP for single item:', folderName);
        const blob = await zip.generateAsync({ type: 'blob' });
        console.log('SAVE: ZIP blob created, size:', blob.size);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        document.body.appendChild(a);
        console.log('SAVE: Triggering download...');
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log('SAVE: Download completed');
        }, 100);
      } else {
        // Multiple items: Create CutUp folder, then subfolders for each item
        const cutupFolder = zip.folder('CutUp');
        
        itemsToSave.forEach(item => {
          const folderName = sanitizeFileName(item.title);
          const itemFolder = cutupFolder.folder(folderName);
          
          // Add full text
          if (item.fullText) {
            itemFolder.file('متن کامل.txt', item.fullText);
          }
          
          // Add summary
          if (item.summary) {
            const summaryText = formatSummary(item.summary);
            itemFolder.file('خلاصه.txt', summaryText);
          }
          
          // Add SRT
          if (item.segments && item.segments.length > 0) {
            const srtContent = generateSRT(item.segments);
            itemFolder.file('زیرنویس.srt', srtContent);
          }
        });
        
        // Generate and download ZIP
        console.log('SAVE: Generating ZIP for multiple items (CutUp)');
        const blob = await zip.generateAsync({ type: 'blob' });
        console.log('SAVE: ZIP blob created, size:', blob.size);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'CutUp.zip';
        document.body.appendChild(a);
        console.log('SAVE: Triggering download...');
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          console.log('SAVE: Download completed');
        }, 100);
      }
      
      // Exit save mode after successful download
      toggleSaveMode();
    } catch (error) {
      console.error('Error creating ZIP:', error);
      alert('خطا در ایجاد فایل ZIP. لطفاً دوباره تلاش کنید.');
    }
  });
}

// Sanitize file name (remove invalid characters)
function sanitizeFileName(fileName) {
  // Remove or replace invalid characters for file/folder names
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars with underscore
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .substring(0, 100); // Limit length
}

// Generate SRT content from segments
function generateSRT(segments) {
  if (!segments || segments.length === 0) return '';
  
  return segments.map((segment, index) => {
    const start = formatSRTTime(segment.start);
    const end = formatSRTTime(segment.end);
    return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
  }).join('\n');
}

// Format time for SRT (HH:MM:SS,mmm)
function formatSRTTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

// Download SRT for a history item
function downloadHistorySrt(item) {
  if (!item.segments || item.segments.length === 0) {
    alert('زیرنویسی برای این مورد وجود ندارد');
    return;
  }
  
  const srtContent = generateSRT(item.segments);
  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFileName(item.title)}.srt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function loadHistoryItem(id, history) {
  const item = history.find(h => h.id === id);
  if (item) {
    // If clicking on the same item, collapse result section
    if (selectedHistoryId === id && resultSection.style.display !== 'none') {
      resultSection.style.display = 'none';
      selectedHistoryId = null;
      
      // Remove result section from its current position if it was moved
      const currentParent = resultSection.parentElement;
      if (currentParent && currentParent !== historySection.parentElement) {
        resultSection.remove();
        // Re-append to original position (after history section)
        historySection.parentElement.insertBefore(resultSection, historySection.nextSibling);
      }
      return;
    }
    
    // Find the history item element
    const historyItemElement = document.querySelector(`.history-item[data-id="${id}"]`);
    if (!historyItemElement) {
      console.error('History item element not found');
      return;
    }
    
    // Remove result section from its current position if it exists elsewhere
    const currentParent = resultSection.parentElement;
    if (currentParent && currentParent !== historySection.parentElement) {
      resultSection.remove();
    }
    
    // Move result section to be right after the clicked history item
    // Check if there's already a result section after this item
    const existingResult = historyItemElement.nextElementSibling;
    if (existingResult && existingResult.id === 'resultSection') {
      existingResult.remove();
    }
    
    // Insert result section after the clicked history item
    historyItemElement.insertAdjacentElement('afterend', resultSection);
    
    // For download items, show metadata instead of results
    if (item.type === 'downloadAudio' || item.type === 'downloadVideo') {
      resultSection.style.display = 'block';
      resultSection.innerHTML = `
        <div class="result-content">
          <div class="result-header">
            <h3>${item.type === 'downloadAudio' ? '🎵 دانلود موزیک' : '🎬 دانلود ویدئو'}</h3>
          </div>
          <div class="result-body">
            <p><strong>عنوان:</strong> ${item.title}</p>
            ${item.metadata && item.metadata.quality ? `<p><strong>کیفیت:</strong> ${item.metadata.quality}</p>` : ''}
            ${item.metadata && item.metadata.url ? `<p><strong>لینک:</strong> <a href="${item.metadata.url}" target="_blank" style="color: var(--accent);">${item.metadata.url}</a></p>` : ''}
            <p><strong>تاریخ:</strong> ${item.date}</p>
          </div>
        </div>
      `;
    } else {
      // Pass empty options object to maintain compatibility
      displayResults(item.summary, item.fullText, item.segments || null, {});
    }
    selectedHistoryId = id;
    
    // Scroll result section into view (below the clicked history item)
    setTimeout(() => {
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}
}

// Auth Functions
async function initAuth() {
  return new Promise((resolve) => {
    // Load session from storage
    chrome.storage.local.get(['cutup_session'], (result) => {
      if (result.cutup_session) {
        currentSession = result.cutup_session;
        verifySession(result.cutup_session).then(resolve);
      } else {
        // User must login first
        showLoginButton();
        // Show login prompt
        showLoginPrompt();
        resolve();
      }
    });
  });
}

function showLoginPrompt() {
  // Create a modal or message to prompt login
  const loginPrompt = document.createElement('div');
  loginPrompt.className = 'login-prompt';
  loginPrompt.innerHTML = `
    <div class="login-prompt-content">
      <h3>ورود به حساب کاربری</h3>
      <p>برای استفاده از Cutup، لطفاً وارد حساب کاربری خود شوید.</p>
      <button class="login-prompt-btn" id="loginPromptBtn">ورود با Google</button>
    </div>
  `;
  document.body.appendChild(loginPrompt);
  
  document.getElementById('loginPromptBtn').addEventListener('click', handleLogin);
}

async function verifySession(sessionId) {
  return new Promise((resolve) => {
    fetch(`${API_BASE_URL}/api/auth?action=verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ session: sessionId })
    })
    .then(response => {
      if (response.ok) {
        return response.json();
      } else {
        throw new Error('Session invalid');
      }
    })
    .then(data => {
      if (data.valid && data.user) {
        currentSession = sessionId; // Ensure session is set
        showUserProfile(data.user);
        showLoginButton(); // This will hide login button and show profile
        // Remove login prompt if exists
        const loginPrompt = document.querySelector('.login-prompt');
        if (loginPrompt) {
          loginPrompt.remove();
        }
        // Load subscription info and update UI
        getSubscriptionInfo();
        resolve();
      } else {
        chrome.storage.local.remove(['cutup_session']);
        currentSession = null;
        showLoginButton();
        resolve();
      }
    })
    .catch(error => {
      console.error('Error verifying session:', error);
      chrome.storage.local.remove(['cutup_session']);
      currentSession = null;
      showLoginButton();
      resolve();
    });
  });
}

function showLoginButton() {
  // This function shows login button if not logged in, or hides it if logged in
  if (!currentSession) {
    if (loginBtnExtension) loginBtnExtension.style.display = 'block';
    if (userProfileExtension) userProfileExtension.style.display = 'none';
  } else {
    if (loginBtnExtension) loginBtnExtension.style.display = 'none';
    if (userProfileExtension) userProfileExtension.style.display = 'flex';
  }
}

function showUserProfile(user) {
  if (loginBtnExtension) loginBtnExtension.style.display = 'none';
  if (userProfileExtension) userProfileExtension.style.display = 'flex';
  if (userAvatarExtension) {
    userAvatarExtension.src = user.picture || '';
    userAvatarExtension.alt = user.name || 'User';
  }
  
  // Show welcome message
  showWelcomeMessage(user);
  
  // Update quality dropdown based on subscription
  updateVideoQualityDropdown();
}

function showWelcomeMessage(user) {
  // Remove existing welcome message if any
  const existingWelcome = document.querySelector('.welcome-message-extension');
  if (existingWelcome) {
    existingWelcome.remove();
  }
  
  // Create welcome message
  const welcomeDiv = document.createElement('div');
  welcomeDiv.className = 'welcome-message-extension';
  welcomeDiv.innerHTML = `
    <div class="welcome-content">
      <span class="welcome-icon">👋</span>
      <span class="welcome-text">خوش آمدید ${user.name || user.email}!</span>
    </div>
  `;
  
  // Insert after header
  const header = document.querySelector('.header');
  if (header && header.nextSibling) {
    header.parentNode.insertBefore(welcomeDiv, header.nextSibling);
  } else if (header) {
    header.parentNode.appendChild(welcomeDiv);
  }
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    if (welcomeDiv && welcomeDiv.parentNode) {
      welcomeDiv.style.opacity = '0';
      welcomeDiv.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        if (welcomeDiv && welcomeDiv.parentNode) {
          welcomeDiv.remove();
        }
      }, 300);
    }
  }, 5000);
}

async function handleLogin() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth?action=login`);
    const data = await response.json();
    if (data.authUrl) {
      // Open Google OAuth in a new tab
      // After login, user will be redirected to dashboard
      chrome.tabs.create({ url: data.authUrl });
      
      // Listen for tab updates to detect when user returns from OAuth
      let listenerAdded = false;
      const listener = function(tabId, changeInfo, tab) {
        if (changeInfo.status === 'complete' && tab.url) {
          // Check if it's dashboard with session
          if (tab.url.includes('dashboard.html')) {
            const url = new URL(tab.url);
            const session = url.searchParams.get('session');
            if (session) {
              // Save session and verify
              currentSession = session;
              chrome.storage.local.set({ cutup_session: session }, () => {
                verifySession(session);
                // Close login prompt if exists
                const loginPrompt = document.querySelector('.login-prompt');
                if (loginPrompt) {
                  loginPrompt.remove();
                }
              });
            }
            if (listenerAdded) {
              chrome.tabs.onUpdated.removeListener(listener);
              listenerAdded = false;
            }
          }
          // Also check for auth=success in URL
          else if (tab.url.includes('auth=success')) {
            const url = new URL(tab.url);
            const session = url.searchParams.get('session');
            if (session) {
              currentSession = session;
              chrome.storage.local.set({ cutup_session: session }, () => {
                verifySession(session);
                const loginPrompt = document.querySelector('.login-prompt');
                if (loginPrompt) {
                  loginPrompt.remove();
                }
              });
            }
            if (listenerAdded) {
              chrome.tabs.onUpdated.removeListener(listener);
              listenerAdded = false;
            }
          }
        }
      };
      
      chrome.tabs.onUpdated.addListener(listener);
      listenerAdded = true;
      
      // Also poll for session in case listener doesn't catch it
      let pollCount = 0;
      const pollInterval = setInterval(() => {
        pollCount++;
        if (pollCount > 30) { // Stop after 30 seconds
          clearInterval(pollInterval);
          if (listenerAdded) {
            chrome.tabs.onUpdated.removeListener(listener);
          }
          return;
        }
        
        chrome.storage.local.get(['cutup_session'], (result) => {
          if (result.cutup_session && result.cutup_session !== currentSession) {
            currentSession = result.cutup_session;
            verifySession(result.cutup_session);
            const loginPrompt = document.querySelector('.login-prompt');
            if (loginPrompt) {
              loginPrompt.remove();
            }
            clearInterval(pollInterval);
            if (listenerAdded) {
              chrome.tabs.onUpdated.removeListener(listener);
            }
          }
        });
      }, 1000); // Check every second
      
    } else {
      alert('خطا در دریافت لینک ورود. لطفاً دوباره تلاش کنید.');
    }
  } catch (error) {
    console.error('Error initiating login:', error);
    alert('خطا در ورود. لطفاً دوباره تلاش کنید.');
  }
}

async function handleLogout() {
  const sessionId = currentSession || (await chrome.storage.local.get(['cutup_session'])).cutup_session;
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
  chrome.storage.local.remove(['cutup_session']);
  currentSession = null;
  showLoginButton();
  // Show login prompt after logout
  showLoginPrompt();
}

// Listen for auth callback from website
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'auth_success' && message.session) {
    currentSession = message.session;
    chrome.storage.local.set({ cutup_session: message.session }, () => {
      verifySession(message.session);
      // Close login prompt if exists
      const loginPrompt = document.querySelector('.login-prompt');
      if (loginPrompt) {
        loginPrompt.remove();
      }
    });
    sendResponse({ success: true });
  }
  return true; // Keep channel open for async response
});

// Also check for session on popup open
chrome.storage.local.get(['cutup_session'], (result) => {
  if (result.cutup_session && result.cutup_session !== currentSession) {
    currentSession = result.cutup_session;
    verifySession(result.cutup_session);
  }
});

// Download Functions
function toggleAudioQualityDropdown() {
  const isOpen = audioQualityDropdown.style.display === 'block';
  audioQualityDropdown.style.display = isOpen ? 'none' : 'block';
  downloadAudioBtn.classList.toggle('active', !isOpen);
  
  // Close video dropdown if open
  if (videoQualityDropdown.style.display === 'block') {
    videoQualityDropdown.style.display = 'none';
    downloadVideoBtn.classList.remove('active');
  }
}

function toggleVideoQualityDropdown() {
  const isOpen = videoQualityDropdown.style.display === 'block';
  videoQualityDropdown.style.display = isOpen ? 'none' : 'block';
  downloadVideoBtn.classList.toggle('active', !isOpen);
  
  // Close audio dropdown if open
  if (audioQualityDropdown.style.display === 'block') {
    audioQualityDropdown.style.display = 'none';
    downloadAudioBtn.classList.remove('active');
  }
}

async function downloadAudio(quality) {
  // Check if user is logged in
  if (!currentSession) {
    alert('لطفاً ابتدا وارد حساب کاربری خود شوید');
    handleLogin();
    return;
  }
  
  const url = youtubeUrlInput.value.trim();
  if (!url || !isYouTubeUrl(url)) {
    alert('لطفاً یک لینک یوتیوب معتبر وارد کنید');
    return;
  }
  
  const videoId = extractVideoId(url);
  if (!videoId) {
    alert('لینک یوتیوب معتبر نیست');
    return;
  }
  
  // Check download feature
  try {
    const canDownload = await checkSubscriptionLimit('downloadAudio', 0);
    if (!canDownload.allowed) {
      alert(canDownload.reason);
      return;
    }
  } catch (error) {
    console.error('Error checking subscription:', error);
    // Continue anyway if check fails
  }
  
  try {
    // Close dropdown
    audioQualityDropdown.style.display = 'none';
    downloadAudioBtn.classList.remove('active');
    
    // Show progress
    progressSection.style.display = 'block';
    updateProgress(0, 'در حال دانلود موزیک...', '');
    
    // Disable button
    downloadAudioBtn.disabled = true;
    downloadAudioBtn.innerHTML = '<span>⏳ در حال دانلود...</span>';
    
    // Get video title for history
    let videoTitle = `ویدئو یوتیوب ${videoId}`;
    try {
      const titleResponse = await fetch(`${API_BASE_URL}/api/youtube-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, url })
      });
      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        if (titleData.title) {
          videoTitle = titleData.title;
        }
      }
    } catch (e) {
      console.warn('Could not get video title:', e);
    }
    
    updateProgress(10, 'در حال دانلود موزیک...', 'در حال اتصال به سرور...');
    
    // Get download URL
    const response = await fetch(`${API_BASE_URL}/api/youtube-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoId: videoId,
        url: url,
        type: 'audio',
        quality: quality
      })
    });
    
    updateProgress(30, 'در حال دانلود موزیک...', 'در حال دریافت فایل...');
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'دانلود ناموفق بود');
    }
    
    // Get content length for progress
    const contentLength = response.headers.get('content-length');
    let loaded = 0;
    
    if (!contentLength) {
      updateProgress(50, 'در حال دانلود موزیک...', 'در حال دریافت فایل...');
    }
    
    // Get blob and download with progress
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      if (contentLength) {
        const percent = Math.min(90, 30 + (receivedLength / contentLength) * 60);
        updateProgress(percent, 'در حال دانلود موزیک...', `دریافت شده: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`);
      }
    }
    
    updateProgress(95, 'در حال آماده‌سازی فایل...', '');
    
    // Combine chunks
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    
    const blob = new Blob([allChunks], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `youtube_${videoId}_${quality}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    
    updateProgress(100, 'دانلود کامل شد!', '');
    
    // Record download
    try {
      await fetch(`${API_BASE_URL}/api/subscription?action=recordDownload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': currentSession
        },
        body: JSON.stringify({ type: 'audio' })
      });
    } catch (e) {
      console.error('Error recording download:', e);
    }
    
    // Save to history
    saveToHistory(videoTitle, null, null, null, 'downloadAudio', { quality, videoId, url });
    
    // Hide progress after 1 second
    setTimeout(() => {
      progressSection.style.display = 'none';
    }, 1000);
    
    // Reset button
    downloadAudioBtn.disabled = false;
    downloadAudioBtn.innerHTML = '<span>🎵 دانلود موزیک</span><span class="dropdown-arrow">▼</span>';
    
  } catch (error) {
    console.error('Download audio error:', error);
    progressSection.style.display = 'none';
    alert(`خطا در دانلود: ${error.message}`);
    downloadAudioBtn.disabled = false;
    downloadAudioBtn.innerHTML = '<span>🎵 دانلود موزیک</span><span class="dropdown-arrow">▼</span>';
  }
}

async function downloadVideo(quality) {
  // Check if user is logged in
  if (!currentSession) {
    alert('لطفاً ابتدا وارد حساب کاربری خود شوید');
    handleLogin();
    return;
  }
  
  const url = youtubeUrlInput.value.trim();
  if (!url || !isYouTubeUrl(url)) {
    alert('لطفاً یک لینک یوتیوب معتبر وارد کنید');
    return;
  }
  
  const videoId = extractVideoId(url);
  if (!videoId) {
    alert('لینک یوتیوب معتبر نیست');
    return;
  }
  
  // Check subscription and quality limits
  try {
    const subscriptionInfo = await getSubscriptionInfo();
    if (!subscriptionInfo) {
      alert('خطا در دریافت اطلاعات اشتراک');
      return;
    }
    
    // Check if quality is allowed for this plan
    const highQualities = ['2160p', '1440p', '1080p', '720p'];
    if (highQualities.includes(quality) && subscriptionInfo.plan === 'free') {
      alert('این کیفیت فقط برای کاربران Pro در دسترس است. لطفاً پلن خود را ارتقا دهید.');
      window.open(`${API_BASE_URL}/dashboard.html?session=${currentSession}`, '_blank');
      return;
    }
    
    // Check download feature
    const canDownload = await checkSubscriptionLimit('downloadVideo', 0);
    if (!canDownload.allowed) {
      alert(canDownload.reason);
      return;
    }
  } catch (error) {
    console.error('Error checking subscription:', error);
    // Continue anyway if check fails
  }
  
  try {
    // Close dropdown
    videoQualityDropdown.style.display = 'none';
    downloadVideoBtn.classList.remove('active');
    
    // Show progress
    progressSection.style.display = 'block';
    updateProgress(0, 'در حال دانلود ویدئو...', '');
    
    // Disable button
    downloadVideoBtn.disabled = true;
    downloadVideoBtn.innerHTML = '<span>⏳ در حال دانلود...</span>';
    
    // Get video title for history
    let videoTitle = `ویدئو یوتیوب ${videoId}`;
    try {
      const titleResponse = await fetch(`${API_BASE_URL}/api/youtube-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, url })
      });
      if (titleResponse.ok) {
        const titleData = await titleResponse.json();
        if (titleData.title) {
          videoTitle = titleData.title;
        }
      }
    } catch (e) {
      console.warn('Could not get video title:', e);
    }
    
    updateProgress(10, 'در حال دانلود ویدئو...', 'در حال اتصال به سرور...');
    
    // Get download URL
    const response = await fetch(`${API_BASE_URL}/api/youtube-download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoId: videoId,
        url: url,
        type: 'video',
        quality: quality
      })
    });
    
    updateProgress(30, 'در حال دانلود ویدئو...', 'در حال دریافت فایل...');
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'دانلود ناموفق بود');
    }
    
    // Get content length for progress
    const contentLength = response.headers.get('content-length');
    
    if (!contentLength) {
      updateProgress(50, 'در حال دانلود ویدئو...', 'در حال دریافت فایل...');
    }
    
    // Get blob and download with progress
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      receivedLength += value.length;
      
      if (contentLength) {
        const percent = Math.min(90, 30 + (receivedLength / contentLength) * 60);
        updateProgress(percent, 'در حال دانلود ویدئو...', `دریافت شده: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`);
      }
    }
    
    updateProgress(95, 'در حال آماده‌سازی فایل...', '');
    
    // Combine chunks
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    
    const blob = new Blob([allChunks], { type: 'video/mp4' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `youtube_${videoId}_${quality}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    
    updateProgress(100, 'دانلود کامل شد!', '');
    
    // Record download
    try {
      await fetch(`${API_BASE_URL}/api/subscription?action=recordDownload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': currentSession
        },
        body: JSON.stringify({ type: 'video' })
      });
    } catch (e) {
      console.error('Error recording download:', e);
    }
    
    // Save to history
    saveToHistory(videoTitle, null, null, null, 'downloadVideo', { quality, videoId, url });
    
    // Hide progress after 1 second
    setTimeout(() => {
      progressSection.style.display = 'none';
    }, 1000);
    
    // Reset button
    downloadVideoBtn.disabled = false;
    downloadVideoBtn.innerHTML = '<span>🎬 دانلود ویدئو</span><span class="dropdown-arrow">▼</span>';
    
  } catch (error) {
    console.error('Download video error:', error);
    progressSection.style.display = 'none';
    alert(`خطا در دانلود: ${error.message}`);
    downloadVideoBtn.disabled = false;
    downloadVideoBtn.innerHTML = '<span>🎬 دانلود ویدئو</span><span class="dropdown-arrow">▼</span>';
  }
}

// Subscription helper functions
async function getSubscriptionInfo() {
  if (!currentSession) return null;
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=info&session=${currentSession}`, {
      headers: {
        'X-Session-Id': currentSession
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      // Update UI based on subscription
      updateUIForSubscription(data);
      return data;
    }
  } catch (error) {
    console.error('Error getting subscription info:', error);
  }
  return null;
}

// Update UI based on subscription plan
function updateUIForSubscription(subscriptionInfo) {
  if (!subscriptionInfo) return;
  
  const userPlan = subscriptionInfo.plan || 'free';
  const features = subscriptionInfo.features || {};
  
  // Find SRT tab button
  const srtTabBtn = document.querySelector('[data-tab="srt"]');
  if (srtTabBtn) {
    if (userPlan === 'free' || !features.srt) {
      // Disable SRT tab for free users
      srtTabBtn.style.opacity = '0.5';
      srtTabBtn.style.cursor = 'not-allowed';
      srtTabBtn.title = 'این ویژگی فقط برای کاربران Paid در دسترس است';
      srtTabBtn.disabled = true;
    } else {
      // Enable SRT tab for paid users
      srtTabBtn.style.opacity = '1';
      srtTabBtn.style.cursor = 'pointer';
      srtTabBtn.title = '';
      srtTabBtn.disabled = false;
    }
  }
}

async function checkSubscriptionLimit(feature, videoDurationMinutes = 0) {
  if (!currentSession) {
    return { allowed: false, reason: 'لطفاً ابتدا وارد حساب کاربری خود شوید' };
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/subscription?action=check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': currentSession
      },
      body: JSON.stringify({
        feature: feature,
        videoDurationMinutes: videoDurationMinutes
      })
    });
    
    if (response.ok) {
      return await response.json();
    } else {
      return { allowed: false, reason: 'خطا در بررسی محدودیت' };
    }
  } catch (error) {
    console.error('Error checking subscription limit:', error);
    return { allowed: false, reason: 'خطا در بررسی محدودیت' };
  }
}

async function recordUsage(minutes) {
  if (!currentSession || !minutes || minutes <= 0) return;
  
  try {
    await fetch(`${API_BASE_URL}/api/subscription?action=record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': currentSession
      },
      body: JSON.stringify({
        minutes: minutes
      })
    });
  } catch (error) {
    console.error('Error recording usage:', error);
  }
}

// Update video quality dropdown based on subscription
async function updateVideoQualityDropdown() {
  if (!currentSession) {
    // Lock all high qualities if not logged in
    document.querySelectorAll('#videoQualityDropdown .quality-option').forEach(option => {
      const quality = option.dataset.quality;
      const highQualities = ['2160p', '1440p', '1080p', '720p'];
      if (highQualities.includes(quality)) {
        option.classList.add('pro-locked');
      }
    });
    return;
  }
  
  try {
    const subscriptionInfo = await getSubscriptionInfo();
    if (subscriptionInfo) {
      document.querySelectorAll('#videoQualityDropdown .quality-option').forEach(option => {
        const quality = option.dataset.quality;
        const highQualities = ['2160p', '1440p', '1080p', '720p'];
        
        if (highQualities.includes(quality) && subscriptionInfo.plan === 'free') {
          option.classList.add('pro-locked');
        } else {
          option.classList.remove('pro-locked');
        }
      });
    }
  } catch (error) {
    console.error('Error updating video quality dropdown:', error);
  }
}

