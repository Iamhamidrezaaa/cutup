(function () {
  const toc = document.getElementById('baToc');
  const article = document.getElementById('baArticle');
  if (!toc || !article) return;

  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const headings = links
    .map((a) => {
      const id = (a.getAttribute('href') || '').slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  const setActive = (id) => {
    links.forEach((a) => {
      const target = (a.getAttribute('href') || '').slice(1);
      a.classList.toggle('is-active', Boolean(id) && target === id);
    });
  };

  const offset = 120;
  let rafPending = false;
  const onScroll = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      let currentId = headings[0]?.id || '';
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= offset) currentId = h.id;
      }
      setActive(currentId);
    });
  };

  toc.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = decodeURIComponent((link.getAttribute('href') || '').slice(1));
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}());
