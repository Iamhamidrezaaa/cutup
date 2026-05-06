/**
 * Global back-to-top control — initialized from site-chrome.js on public pages.
 */
(function cutupBackToTop() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (document.documentElement.dataset.cutupBackToTop === 'off') return;
  if (document.querySelector('.cutup-back-to-top')) return;

  function ensureStyles() {
    if (document.querySelector('link[data-cutup-back-to-top]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/back-to-top.css?v=1';
    link.setAttribute('data-cutup-back-to-top', '1');
    document.head.appendChild(link);
  }

  function mount() {
    ensureStyles();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cutup-back-to-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.setAttribute('aria-hidden', 'true');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 5v14M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';

    document.body.appendChild(btn);

    var visible = false;
    var scrollThreshold = 12;

    function setVisible(show) {
      if (show === visible) return;
      visible = show;
      btn.classList.toggle('is-visible', show);
      btn.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    function onScroll() {
      setVisible((window.scrollY || document.documentElement.scrollTop || 0) > scrollThreshold);
    }

    btn.addEventListener('click', function () {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (_e) {
        window.scrollTo(0, 0);
      }
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
