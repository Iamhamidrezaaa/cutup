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

