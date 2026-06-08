/**
 * Cutup dashboard — Help Center V2 (premium UX)
 */
(function () {
  'use strict';

  var state = {
    view: 'home',
    slug: null,
    category: '',
    categories: [],
    articles: [],
    popular: [],
    recent: [],
    current: null,
    related: [],
    searchQuery: '',
    searchResults: [],
    searchOpen: false,
    loading: false,
  };

  function apiBase() {
    return typeof API_BASE_URL !== 'undefined' ? String(API_BASE_URL).replace(/\/$/, '') : window.location.origin;
  }

  async function apiGet(path) {
    var r = await fetch(apiBase() + path, { credentials: 'include' });
    var d = await r.json().catch(function () { return {}; });
    return { ok: r.ok, data: d };
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_e) {
      return '—';
    }
  }

  function rootEl() {
    return document.getElementById('helpPageRoot');
  }

  function parseHelpHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (raw === 'help') return { section: 'help', slug: null };
    if (raw.indexOf('help/') === 0) {
      return { section: 'help', slug: decodeURIComponent(raw.slice('help/'.length)) };
    }
    return null;
  }

  function categoryBySlug(slug) {
    return state.categories.find(function (c) { return c.slug === slug; });
  }

  function contactSupport() {
    try {
      sessionStorage.setItem('cutup_open_support_modal', '1');
    } catch (_e) { /* noop */ }
    if (typeof navigateDashboardSection === 'function') {
      navigateDashboardSection('support');
    } else {
      window.location.hash = 'support';
    }
    setTimeout(function () {
      window.CutupDashboardSupport?.openCreateTicket?.();
    }, 250);
  }

  function navigateToHelp(slug) {
    window.location.hash = slug ? 'help/' + encodeURIComponent(slug) : 'help';
    state.slug = slug || null;
    void mount(slug || null);
  }

  function openCategory(catSlug) {
    state.category = catSlug;
    state.view = 'category';
    void mountCategory(catSlug);
  }

  function renderEmptyState(type) {
    var copy = {
      search: { title: 'No articles found', desc: 'Try different keywords or contact our team.' },
      category: { title: 'No articles in this category yet', desc: 'We are adding more guides soon.' },
      articles: { title: 'Help articles coming soon', desc: 'Check back shortly for new documentation.' },
    };
    var c = copy[type] || copy.search;
    return (
      '<div class="cutup-help-empty">' +
        '<div class="cutup-help-empty__illus" aria-hidden="true">' +
          '<svg width="96" height="80" viewBox="0 0 96 80" fill="none"><rect x="8" y="12" width="56" height="48" rx="10" fill="#EEF2FF"/><path d="M24 32h32M24 42h20" stroke="#818CF8" stroke-width="3" stroke-linecap="round"/><circle cx="72" cy="48" r="16" fill="#F1F5F9"/><path d="M68 48h8" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</div>' +
        '<h3>' + esc(c.title) + '</h3>' +
        '<p>' + esc(c.desc) + '</p>' +
        '<button type="button" class="btn-primary" data-contact-support>Contact Support</button>' +
      '</div>'
    );
  }

  function renderHeader() {
    return (
      '<header class="cutup-help-head">' +
        '<div class="cutup-help-head__copy">' +
          '<h1 class="section-title">Help Center</h1>' +
          '<p class="dashboard-section-lead">Guides, tutorials, FAQs and troubleshooting.</p>' +
        '</div>' +
        '<button type="button" class="btn-primary cutup-help-head__cta" data-contact-support>Contact Support</button>' +
      '</header>'
    );
  }

  function renderSearchWrap() {
    return (
      '<div class="cutup-help-search-wrap">' +
        '<div class="cutup-help-search" role="combobox" aria-expanded="' + (state.searchOpen ? 'true' : 'false') + '">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<input type="search" id="cutupHelpSearch" placeholder="Search guides, billing, exports…" value="' + esc(state.searchQuery) + '" autocomplete="off" aria-autocomplete="list" aria-controls="cutupHelpSearchDropdown">' +
        '</div>' +
        '<div class="cutup-help-search-dropdown" id="cutupHelpSearchDropdown" hidden role="listbox"></div>' +
      '</div>'
    );
  }

  function renderSearchDropdown() {
    if (!state.searchQuery || state.searchQuery.length < 1) return '';
    if (!state.searchResults.length) {
      return (
        '<div class="cutup-help-search-dropdown__empty">' + renderEmptyState('search') + '</div>' +
        '<button type="button" class="cutup-help-search-dropdown__support" data-contact-support>Can&apos;t find your answer? Contact Support</button>'
      );
    }
    return (
      state.searchResults.map(function (a) {
        return (
          '<button type="button" class="cutup-help-search-dropdown__item" role="option" data-slug="' + esc(a.slug) + '">' +
            '<strong>' + esc(a.title) + '</strong>' +
            '<span class="cutup-help-search-dropdown__cat">' + esc(a.category_title || a.category_slug) + '</span>' +
            '<span class="cutup-help-search-dropdown__desc">' + esc(a.summary) + '</span>' +
          '</button>'
        );
      }).join('') +
      '<button type="button" class="cutup-help-search-dropdown__support" data-contact-support>Can&apos;t find your answer? Contact Support</button>'
    );
  }

  function renderCategoryGrid() {
    var cats = state.categories.filter(function (c) { return c.slug !== 'api'; });
    if (!cats.length) return renderEmptyState('articles');
    return (
      '<div class="cutup-help-cats" role="list">' +
        cats.map(function (c) {
          return (
            '<button type="button" class="cutup-help-cat" data-cat="' + esc(c.slug) + '" role="listitem">' +
              '<span class="cutup-help-cat__icon" aria-hidden="true">' + esc(c.icon || '📄') + '</span>' +
              '<span class="cutup-help-cat__body">' +
                '<strong>' + esc(c.title) + '</strong>' +
                '<span>' + esc(c.description || '') + '</span>' +
                '<em>' + esc(c.article_count || 0) + ' articles</em>' +
              '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>'
    );
  }

  function renderArticleCard(a, compact) {
    return (
      '<button type="button" class="cutup-help-article' + (compact ? ' cutup-help-article--compact' : '') + '" data-slug="' + esc(a.slug) + '">' +
        '<span class="cutup-help-article__cat">' + esc(a.category_title || a.category_slug) + '</span>' +
        '<strong class="cutup-help-article__title">' + esc(a.title) + '</strong>' +
        '<p class="cutup-help-article__summary">' + esc(a.summary) + '</p>' +
        (!compact ? '<span class="cutup-help-article__meta">' + esc(a.reading_minutes || 3) + ' min read · Updated ' + esc(fmtDate(a.updated_at)) + '</span>' : '') +
      '</button>'
    );
  }

  function renderHome() {
    return (
      '<div class="cutup-help-root">' +
        renderHeader() +
        renderSearchWrap() +
        renderCategoryGrid() +
        '<div class="cutup-help-panels">' +
          '<section class="cutup-help-panel">' +
            '<h2>Popular articles</h2>' +
            '<div class="cutup-help-articles">' +
              (state.popular.length ? state.popular.map(function (a) { return renderArticleCard(a, true); }).join('') : '<p class="dashboard-muted">No popular articles yet.</p>') +
            '</div>' +
          '</section>' +
          '<section class="cutup-help-panel">' +
            '<h2>Recently updated</h2>' +
            '<div class="cutup-help-articles">' +
              (state.recent.length ? state.recent.map(function (a) { return renderArticleCard(a, true); }).join('') : '<p class="dashboard-muted">No updates yet.</p>') +
            '</div>' +
          '</section>' +
        '</div>' +
        '<button type="button" class="cutup-help-mobile-cta btn-primary" data-contact-support>Contact Support</button>' +
      '</div>'
    );
  }

  function renderListSection(title, items) {
    if (!items.length) return renderEmptyState('category');
    return '<div class="cutup-help-articles">' + items.map(function (a) { return renderArticleCard(a, false); }).join('') + '</div>';
  }

  function renderCategoryView() {
    var cat = categoryBySlug(state.category);
    return (
      '<div class="cutup-help-root">' +
        renderHeader() +
        renderSearchWrap() +
        '<button type="button" class="cutup-help-back" id="cutupHelpBackHome">← Help Center</button>' +
        '<h2 class="cutup-help-category-title">' + esc(cat?.title || 'Articles') + '</h2>' +
        '<p class="cutup-help-category-desc">' + esc(cat?.description || '') + '</p>' +
        renderListSection('Articles', state.articles) +
        '<button type="button" class="cutup-help-mobile-cta btn-primary" data-contact-support>Contact Support</button>' +
      '</div>'
    );
  }

  function renderBodySection(title, items, ordered) {
    if (!items?.length) return '';
    var inner = ordered
      ? '<ol class="cutup-help-steps">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
      : '<ul class="cutup-help-tips">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    return '<section class="cutup-help-section"><h2>' + esc(title) + '</h2>' + inner + '</section>';
  }

  function renderQaSection(title, items) {
    if (!items?.length) return '';
    return (
      '<section class="cutup-help-section cutup-help-section--qa">' +
        '<h2>' + esc(title) + '</h2>' +
        '<div class="cutup-help-qa">' +
          items.map(function (item) {
            return (
              '<details class="cutup-help-qa__item">' +
                '<summary>' + esc(item.q) + '</summary>' +
                '<p>' + esc(item.a) + '</p>' +
              '</details>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function renderArticle() {
    var a = state.current;
    if (!a) return renderEmptyState('search');
    var body = a.body || {};
    var cat = categoryBySlug(a.category_slug);
    var hero = a.hero_image || body.hero_image;
    return (
      '<div class="cutup-help-root cutup-help-root--article">' +
        '<button type="button" class="cutup-help-back" id="cutupHelpBackCat">← Back to ' + esc(cat?.title || a.category_title || 'Category') + '</button>' +
        '<article class="cutup-help-article-view">' +
          '<header class="cutup-help-article-hero">' +
            '<span class="cutup-help-article-view__cat">' + esc(a.category_title || '') + '</span>' +
            '<h1>' + esc(a.title) + '</h1>' +
            '<p class="cutup-help-article-view__summary">' + esc(a.summary) + '</p>' +
            '<div class="cutup-help-article-meta">' +
              '<span>' + esc(body.reading_minutes || a.reading_minutes || 3) + ' min read</span>' +
              '<span aria-hidden="true">·</span>' +
              '<span>Updated ' + esc(fmtDate(a.updated_at)) + '</span>' +
            '</div>' +
          '</header>' +
          (hero ? '<figure class="cutup-help-figure"><img src="' + esc(hero) + '" alt="" loading="lazy" decoding="async"></figure>' : '') +
          (body.content ? '<div class="cutup-help-article-view__intro">' + esc(body.content) + '</div>' : '') +
          renderBodySection('Step-by-step', body.steps, true) +
          renderBodySection('Helpful tips', body.tips, false) +
          renderQaSection('Troubleshooting', body.troubleshooting) +
          renderQaSection('FAQ', body.faq) +
          (state.related.length
            ? '<section class="cutup-help-section"><h2>Related articles</h2><div class="cutup-help-related">' +
                state.related.map(function (r) { return renderArticleCard(r, true); }).join('') +
              '</div></section>'
            : '') +
          '<section class="cutup-help-cta-card">' +
            '<h2>Need more help?</h2>' +
            '<p>Create a support ticket and our team will respond as soon as possible.</p>' +
            '<button type="button" class="btn-primary" data-contact-support>Contact Support</button>' +
          '</section>' +
        '</article>' +
        '<button type="button" class="cutup-help-mobile-cta btn-primary" data-contact-support>Contact Support</button>' +
      '</div>'
    );
  }

  function updateSearchDropdown() {
    var dd = document.getElementById('cutupHelpSearchDropdown');
    if (!dd) return;
    if (!state.searchOpen || !state.searchQuery) {
      dd.hidden = true;
      return;
    }
    dd.hidden = false;
    dd.innerHTML = renderSearchDropdown();
    bindContactButtons(dd);
    dd.querySelectorAll('[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.searchOpen = false;
        navigateToHelp(btn.getAttribute('data-slug'));
      });
    });
  }

  async function runSearch(q) {
    state.searchQuery = q;
    if (!q || q.length < 1) {
      state.searchResults = [];
      state.searchOpen = false;
      updateSearchDropdown();
      return;
    }
    var res = await apiGet('/api/help?action=search&q=' + encodeURIComponent(q) + '&limit=8');
    state.searchResults = res.ok ? res.data.articles || [] : [];
    state.searchOpen = true;
    updateSearchDropdown();
  }

  function bindContactButtons(scope) {
    (scope || document).querySelectorAll('[data-contact-support]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', contactSupport);
    });
  }

  function bindSearch(root) {
    var input = root.querySelector('#cutupHelpSearch');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    var timer;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { void runSearch(input.value.trim()); }, 160);
    });
    input.addEventListener('focus', function () {
      if (input.value.trim()) void runSearch(input.value.trim());
    });
    document.addEventListener('click', function (e) {
      if (!root.querySelector('.cutup-help-search-wrap')?.contains(e.target)) {
        state.searchOpen = false;
        updateSearchDropdown();
      }
    });
  }

  function bindEvents(root) {
    bindContactButtons(root);
    bindSearch(root);

    root.querySelector('#cutupHelpBackCat')?.addEventListener('click', function () {
      if (state.current?.category_slug) openCategory(state.current.category_slug);
    });
    root.querySelector('#cutupHelpBackHome')?.addEventListener('click', function () {
      navigateToHelp(null);
    });

    root.querySelectorAll('[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateToHelp(btn.getAttribute('data-slug'));
      });
    });

    root.querySelectorAll('[data-cat]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCategory(btn.getAttribute('data-cat'));
      });
    });
  }

  async function loadHomeData() {
    var results = await Promise.all([
      apiGet('/api/help?action=categories'),
      apiGet('/api/help?action=articles&popular=1&limit=6'),
      apiGet('/api/help?action=recent&limit=6'),
    ]);
    if (results[0].ok) state.categories = results[0].data.categories || [];
    if (results[1].ok) state.popular = results[1].data.articles || [];
    if (results[2].ok) state.recent = results[2].data.articles || [];
  }

  async function mountCategory(catSlug) {
    var root = rootEl();
    if (!root) return;
    root.innerHTML = '<p class="dashboard-muted">Loading articles…</p>';
    if (!state.categories.length) await loadHomeData();
    var res = await apiGet('/api/help?action=articles&category=' + encodeURIComponent(catSlug));
    state.category = catSlug;
    state.view = 'category';
    state.articles = res.ok ? res.data.articles || [] : [];
    root.innerHTML = renderCategoryView();
    bindEvents(root);
  }

  async function mount(slug) {
    var root = rootEl();
    if (!root) return;
    root.innerHTML = '<p class="dashboard-muted">Loading help center…</p>';

    if (slug) {
      state.view = 'article';
      state.slug = slug;
      if (!state.categories.length) await loadHomeData();
      var res = await apiGet('/api/help?action=article&slug=' + encodeURIComponent(slug));
      if (!res.ok) {
        root.innerHTML = renderEmptyState('search') + '<button type="button" class="cutup-help-back" id="cutupHelpHome">← Help Center</button>';
        root.querySelector('#cutupHelpHome')?.addEventListener('click', function () { navigateToHelp(null); });
        bindContactButtons(root);
        return;
      }
      state.current = res.data.article;
      state.related = res.data.related || [];
      state.category = state.current.category_slug;
      root.innerHTML = renderArticle();
      bindEvents(root);
      return;
    }

    state.view = 'home';
    state.slug = null;
    state.current = null;
    state.category = '';
    await loadHomeData();
    root.innerHTML = renderHome();
    bindEvents(root);
  }

  window.CutupDashboardHelp = {
    parseHelpHash: parseHelpHash,
    mount: mount,
    navigateToHelp: navigateToHelp,
    contactSupport: contactSupport,
    searchArticles: async function (q, limit) {
      var res = await apiGet('/api/help?action=search&q=' + encodeURIComponent(q) + '&limit=' + (limit || 5));
      return res.ok ? res.data.articles || [] : [];
    },
  };

  window.addEventListener('hashchange', function () {
    var route = parseHelpHash(window.location.hash);
    if (!route) return;
    var active = document.getElementById('help-section')?.classList.contains('active');
    if (active) void mount(route.slug);
  });
})();
