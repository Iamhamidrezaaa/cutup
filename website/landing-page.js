/**
 * CutUp landing polish — FAQ schema + hero CTAs (no redesign widgets).
 */
(function () {
  'use strict';

  function getSessionId() {
    try {
      return localStorage.getItem('cutup_session') || null;
    } catch {
      return null;
    }
  }

  function scrollToTool() {
    document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function triggerGoogleLogin() {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.click();
      return;
    }
    const apiBase = window.CUTUP_API_BASE || '';
    try {
      const response = await fetch(`${apiBase}/api/oauth/google/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      if (data?.authUrl) window.location.href = data.authUrl;
    } catch (_err) {
      /* script.js login handler surfaces errors when available */
    }
  }

  function wireStartFree(el, sessionId) {
    const loggedIn = Boolean(sessionId);
    el.textContent = loggedIn ? 'Open editor' : 'Start Free';

    if (loggedIn) {
      el.onclick = function (e) {
        e.preventDefault();
        scrollToTool();
      };
      return;
    }

    el.onclick = async function (e) {
      e.preventDefault();
      await triggerGoogleLogin();
    };
  }

  function wireLandingCtas() {
    const sessionId = getSessionId();

    document.querySelectorAll('[data-lp-start-free]').forEach((el) => {
      wireStartFree(el, sessionId);
    });

    document.querySelectorAll('[data-lp-try-cutup]').forEach((el) => {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        scrollToTool();
      });
    });
  }

  function injectFaqSchema() {
    const root = document.getElementById('faqAccordion');
    if (!root) return;

    const mainEntity = Array.from(root.querySelectorAll('.faq-item'))
      .map((item) => {
        const q = item.querySelector('.faq-question');
        const a = item.querySelector('.faq-answer p');
        if (!q || !a) return null;
        return {
          '@type': 'Question',
          name: q.textContent.trim(),
          acceptedAnswer: { '@type': 'Answer', text: a.textContent.trim() }
        };
      })
      .filter(Boolean);

    if (!mainEntity.length) return;

    let el = document.getElementById('cutupFaqJsonLd');
    if (!el) {
      el = document.createElement('script');
      el.id = 'cutupFaqJsonLd';
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity
    });
  }

  function init() {
    wireLandingCtas();
    injectFaqSchema();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('cutup:auth-changed', wireLandingCtas);
})();
