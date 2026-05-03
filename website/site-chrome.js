/**
 * Routing + link hygiene only. Headers/footers: site-header.js + site-footer.js (modules).
 * Skip extra work on <html data-cutup-skip-chrome-header>
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

function cutupChromeShouldRun() {
  return !document.documentElement.hasAttribute('data-cutup-skip-chrome-header');
}

function normalizeAnchorsAwayFromIndexHtml() {
  document.querySelectorAll('a[href]').forEach(function (a) {
    var raw = a.getAttribute('href');
    if (!raw) return;
    var t = String(raw).trim();
    if (
      !t ||
      t.charAt(0) === '#' ||
      /^mailto:/i.test(t) ||
      /^tel:/i.test(t) ||
      /^javascript:/i.test(t)
    ) {
      return;
    }
    try {
      var abs = new URL(t, window.location.href);
      if (abs.origin !== window.location.origin) return;
      var path = abs.pathname || '';
      if (!/\/index\.html$/i.test(path)) return;
      var noIndex = path.replace(/\/index\.html$/i, '');
      abs.pathname = noIndex === '' ? '/' : noIndex;
      a.setAttribute('href', abs.pathname + abs.search + abs.hash);
    } catch (_e) {
      if (t.indexOf('index.html') !== -1) {
        a.setAttribute('href', t.replace(/index\.html/gi, ''));
      }
    }
  });
}

function hardStripIndexHtmlFromResolvedHrefs() {
  document.querySelectorAll('a').forEach(function (a) {
    try {
      var h = a.href;
      if (!h || h.indexOf('index.html') === -1) return;
      a.href = h.replace(/\/index\.html/gi, '/');
    } catch (_e) {
      /* ignore */
    }
  });
}

function initCutupChrome() {
  if (!cutupChromeShouldRun()) return;
  normalizeAnchorsAwayFromIndexHtml();
  hardStripIndexHtmlFromResolvedHrefs();
  setTimeout(function () {
    normalizeAnchorsAwayFromIndexHtml();
    hardStripIndexHtmlFromResolvedHrefs();
  }, 0);
  setTimeout(function () {
    normalizeAnchorsAwayFromIndexHtml();
    hardStripIndexHtmlFromResolvedHrefs();
  }, 250);
}

if (typeof window !== 'undefined') {
  window.normalizeAnchorsAwayFromIndexHtml = normalizeAnchorsAwayFromIndexHtml;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCutupChrome);
  } else {
    initCutupChrome();
  }
}
