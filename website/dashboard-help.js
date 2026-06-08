/**
 * Cutup dashboard — Help Center V3 (final polish)
 */
(function () {
  'use strict';

  var RECENT_KEY = 'cutup_help_recent_searches';
  var MAX_RECENT = 5;

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
    searchFocusIndex: -1,
    loading: false,
  };

  var ICON_MSG =
    '<svg class="cutup-help-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 15a4 4 0 01-4 4H7l-4 4V7a4 4 0 014-4h10a4 4 0 014 4v8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '</svg>';

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

  function btnPrimary(label, attrs) {
    attrs = attrs || '';
    var icon = /data-no-icon/.test(attrs) ? '' : ICON_MSG;
    return '<button type="button" class="cutup-help-btn cutup-help-btn--primary" ' + attrs + '>' + icon + '<span>' + esc(label) + '</span></button>';
  }

  function btnSecondary(label, attrs) {
    attrs = attrs || '';
    return '<button type="button" class="cutup-help-btn cutup-help-btn--secondary" ' + attrs + '><span>' + esc(label) + '</span></button>';
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

  function browseHelpHome() {
    goHome();
  }

  function goHome() {
    state.view = 'home';
    state.slug = null;
    state.category = '';
    state.current = null;
    state.related = [];
    state.searchQuery = '';
    state.searchResults = [];
    state.searchOpen = false;
    state.searchFocusIndex = -1;
    if (window.location.hash !== '#help') {
      window.location.hash = 'help';
    }
    void mount(null);
  }

  function navigateToHelp(slug) {
    window.location.hash = slug ? 'help/' + encodeURIComponent(slug) : 'help';
    state.slug = slug || null;
    if (!slug) goHome();
    else void mount(slug);
  }

  function openCategory(catSlug) {
    state.category = catSlug;
    state.view = 'category';
    void mountCategory(catSlug);
  }

  function readRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_e) {
      return [];
    }
  }

  function pushRecent(q) {
    if (!q || q.length < 2) return;
    var list = readRecent().filter(function (x) { return x !== q; });
    list.unshift(q);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    } catch (_e) { /* noop */ }
  }

  function highlightMatch(text, query) {
    if (!query) return esc(text);
    var raw = String(text || '');
    var q = query.trim();
    if (!q) return esc(raw);
    var lower = raw.toLowerCase();
    var qi = lower.indexOf(q.toLowerCase());
    if (qi < 0) return esc(raw);
    return (
      esc(raw.slice(0, qi)) +
      '<mark class="cutup-help-mark">' +
      esc(raw.slice(qi, qi + q.length)) +
      '</mark>' +
      esc(raw.slice(qi + q.length))
    );
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
        btnPrimary('Contact Support', 'data-contact-support') +
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
        btnPrimary('Contact Support', 'data-contact-support id="cutupHelpHeadCta"') +
      '</header>'
    );
  }

  function renderSearchWrap() {
    return (
      '<div class="cutup-help-search-wrap">' +
        '<div class="cutup-help-search" role="combobox" aria-expanded="' + (state.searchOpen ? 'true' : 'false') + '" aria-haspopup="listbox">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<input type="search" id="cutupHelpSearch" placeholder="Search guides, billing, exports…" value="' + esc(state.searchQuery) + '" autocomplete="off" aria-autocomplete="list" aria-controls="cutupHelpSearchDropdown">' +
        '</div>' +
        '<div class="cutup-help-search-dropdown" id="cutupHelpSearchDropdown" hidden role="listbox"></div>' +
      '</div>'
    );
  }

  function catIcon(cat) {
    return esc(cat?.category_icon || cat?.icon || categoryBySlug(cat?.category_slug || cat)?.icon || '📄');
  }

  function renderRecentSearches() {
    var recent = readRecent();
    if (!recent.length) {
      return '<div class="cutup-help-search-dropdown__hint">Start typing to search articles…</div>';
    }
    return (
      '<div class="cutup-help-search-dropdown__section-label">Recent searches</div>' +
      recent.map(function (q, i) {
        var active = i === state.searchFocusIndex ? ' is-focused' : '';
        return '<button type="button" class="cutup-help-search-dropdown__recent' + active + '" role="option" data-recent="' + esc(q) + '" data-idx="' + i + '">' + esc(q) + '</button>';
      }).join('')
    );
  }

  function renderSearchDropdown() {
    var q = state.searchQuery;
    if (!state.searchOpen) return '';

    if (!q) {
      return renderRecentSearches();
    }

    if (!state.searchResults.length) {
      return (
        '<div class="cutup-help-search-dropdown__empty">' +
          '<p class="cutup-help-search-dropdown__empty-title">No articles found</p>' +
          '<p class="cutup-help-search-dropdown__empty-desc">Try different keywords or browse categories below.</p>' +
        '</div>' +
        '<button type="button" class="cutup-help-search-dropdown__support cutup-help-btn cutup-help-btn--secondary" data-contact-support data-no-icon>Can&apos;t find your answer? Contact Support</button>'
      );
    }

    return (
      state.searchResults
        .map(function (a, i) {
          var active = i === state.searchFocusIndex ? ' is-focused' : '';
          return (
            '<button type="button" class="cutup-help-search-dropdown__item' + active + '" role="option" data-slug="' + esc(a.slug) + '" data-idx="' + i + '">' +
              '<span class="cutup-help-search-dropdown__icon" aria-hidden="true">' + catIcon(a) + '</span>' +
              '<span class="cutup-help-search-dropdown__body">' +
                '<strong>' + highlightMatch(a.title, q) + '</strong>' +
                '<span class="cutup-help-search-dropdown__cat">' + esc(a.category_title || a.category_slug) + '</span>' +
                '<span class="cutup-help-search-dropdown__desc">' + highlightMatch(a.summary, q) + '</span>' +
              '</span>' +
            '</button>'
          );
        })
        .join('') +
      '<button type="button" class="cutup-help-search-dropdown__support cutup-help-btn cutup-help-btn--secondary" data-contact-support data-no-icon>Can&apos;t find your answer? Contact Support</button>'
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
    var popular = a.is_popular ? '<span class="cutup-help-badge cutup-help-badge--popular">Popular</span>' : '';
    return (
      '<button type="button" class="cutup-help-article' + (compact ? ' cutup-help-article--compact' : '') + '" data-slug="' + esc(a.slug) + '">' +
        '<span class="cutup-help-article__row">' +
          '<span class="cutup-help-article__cat">' + esc(a.category_title || a.category_slug) + '</span>' +
          popular +
        '</span>' +
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
        btnPrimary('Contact Support', 'data-contact-support class="cutup-help-mobile-cta"') +
      '</div>'
    );
  }

  function featuredArticle(articles) {
    if (!articles.length) return null;
    var popular = articles.find(function (a) { return a.is_popular; });
    return popular || articles[0];
  }

  function renderCategoryHero(cat, articles) {
    var feat = featuredArticle(articles);
    return (
      '<section class="cutup-help-category-hero">' +
        '<div class="cutup-help-category-hero__icon" aria-hidden="true">' + esc(cat?.icon || '📄') + '</div>' +
        '<div class="cutup-help-category-hero__body">' +
          '<h2 class="cutup-help-category-title">' + esc(cat?.title || 'Articles') + '</h2>' +
          '<p class="cutup-help-category-desc">' + esc(cat?.description || '') + '</p>' +
          '<span class="cutup-help-category-count">' + esc(articles.length) + ' articles</span>' +
        '</div>' +
        (feat
          ? '<div class="cutup-help-featured">' +
              '<span class="cutup-help-featured__label">Featured guide</span>' +
              renderArticleCard(feat, false) +
            '</div>'
          : '') +
      '</section>'
    );
  }

  function renderCategoryView() {
    var cat = categoryBySlug(state.category);
    var rest = state.articles.filter(function (a) {
      var f = featuredArticle(state.articles);
      return !f || a.slug !== f.slug;
    });
    return (
      '<div class="cutup-help-root">' +
        renderHeader() +
        renderSearchWrap() +
        btnSecondary('← Help Center', 'id="cutupHelpBackHome" data-no-icon') +
        renderCategoryHero(cat, state.articles) +
        (rest.length
          ? '<section class="cutup-help-category-list"><h3 class="cutup-help-section-label">All articles</h3>' +
              '<div class="cutup-help-articles">' + rest.map(function (a) { return renderArticleCard(a, false); }).join('') + '</div></section>'
          : renderEmptyState('category')) +
        btnPrimary('Contact Support', 'data-contact-support class="cutup-help-mobile-cta"') +
      '</div>'
    );
  }

  function renderBodySection(title, items, ordered) {
    if (!items?.length) return '';
    var inner = ordered
      ? '<ol class="cutup-help-steps">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
      : '<ul class="cutup-help-tips">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    return '<section class="cutup-help-section"><h2>' + esc(title) + '</h2><div class="cutup-help-prose">' + inner + '</div></section>';
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

  function renderNeedHelpCard() {
    return (
      '<section class="cutup-help-cta-card">' +
        '<div class="cutup-help-cta-card__copy">' +
          '<h2>Need more help?</h2>' +
          '<p>Our support team can help with billing, exports, transcripts, translations and account issues.</p>' +
        '</div>' +
        '<div class="cutup-help-cta-card__actions">' +
          btnPrimary('Contact Support', 'data-contact-support') +
          btnSecondary('Browse Help Center', 'data-browse-help') +
        '</div>' +
      '</section>'
    );
  }

  function renderArticle() {
    var a = state.current;
    if (!a) return renderEmptyState('search');
    var body = a.body || {};
    var cat = categoryBySlug(a.category_slug);
    var hero = a.hero_image || body.hero_image || '/help-illustrations/articles/' + a.slug + '.svg';
    var overview = body.overview || body.content;
    return (
      '<div class="cutup-help-root cutup-help-root--article">' +
        btnSecondary('← Back to ' + (cat?.title || a.category_title || 'Category'), 'id="cutupHelpBackCat" data-no-icon') +
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
          '<figure class="cutup-help-figure"><img src="' + esc(hero) + '" alt="' + esc(a.title) + ' illustration" loading="lazy" decoding="async"></figure>' +
          (overview ? '<section class="cutup-help-section cutup-help-section--overview"><h2>Overview</h2><div class="cutup-help-prose"><p>' + esc(overview) + '</p></div></section>' : '') +
          renderBodySection('Step-by-step guide', body.steps, true) +
          renderBodySection('Best practices', body.tips, false) +
          renderQaSection('Troubleshooting', body.troubleshooting) +
          renderQaSection('FAQ', body.faq) +
          (state.related.length
            ? '<section class="cutup-help-section cutup-help-section--related"><h2>Related articles</h2><div class="cutup-help-related">' +
                state.related.map(function (r) { return renderArticleCard(r, true); }).join('') +
              '</div></section>'
            : '') +
          renderNeedHelpCard() +
        '</article>' +
        btnPrimary('Contact Support', 'data-contact-support class="cutup-help-mobile-cta"') +
      '</div>'
    );
  }

  function scrollSearchFocus() {
    var dd = document.getElementById('cutupHelpSearchDropdown');
    if (!dd) return;
    var el = dd.querySelector('.is-focused');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function updateSearchDropdown() {
    var dd = document.getElementById('cutupHelpSearchDropdown');
    if (!dd) return;
    if (!state.searchOpen) {
      dd.hidden = true;
      return;
    }
    dd.hidden = false;
    dd.innerHTML = renderSearchDropdown();
    bindContactButtons(dd);
    bindBrowseHelpButtons(dd);

    dd.querySelectorAll('[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pushRecent(state.searchQuery);
        state.searchOpen = false;
        navigateToHelp(btn.getAttribute('data-slug'));
      });
    });
    dd.querySelectorAll('[data-recent]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById('cutupHelpSearch');
        var q = btn.getAttribute('data-recent') || '';
        if (input) input.value = q;
        void runSearch(q);
      });
    });
  }

  async function runSearch(q) {
    state.searchQuery = q;
    state.searchFocusIndex = -1;
    if (!q) {
      state.searchResults = [];
      state.searchOpen = true;
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

  function bindBrowseHelpButtons(scope) {
    (scope || document).querySelectorAll('[data-browse-help]').forEach(function (btn) {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', browseHelpHome);
    });
  }

  function bindSearch(root) {
    var input = root.querySelector('#cutupHelpSearch');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    var timer;

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { void runSearch(input.value.trim()); }, 140);
    });

    input.addEventListener('focus', function () {
      state.searchOpen = true;
      if (input.value.trim()) void runSearch(input.value.trim());
      else updateSearchDropdown();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        state.searchOpen = false;
        state.searchFocusIndex = -1;
        updateSearchDropdown();
        input.blur();
        return;
      }

      var q = state.searchQuery.trim();
      var recent = !q ? readRecent() : [];
      var items = q ? state.searchResults : [];
      var count = items.length || recent.length;
      if (!count) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.searchFocusIndex = Math.min(state.searchFocusIndex + 1, count - 1);
        updateSearchDropdown();
        scrollSearchFocus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.searchFocusIndex = Math.max(state.searchFocusIndex - 1, 0);
        updateSearchDropdown();
        scrollSearchFocus();
      } else if (e.key === 'Enter' && state.searchFocusIndex >= 0) {
        e.preventDefault();
        if (q && items[state.searchFocusIndex]) {
          pushRecent(state.searchQuery);
          state.searchOpen = false;
          navigateToHelp(items[state.searchFocusIndex].slug);
        } else if (!q && recent[state.searchFocusIndex]) {
          input.value = recent[state.searchFocusIndex];
          void runSearch(recent[state.searchFocusIndex]);
        }
      }
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
    bindBrowseHelpButtons(root);
    bindSearch(root);

    root.querySelector('#cutupHelpBackCat')?.addEventListener('click', function () {
      if (state.current?.category_slug) openCategory(state.current.category_slug);
    });
    root.querySelector('#cutupHelpBackHome')?.addEventListener('click', goHome);

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
        root.innerHTML = renderEmptyState('search') + btnSecondary('← Help Center', 'id="cutupHelpHome" data-no-icon');
        root.querySelector('#cutupHelpHome')?.addEventListener('click', goHome);
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
    goHome: goHome,
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
    if (!active) return;
    if (!route.slug) goHome();
    else void mount(route.slug);
  });
})();
