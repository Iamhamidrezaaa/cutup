/**
 * Central headers (ES module).
 * - Marketing: homepage (+ product landings that import it).
 * - Simple: all other static pages that should match (about, privacy, contact, blog, …).
 */
const LOGO_MARKUP =
  '<a href="/" class="logo">' +
  '<img src="/logo.svg" alt="Cutup logo" class="logo-icon" width="32" height="32" decoding="async" />' +
  '<span>Cutup</span>' +
  '</a>';

const NAV_TOGGLE =
  '<button type="button" class="nav-menu-toggle" id="navMenuToggle" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">' +
  '<span></span><span></span><span></span>' +
  '</button>';

function homeAuthBlock() {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    !document.body.classList.contains('cutup-home')
  ) {
    return '';
  }
  return (
    '<div class="auth-section" id="authSection">' +
    '<div class="google-btn-wrapper">' +
    '<button type="button" class="login-btn google-btn" id="loginBtn">' +
    '<img class="google-icon" src="google-g.svg" width="18" height="18" alt="" decoding="async" />' +
    '<span class="google-btn-label">Continue with Google</span>' +
    '</button>' +
    '</div>' +
    '<div class="user-profile" id="userProfile" style="display: none;">' +
    '<div class="user-profile-trigger" id="userProfileTrigger">' +
    '<img src="" alt="Profile" class="user-avatar" id="userAvatar">' +
    '<span class="user-name" id="userName"></span>' +
    '<span class="dropdown-arrow">▼</span>' +
    '</div>' +
    '<div class="user-dropdown" id="userDropdown">' +
    '<a href="#" class="dropdown-item" id="dashboardLink">' +
    '<span class="dropdown-icon">⚙️</span><span>Dashboard</span>' +
    '</a>' +
    '<button class="dropdown-item" id="logoutBtn">' +
    '<span class="dropdown-icon">🚪</span><span>Log out</span>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

export function renderMarketingHeader() {
  return (
    '<header class="main-header">' +
    '<div class="container main-header-inner">' +
    LOGO_MARKUP +
    NAV_TOGGLE +
    '<nav id="navLinks" class="main-header-nav">' +
    '<a href="/login.html?redirect=home&amp;source=nav" class="nav-link nav-link--cta">Start Free</a>' +
    '<a href="/#how-it-works" class="nav-link">How it works</a>' +
    '<a href="/#styles" class="nav-link">Styles</a>' +
    '<a href="/#features" class="nav-link">Features</a>' +
    '<a href="/#pricing" class="nav-link">Pricing</a>' +
    '<a href="/#faq" class="nav-link">FAQ</a>' +
    '<a href="/blog.html" class="nav-link">Blog</a>' +
    homeAuthBlock() +
    '</nav>' +
    '</div>' +
    '</header>'
  );
}

export function renderSimpleHeader() {
  return (
    '<header class="simple-header">' +
    '<div class="container simple-header-inner">' +
    LOGO_MARKUP +
    NAV_TOGGLE +
    '<nav id="navLinks" class="simple-header-nav">' +
    '<a href="/" class="nav-link">Home</a>' +
    '<a href="/#tool" class="nav-link">Tool</a>' +
    '</nav>' +
    '</div>' +
    '</header>'
  );
}

export function initSiteHeaderNav(scope) {
  var root = scope && scope.querySelector ? scope : document;
  var toggle = root.querySelector('#navMenuToggle');
  var links = root.querySelector('#navLinks');
  if (!toggle || !links) return;

  var closeMenu = function () {
    links.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', function () {
    var next = !links.classList.contains('is-open');
    links.classList.toggle('is-open', next);
    toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
  });

  links.querySelectorAll('a, button').forEach(function (item) {
    item.addEventListener('click', function () {
      if (window.innerWidth < 640) closeMenu();
    });
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth >= 640) closeMenu();
  });
}
