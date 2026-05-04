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

  function showInstallButton() {
    if (document.querySelector('.install-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerText = 'Install App';
    btn.className = 'install-btn';
    btn.setAttribute('aria-label', 'Install Cutup app');

    btn.onclick = async function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (_e) {
        /* ignore */
      }
      deferredPrompt = null;
      btn.remove();
    };

    document.body.appendChild(btn);
  }

  function showIOSInstallGuide() {
    if (document.querySelector('.cutup-ios-install-overlay')) return;

    var overlay = document.createElement('div');
    overlay.className = 'cutup-ios-install-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cutup-ios-install-title');

    var modal = document.createElement('div');
    modal.className = 'cutup-ios-install-modal';

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'cutup-ios-install-dismiss';
    dismiss.innerHTML = '&times;';
    dismiss.setAttribute('aria-label', 'Close');

    var title = document.createElement('h2');
    title.id = 'cutup-ios-install-title';
    title.textContent = 'Install Cutup';

    var list = document.createElement('ol');
    var steps = [
      'Tap the Share icon',
      'Tap "Add to Home Screen"',
      'Tap "Add"'
    ];
    steps.forEach(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'cutup-ios-install-close';
    ok.textContent = 'Got it';

    function close() {
      overlay.remove();
    }

    dismiss.onclick = close;
    ok.onclick = close;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    modal.appendChild(dismiss);
    modal.appendChild(title);
    modal.appendChild(list);
    modal.appendChild(ok);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  var deferredPrompt = null;

  ensureManifestLink();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  if (isStandaloneDisplay()) return;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  if (
    isIOSDevice() &&
    !window.navigator.standalone &&
    !sessionStorage.getItem('cutup_ios_install_hint')
  ) {
    sessionStorage.setItem('cutup_ios_install_hint', '1');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showIOSInstallGuide);
    } else {
      showIOSInstallGuide();
    }
  }
})();
