/**
 * CutUp landing page — hero mockup, style showcase, FAQ schema, CTAs.
 */
(function () {
  'use strict';

  const HERO_PRESETS = ['hormozi', 'mrbeast', 'podcast', 'luxury-minimal'];
  const SHOWCASE_PRESETS = [
    'hormozi',
    'mrbeast',
    'luxury-minimal',
    'podcast',
    'tiktok-neon',
    'ali-abdaal'
  ];

  const DEMO_SEGMENTS = [
    { start: 0, end: 2.4, text: 'Most creators lose viewers in the first three seconds' },
    { start: 2.4, end: 4.8, text: 'THIS hook changes everything' }
  ];

  const SHOWCASE_LABELS = {
    'ali-abdaal': 'Clean'
  };

  let heroStyleIndex = 0;
  let heroPipeIndex = 0;
  let heroTimers = [];

  function getSessionId() {
    try {
      return localStorage.getItem('cutup_session') || null;
    } catch {
      return null;
    }
  }

  function presetLabel(p) {
    return SHOWCASE_LABELS[p.id] || p.name;
  }

  function canRender() {
    return Boolean(window.CutupStylePresets && window.CutupStyleRenderer);
  }

  function renderStage(stageEl, presetId) {
    if (!stageEl || !canRender()) return;
    window.CutupStyleRenderer.render(stageEl, DEMO_SEGMENTS, presetId);
  }

  function wireHeroCtas() {
    const sessionId = getSessionId();
    document.querySelectorAll('[data-lp-start-free]').forEach((el) => {
      if (sessionId) {
        el.setAttribute('href', '/#tool');
        if (el.id === 'lpHeroStartFree') el.textContent = 'Open editor';
      }
    });
  }

  function setActivePills(container, presetId, selector) {
    if (!container) return;
    container.querySelectorAll(selector).forEach((btn) => {
      const on = btn.getAttribute('data-preset-id') === presetId;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function initHeroMockup() {
    const pills = document.getElementById('lpHeroStylePills');
    const stage = document.getElementById('lpHeroPreview');
    const pipe = document.getElementById('lpHeroPipeline');
    if (!pills || !stage || !canRender()) return;

    const presets = HERO_PRESETS.map((id) => window.CutupStylePresets.getPreset(id)).filter(Boolean);
    if (!presets.length) return;

    pills.innerHTML = presets
      .map(
        (p, i) =>
          `<button type="button" class="lp-hero__pill${i === 0 ? ' is-active' : ''}" data-preset-id="${p.id}" aria-pressed="${i === 0}">${presetLabel(p)}</button>`
      )
      .join('');

    function applyHeroStyle(id) {
      renderStage(stage, id);
      setActivePills(pills, id, '.lp-hero__pill');
    }

    pills.querySelectorAll('.lp-hero__pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        heroStyleIndex = presets.findIndex((p) => p.id === btn.getAttribute('data-preset-id'));
        applyHeroStyle(btn.getAttribute('data-preset-id'));
      });
    });

    applyHeroStyle(presets[0].id);

    if (pipe) {
      const steps = pipe.querySelectorAll('.lp-hero__pipe-step');
      heroTimers.push(
        setInterval(() => {
          heroPipeIndex = (heroPipeIndex + 1) % steps.length;
          steps.forEach((s, i) => s.classList.toggle('is-active', i === heroPipeIndex));
        }, 2800)
      );
    }

    heroTimers.push(
      setInterval(() => {
        heroStyleIndex = (heroStyleIndex + 1) % presets.length;
        applyHeroStyle(presets[heroStyleIndex].id);
      }, 4500)
    );
  }

  function initStyleShowcase() {
    const tabs = document.getElementById('landingStyleTabs');
    const stage = document.getElementById('landingStylePreview');
    if (!tabs || !stage || !canRender()) return;

    const presets = SHOWCASE_PRESETS.map((id) => window.CutupStylePresets.getPreset(id)).filter(Boolean);
    if (!presets.length) return;

    let activeId = presets[0].id;

    function render(id) {
      activeId = id;
      setActivePills(tabs, id, '.lp-style-tab');
      renderStage(stage, id);
    }

    tabs.innerHTML = presets
      .map(
        (p) =>
          `<button type="button" class="lp-style-tab${p.id === activeId ? ' is-active' : ''}" data-preset-id="${p.id}" aria-pressed="${p.id === activeId}">${presetLabel(p)}</button>`
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
    wireHeroCtas();
    injectFaqSchema();
    initHeroMockup();
    initStyleShowcase();
  }

  function tryInitWhenReady() {
    if (canRender()) {
      init();
      return;
    }
    let attempts = 0;
    const t = setInterval(() => {
      attempts += 1;
      if (canRender() || attempts > 40) {
        clearInterval(t);
        if (canRender()) init();
      }
    }, 100);
    heroTimers.push(t);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInitWhenReady);
  } else {
    tryInitWhenReady();
  }

  window.addEventListener('cutup:auth-changed', wireHeroCtas);
  window.addEventListener('beforeunload', () => heroTimers.forEach((id) => clearInterval(id)));
})();
