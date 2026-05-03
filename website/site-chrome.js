/**
 * Global routing, single marketing header, footer. No API/analytics/payment logic.
 * Skip marketing shell on pages with <html data-cutup-skip-chrome-header>
 */
(function cutupHardBlockIndexHtmlPath() {
  try {
    var p = window.location.pathname || '';
    if (!p.toLowerCase().endsWith('/index.html')) return;
    var cleanPath = p.replace(/\/index\.html$/i, '/') || '/';
    if (cleanPath === '//') cleanPath = '/';
    window.location.replace(
      cleanPath + window.location.search + window.location.hash
    );
  } catch (_e) {
    /* ignore */
  }
})();

function renderHeader() {
  var isHome =
    typeof document !== 'undefined' &&
    document.body &&
    document.body.classList.contains('cutup-home');

  var menuToggle =
    '<button type="button" class="nav-menu-toggle" id="navMenuToggle" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">' +
    '<span></span><span></span><span></span>' +
    '</button>';

  var homeAuth = '';
  if (isHome) {
    homeAuth =
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
      '</div>';
  }

  return (
    '<header class="main-header">' +
    '<div class="container main-header-inner">' +
    '<a href="/" class="logo">Cutup</a>' +
    menuToggle +
    '<nav id="navLinks" class="main-header-nav">' +
    '<a href="/#tool">Generate subtitles</a>' +
    '<a href="/#features">Features</a>' +
    '<a href="/#pricing">Pricing</a>' +
    '<a href="/blog.html">Blog</a>' +
    '<a href="/#faq">FAQ</a>' +
    homeAuth +
    '</nav>' +
    '</div>' +
    '</header>'
  );
}

function renderFooter() {
  return (
    '<footer class="site-footer footer">' +
    '<div class="container">' +
    '<div class="footer-inner">' +
    '<div class="footer-brand"><a href="/">Cutup</a></div>' +
    '<nav class="footer-links" aria-label="Footer">' +
    '<a href="/#tool" class="footer-link">Subtitle generator</a>' +
    '<a href="/#tool" class="footer-link">Video to text</a>' +
    '<a href="/#tool" class="footer-link">Translate video</a>' +
    '<a href="/blog.html" class="footer-link">Blog</a>' +
    '<a href="/about.html" class="footer-link">About</a>' +
    '<a href="/privacy.html" class="footer-link">Privacy</a>' +
    '<a href="/contact.html" class="footer-link">Contact</a>' +
    '</nav>' +
    '<div class="footer-copy">© 2026 Cutup. All rights reserved.</div>' +
    '</div>' +
    '</div>' +
    '</footer>'
  );
}

function ensureSiteFooter() {
  try {
    if (document.querySelector('.site-footer')) return;
    document.body.insertAdjacentHTML('beforeend', renderFooter());
  } catch (_e) {
    /* ignore */
  }
}

function cutupShouldInjectMarketingShell() {
  return !document.documentElement.hasAttribute('data-cutup-skip-chrome-header');
}

function insertGlobalHeader() {
  if (document.querySelector('.main-header')) return;
  var html = renderHeader();
  var n = document.getElementById('cutupInlineNotify');
  if (n && n.parentNode === document.body) {
    n.insertAdjacentHTML('afterend', html);
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }
}

function normalizeAnchorsAwayFromIndexHtml() {
  document.querySelectorAll('a[href]').forEach(function (a) {
    var h = a.getAttribute('href');
    if (!h || h.indexOf('index.html') === -1) return;
    try {
      var abs = new URL(h, window.location.href);
      if (!/\/index\.html$/i.test(abs.pathname)) return;
      var base = abs.pathname.replace(/\/index\.html$/i, '');
      abs.pathname = base === '' ? '/' : base;
      a.setAttribute('href', abs.pathname + abs.search + abs.hash);
    } catch (_e) {
      a.setAttribute('href', h.split('index.html').join(''));
    }
  });
}

function initCutupSiteNav() {
  var toggle = document.getElementById('navMenuToggle');
  var links = document.getElementById('navLinks');
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

function initCutupShell() {
  if (cutupShouldInjectMarketingShell()) {
    insertGlobalHeader();
    ensureSiteFooter();
  }
  normalizeAnchorsAwayFromIndexHtml();
  initCutupSiteNav();
}

if (typeof window !== 'undefined') {
  window.renderHeader = renderHeader;
  window.renderFooter = renderFooter;
  window.ensureSiteFooter = ensureSiteFooter;
  window.normalizeAnchorsAwayFromIndexHtml = normalizeAnchorsAwayFromIndexHtml;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCutupShell);
  } else {
    initCutupShell();
  }
}
