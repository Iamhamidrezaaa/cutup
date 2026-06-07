/**
 * CutUp landing polish — FAQ schema + pricing table hydration.
 */
(function () {
  'use strict';

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
    if (!document.querySelector('#cutupPricingMatrixMount .pricing-compare') && window.CutupPricingMatrix) {
      window.CutupPricingMatrix.mount('#cutupPricingMatrixMount', { context: 'landing' });
    }
    injectFaqSchema();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
