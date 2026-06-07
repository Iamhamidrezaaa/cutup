(function () {
  'use strict';

  function initFaqAccordion() {
    const root = document.getElementById('faqAccordion');
    if (!root) return;
    const items = Array.from(root.querySelectorAll('.faq-item'));
    items.forEach((item) => {
      const btn = item.querySelector('[data-faq-btn]');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const opening = !item.classList.contains('active');
        items.forEach((i) => {
          i.classList.remove('active');
          const b = i.querySelector('[data-faq-btn]');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (opening) {
          item.classList.add('active');
          btn.setAttribute('aria-expanded', 'true');
        }
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
    initFaqAccordion();
    injectFaqSchema();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
