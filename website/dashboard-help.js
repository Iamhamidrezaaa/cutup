/**
 * Cutup dashboard — Help Center / Knowledge Base
 */
(function () {
  'use strict';

  var state = {
    view: 'home',
    slug: null,
    categories: [],
    articles: [],
    popular: [],
    recent: [],
    current: null,
    search: '',
    category: '',
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

  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    var sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 3600) return Math.max(1, Math.floor(sec / 60)) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
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

  function navigateToHelp(slug) {
    window.location.hash = slug ? 'help/' + encodeURIComponent(slug) : 'help';
    state.view = slug ? 'article' : 'home';
    state.slug = slug || null;
    void mount(slug || null);
  }

  function renderSearchBar() {
    return (
      '<div class="cutup-help-search">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<input type="search" id="cutupHelpSearch" placeholder="Search help articles…" value="' + esc(state.search) + '" autocomplete="off">' +
      '</div>'
    );
  }

  function renderCategoryGrid() {
    if (!state.categories.length) return '';
    return (
      '<div class="cutup-help-cats" role="list">' +
        state.categories.map(function (c) {
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
        (!compact ? '<span class="cutup-help-article__meta">Updated ' + esc(relTime(a.updated_at)) + '</span>' : '') +
      '</button>'
    );
  }

  function renderHome() {
    return (
      '<div class="cutup-help-root">' +
        '<header class="cutup-help-head">' +
          '<div><h1 class="section-title">Help Center</h1><p class="dashboard-section-lead">Guides, FAQs, and best practices for Cutup.</p></div>' +
          '<a href="#support" class="btn-secondary cutup-help-support-link">Contact Support</a>' +
        '</header>' +
        renderSearchBar() +
        renderCategoryGrid() +
        '<div class="cutup-help-panels">' +
          '<section class="cutup-help-panel">' +
            '<h2>Popular articles</h2>' +
            '<div class="cutup-help-articles">' +
              (state.popular.length ? state.popular.map(function (a) { return renderArticleCard(a, true); }).join('') : '<p class="dashboard-muted">No articles yet.</p>') +
            '</div>' +
          '</section>' +
          '<section class="cutup-help-panel">' +
            '<h2>Recently updated</h2>' +
            '<div class="cutup-help-articles">' +
              (state.recent.length ? state.recent.map(function (a) { return renderArticleCard(a, true); }).join('') : '<p class="dashboard-muted">No updates yet.</p>') +
            '</div>' +
          '</section>' +
        '</div>' +
        (state.articles.length && state.search
          ? '<section class="cutup-help-panel"><h2>Search results</h2><div class="cutup-help-articles">' +
              state.articles.map(function (a) { return renderArticleCard(a, false); }).join('') +
            '</div></section>'
          : '') +
      '</div>'
    );
  }

  function renderArticle() {
    var a = state.current;
    if (!a) return '<p class="dashboard-empty-note">Article not found.</p>';
    return (
      '<div class="cutup-help-root cutup-help-root--article">' +
        '<button type="button" class="cutup-help-back" id="cutupHelpBack">← Help Center</button>' +
        '<article class="cutup-help-article-view">' +
          '<span class="cutup-help-article-view__cat">' + esc(a.category_title || '') + '</span>' +
          '<h1>' + esc(a.title) + '</h1>' +
          '<p class="cutup-help-article-view__summary">' + esc(a.summary) + '</p>' +
          '<div class="cutup-help-article-view__body">' + esc(a.body).replace(/\n/g, '<br>') + '</div>' +
          '<footer class="cutup-help-article-view__foot">' +
            '<span>Updated ' + esc(relTime(a.updated_at)) + '</span>' +
            '<a href="#support" class="btn-primary">Still need help?</a>' +
          '</footer>' +
        '</article>' +
      '</div>'
    );
  }

  function bindEvents(root) {
    root.querySelector('#cutupHelpBack')?.addEventListener('click', function () { navigateToHelp(null); });
    root.querySelectorAll('[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigateToHelp(btn.getAttribute('data-slug'));
      });
    });
    root.querySelectorAll('[data-cat]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        state.category = btn.getAttribute('data-cat');
        var res = await apiGet('/api/help?action=articles&category=' + encodeURIComponent(state.category));
        if (res.ok) {
          state.articles = res.data.articles || [];
          state.search = '';
          root.innerHTML = renderCategoryView();
          bindEvents(root);
        }
      });
    });
    var search = root.querySelector('#cutupHelpSearch');
    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      var timer;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(async function () {
          state.search = search.value.trim();
          if (state.search.length < 2) {
            state.articles = [];
            if (state.view === 'home') {
              root.innerHTML = renderHome();
              bindEvents(root);
            }
            return;
          }
          var res = await apiGet('/api/help?action=search&q=' + encodeURIComponent(state.search));
          if (res.ok) {
            state.articles = res.data.articles || [];
            root.innerHTML = renderHome();
            bindEvents(root);
          }
        }, 280);
      });
    }
  }

  function renderCategoryView() {
    var cat = state.categories.find(function (c) { return c.slug === state.category; });
    return (
      '<div class="cutup-help-root">' +
        '<button type="button" class="cutup-help-back" id="cutupHelpBack">← Help Center</button>' +
        '<h1 class="section-title">' + esc(cat?.title || 'Articles') + '</h1>' +
        '<div class="cutup-help-articles">' + state.articles.map(function (a) { return renderArticleCard(a, false); }).join('') + '</div>' +
      '</div>'
    );
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

  async function mount(slug) {
    var root = rootEl();
    if (!root) return;
    root.innerHTML = '<p class="dashboard-muted">Loading help center…</p>';

    if (slug) {
      state.view = 'article';
      state.slug = slug;
      var res = await apiGet('/api/help?action=article&slug=' + encodeURIComponent(slug));
      if (!res.ok) {
        root.innerHTML = '<p class="dashboard-empty-note">Article not found.</p><button type="button" class="btn-secondary" id="cutupHelpBack">← Help Center</button>';
        root.querySelector('#cutupHelpBack')?.addEventListener('click', function () { navigateToHelp(null); });
        return;
      }
      state.current = res.data.article;
      root.innerHTML = renderArticle();
      bindEvents(root);
      return;
    }

    state.view = 'home';
    state.slug = null;
    state.current = null;
    await loadHomeData();
    root.innerHTML = renderHome();
    bindEvents(root);
  }

  window.CutupDashboardHelp = {
    parseHelpHash: parseHelpHash,
    mount: mount,
    navigateToHelp: navigateToHelp,
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
