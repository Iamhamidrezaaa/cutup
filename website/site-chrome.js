/**
 * Clean URL redirect only: visiting …/index.html → same path as / (no DOM link rewriting).
 * Fix link shapes in HTML + JS (e.g. blog.js sanitizeUrl), not here.
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

(function cutupPwaInstall() {
  function ensureManifestLink() {
    if (document.querySelector('link[rel="manifest"]')) return;
    try {
      var link = document.createElement('link');
      link.rel = 'manifest';
      link.href = '/manifest.json';
      document.head.appendChild(link);
    } catch (_e) {
      /* ignore */
    }
  }

  function isStandaloneDisplay() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        return true;
      }
    } catch (_e) {
      /* ignore */
    }
    return !!(window.navigator && window.navigator.standalone);
  }

  function isIOSDevice() {
    var ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return true;
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return true;
    }
    return false;
  }

  /** iOS: only Mobile Safari should see the A2HS onboarding. */
  function isIOSSafari() {
    if (!isIOSDevice()) return false;
    var ua = navigator.userAgent || '';
    if (/CriOS|FxiOS|EdgiOS|OPiOS|Brave/i.test(ua)) return false;
    return /Safari/i.test(ua);
  }

  function iconShare() {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 16V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M8 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function iconPlusSquare() {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function iconCheckCircle() {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M8 12.5l2.5 2.5L16 9.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'
    );
  }

  function showIOSInstallGuide() {
    if (document.querySelector('.cutup-ios-install-overlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'cutup-ios-install-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cutup-ios-install-title');

    var panel = document.createElement('div');
    panel.className = 'cutup-ios-install-panel';

    var top = document.createElement('div');
    top.className = 'cutup-ios-install-top';

    var logo = document.createElement('div');
    logo.className = 'cutup-ios-install-logo';
    logo.innerHTML = '<img src="/logo.svg" alt="" width="62" height="62"><p>Cutup</p>';

    var title = document.createElement('h2');
    title.id = 'cutup-ios-install-title';
    title.textContent = 'Install Cutup';

    var sub = document.createElement('p');
    sub.className = 'cutup-ios-install-sub';
    sub.textContent = 'Add Cutup to your Home Screen for a faster app-like experience.';

    top.appendChild(logo);
    top.appendChild(title);
    top.appendChild(sub);

    var modal = document.createElement('div');
    modal.className = 'cutup-ios-install-modal';

    var list = document.createElement('div');
    list.className = 'cutup-ios-install-steps';
    list.innerHTML =
      '<div class="cutup-ios-step">' +
      '<span class="cutup-ios-step-icon">' + iconShare() + '</span>' +
      '<p>Tap the Share button in Safari</p>' +
      '</div>' +
      '<div class="cutup-ios-step">' +
      '<span class="cutup-ios-step-icon">' + iconPlusSquare() + '</span>' +
      '<p>Select “Add to Home Screen”</p>' +
      '</div>' +
      '<div class="cutup-ios-step">' +
      '<span class="cutup-ios-step-icon">' + iconCheckCircle() + '</span>' +
      '<p>Tap “Add” to finish installation</p>' +
      '</div>';

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'cutup-ios-install-close';
    ok.textContent = 'Got it';

    function close() {
      overlay.remove();
    }

    ok.onclick = close;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    modal.appendChild(list);
    modal.appendChild(ok);
    panel.appendChild(top);
    panel.appendChild(modal);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  ensureManifestLink();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then(function (reg) {
        console.log('SW registered:', reg);
      })
      .catch(function (err) {
        console.error(err);
      });
  }

  fetch('/manifest.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      console.log(data);
    })
    .catch(function (err) {
      console.error('manifest.json:', err);
    });

  if (isStandaloneDisplay()) return;

  window.addEventListener('beforeinstallprompt', function (e) {
    console.log('PWA install available');
    e.preventDefault();
    window.deferredPrompt = e;
  });

  if (
    isIOSSafari() &&
    !isStandaloneDisplay() &&
    !localStorage.getItem('cutup_ios_install_hint_v2')
  ) {
    localStorage.setItem('cutup_ios_install_hint_v2', '1');
    function showIOS() {
      showIOSInstallGuide();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showIOS);
    } else {
      showIOS();
    }
  }
})();
