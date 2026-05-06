(function () {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaqAccordion);
  } else {
    initFaqAccordion();
  }
})();
