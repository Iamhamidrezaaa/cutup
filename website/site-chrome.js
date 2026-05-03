/**
 * Global routing + footer (marketing shell). No API/analytics/payment changes.
 */
(function cutupRedirectFromIndexHtml() {
  try {
    var path = window.location.pathname || '';
    var lower = path.toLowerCase();
    var suf = 'index.html';
    if (!lower.endsWith(suf)) return;
    var base = path.slice(0, path.length - suf.length);
    if (base.endsWith('/')) base = base.slice(0, -1);
    window.location.replace(base || '/');
  } catch (_e) {
    /* ignore */
  }
})();

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

if (typeof window !== 'undefined') {
  window.renderFooter = renderFooter;
  window.ensureSiteFooter = ensureSiteFooter;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureSiteFooter();
      initCutupSiteNav();
    });
  } else {
    ensureSiteFooter();
    initCutupSiteNav();
  }
}
