/**
 * CutUp landing page — style showcase, FAQ schema, hero CTA helpers.
 */
(function () {
  'use strict';

  const SHOWCASE_PRESETS = ['hormozi', 'mrbeast', 'luxury-minimal', 'podcast', 'tiktok-neon'];

  const DEMO_SEGMENTS = [
    { start: 0, end: 2.2, text: 'Most creators lose viewers in the first three seconds' },
    { start: 2.2, end: 4.4, text: 'THIS hook changes everything' }
  ];

  function getSessionId() {
    try {
      return localStorage.getItem('cutup_session') || null;
    } catch {
      return null;
    }
  }

  function wireHeroCtas() {
    const sessionId = getSessionId();
    const startLinks = document.querySelectorAll('[data-lp-start-free]');
    startLinks.forEach((el) => {
      if (sessionId) {
        el.setAttribute('href', '/#tool');
        if (el.id === 'lpHeroStartFree') el.textContent = 'Open editor';
      }
    });
  }

  function initStyleShowcase() {
    const tabs = document.getElementById('landingStyleTabs');
    const stage = document.getElementById('landingStylePreview');
    if (!tabs || !stage || !window.CutupStylePresets || !window.CutupStyleRenderer) return;

    const presets = SHOWCASE_PRESETS.map((id) => window.CutupStylePresets.getPreset(id)).filter(Boolean);
    if (!presets.length) return;

    let activeId = presets[0].id;

    function render(id) {
      activeId = id;
      tabs.querySelectorAll('.lp-style-tab').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-preset-id') === id);
        btn.setAttribute('aria-pressed', btn.getAttribute('data-preset-id') === id ? 'true' : 'false');
      });
      window.CutupStyleRenderer.render(stage, DEMO_SEGMENTS, id);
    }

    tabs.innerHTML = presets
      .map(
        (p) =>
          `<button type="button" class="lp-style-tab${p.id === activeId ? ' is-active' : ''}" data-preset-id="${p.id}" aria-pressed="${p.id === activeId}">${p.name}</button>`
      )
      .join('');

    tabs.querySelectorAll('.lp-style-tab').forEach((btn) => {
      btn.addEventListener('click', () => render(btn.getAttribute('data-preset-id')));
    });

    render(activeId);
  }

  function injectFaqSchema() {
    const root = document.getElementById('faqAccordion');
    if (!root) return;

    const items = Array.from(root.querySelectorAll('.faq-item'));
    const mainEntity = items
      .map((item) => {
        const q = item.querySelector('.faq-question');
        const a = item.querySelector('.faq-answer p');
        if (!q || !a) return null;
        return {
          '@type': 'Question',
          name: q.textContent.trim(),
          acceptedAnswer: {
            '@type': 'Answer',
            text: a.textContent.trim()
          }
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
    wireHeroCtas();
    injectFaqSchema();
    initStyleShowcase();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('cutup:auth-changed', wireHeroCtas);
})();
