/**
 * Saved Outputs V2 — content library UI for dashboard.
 */
(function () {
  'use strict';

  var FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'mp4', label: 'MP4' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'translation', label: 'Translation' },
    { id: 'summary', label: 'Summary' },
    { id: 'txt', label: 'TXT' },
    { id: 'docx', label: 'DOCX' },
    { id: 'favorites', label: 'Favorites' }
  ];

  var SORTS = [
    { id: 'newest', label: 'Newest' },
    { id: 'oldest', label: 'Oldest' },
    { id: 'downloads', label: 'Most Downloaded' },
    { id: 'alpha', label: 'Alphabetical' }
  ];

  var state = {
    items: [],
    recent: [],
    stats: {},
    audit: null,
    collections: [],
    filter: 'all',
    sort: 'newest',
    search: '',
    collectionId: null,
    openId: null,
    loading: false,
    loaded: false,
    loadError: null
  };

  function dbHasContent() {
    var a = state.audit || {};
    var db = (Number(a.dbSavedOutputsCount) || 0) + (Number(a.dbMp4Count) || 0);
    if (db > 0) return true;
    var st = state.stats || {};
    return (Number(st.dbTotal) || Number(st.total) || 0) > 0;
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatRelative(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    if (diff < 86400000) return 'Today';
    if (diff < 172800000) return 'Yesterday';
    return formatDate(iso);
  }

  function fallbackTitle(item) {
    if (item.title) return item.title;
    if (item.sourceUrl) {
      try {
        var u = new URL(item.sourceUrl);
        return u.hostname.replace('www.', '') + ' video';
      } catch (_e) {
        return 'Untitled output';
      }
    }
    return 'Untitled output';
  }

  function statusLabel(status) {
    var s = String(status || 'ready').toLowerCase();
    if (s === 'ready' || s === 'completed') return 'Ready';
    if (s === 'expired') return 'Expired';
    if (s === 'failed') return 'Failed';
    if (s === 'processing' || s === 'rendering' || s === 'queued') return 'Processing';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function statusClass(status) {
    var s = String(status || 'ready').toLowerCase();
    if (s === 'ready' || s === 'completed') return 'sol-tag--status-ready';
    if (s === 'expired' || s === 'failed') return 'sol-tag--status-expired';
    return '';
  }

  function previewZone(item, ctx) {
    if (item.type === 'mp4' && item.mp4 && item.mp4.downloadReady && item.mp4.renderJobId) {
      var previewUrl =
        ctx.apiBase +
        '/api/export-video?action=preview&jobId=' +
        encodeURIComponent(item.mp4.renderJobId) +
        '&session=' +
        encodeURIComponent(ctx.session || '');
      return (
        '<div class="sol-card__preview-zone">' +
          '<video class="sol-card__video" controls preload="metadata" playsinline ' +
            'src="' + esc(previewUrl) + '" ' +
            'data-mp4-preview="' + esc(item.mp4.renderJobId) + '">' +
            'Your browser does not support video preview.' +
          '</video>' +
        '</div>'
      );
    }
    if (item.type === 'mp4') {
      return (
        '<div class="sol-card__preview-zone">' +
          '<div class="sol-card__video-placeholder">MP4 preview unavailable</div>' +
        '</div>'
      );
    }
    var text = item.preview || item.content || '';
    return (
      '<div class="sol-card__preview-zone sol-card__preview-zone--text">' +
        '<p class="sol-card__preview-text">' + esc(text || 'No preview available.') + '</p>' +
      '</div>'
    );
  }

  function renderCard(item, ctx) {
    var title = fallbackTitle(item);
    var isOpen = state.openId === item.id;
    var favClass = item.isFavorite ? ' is-on' : '';
    var styleLine = item.styleUsed ? esc(item.styleUsed) : 'Default';
    var collLine = item.collectionName ? esc(item.collectionName) : 'Uncategorized';
    var dl = Number(item.downloadCount) || 0;

    var detail = '';
    if (isOpen) {
      var exportRows = (item.exportHistory || [])
        .map(function (e) {
          return formatDate(e.date) + ' · ' + esc(e.preset || e.quality || 'Export') + ' · ' + esc(e.status || '');
        })
        .join('<br>');
      detail =
        '<div class="sol-detail">' +
          '<div><strong>Source:</strong> ' + (item.sourceUrl ? '<a href="' + esc(item.sourceUrl) + '" target="_blank" rel="noopener">' + esc(item.sourceUrl) + '</a>' : '—') + '</div>' +
          (item.type === 'mp4' && item.mp4
            ? '<div><strong>Resolution:</strong> ' + esc(item.mp4.resolution || '—') + ' · <strong>Size:</strong> ' + (item.mp4.fileSizeBytes ? Math.round(item.mp4.fileSizeBytes / 1048576) + ' MB' : '—') + '</div>'
            : '') +
          (exportRows ? '<div><strong>Export history</strong><br>' + exportRows + '</div>' : '') +
          (item.content && item.type !== 'mp4' ? '<pre>' + esc(item.content) + '</pre>' : '') +
        '</div>';
    }

    return (
      '<article class="sol-card' + (isOpen ? ' is-open' : '') + '" data-sol-id="' + esc(item.id) + '">' +
        previewZone(item, ctx) +
        '<div class="sol-card__body">' +
          '<div class="sol-card__head">' +
            '<h3 class="sol-card__title">' + esc(title) + '</h3>' +
            (item.kind === 'output'
              ? '<button type="button" class="sol-card__fav' + favClass + '" data-sol-fav="' + esc(item.id) + '" title="Favorite">' + (item.isFavorite ? '★' : '☆') + '</button>'
              : '') +
          '</div>' +
          '<div class="sol-card__tags">' +
            '<span class="sol-tag sol-tag--type">' + esc(item.displayType) + '</span>' +
            '<span class="sol-tag ' + statusClass(item.status) + '">' + esc(statusLabel(item.status)) + '</span>' +
            (item.language ? '<span class="sol-tag">' + esc(item.language) + '</span>' : '') +
          '</div>' +
          '<div class="sol-card__meta">' +
            '<span>' + esc(formatRelative(item.createdAt)) + '</span>' +
            '<span>Style: ' + styleLine + '</span>' +
          '</div>' +
          '<div class="sol-card__activity">' +
            '<span>Created ' + esc(formatDate(item.createdAt)) + '</span>' +
            '<span>' + dl + ' download' + (dl === 1 ? '' : 's') + ' · ' + collLine + '</span>' +
          '</div>' +
          '<div class="sol-card__actions">' +
            '<button type="button" class="sol-btn sol-btn--primary" data-sol-open="' + esc(item.id) + '">Open</button>' +
            '<button type="button" class="sol-btn" data-sol-download="' + esc(item.id) + '" data-sol-kind="' + esc(item.kind) + '">Download</button>' +
            (item.kind === 'output' ? '<button type="button" class="sol-btn" data-sol-duplicate="' + esc(item.id) + '">Duplicate</button>' : '') +
            '<button type="button" class="sol-btn sol-btn--danger" data-sol-delete="' + esc(item.id) + '" data-sol-kind="' + esc(item.kind) + '">Delete</button>' +
            (item.kind === 'output' ? '<button type="button" class="sol-btn" data-sol-collection="' + esc(item.id) + '">Move</button>' : '') +
          '</div>' +
          detail +
        '</div>' +
      '</article>'
    );
  }

  function renderStats(stats) {
    var s = stats || {};
    return (
      '<div class="sol-stats">' +
        '<article class="sol-stat sol-stat--accent"><span class="sol-stat__value">' + esc(s.dbTotal != null ? s.dbTotal : s.total || 0) + '</span><span class="sol-stat__label">Total Outputs</span></article>' +
        '<article class="sol-stat"><span class="sol-stat__value">' + esc(s.transcripts || 0) + '</span><span class="sol-stat__label">Transcripts</span></article>' +
        '<article class="sol-stat"><span class="sol-stat__value">' + esc(s.translations || 0) + '</span><span class="sol-stat__label">Translations</span></article>' +
        '<article class="sol-stat"><span class="sol-stat__value">' + esc(s.mp4 || 0) + '</span><span class="sol-stat__label">MP4 Exports</span></article>' +
      '</div>'
    );
  }

  function renderRecentStrip(recent, ctx) {
    var list = Array.isArray(recent) ? recent.slice(0, 8) : [];
    if (!list.length) return '';
    var rows = list.map(function (item) {
      var title = fallbackTitle(item);
      return (
        '<button type="button" class="sol-recent-item" data-sol-recent="' + esc(item.id) + '">' +
          '<span class="sol-recent-item__type">' + esc(item.displayType) + '</span>' +
          '<span class="sol-recent-item__title">' + esc(title) + '</span>' +
          '<span class="sol-recent-item__date">' + esc(formatRelative(item.createdAt)) + '</span>' +
        '</button>'
      );
    }).join('');
    return (
      '<section class="sol-recent">' +
        '<div class="sol-recent__head">' +
          '<h2 class="sol-recent__title">Recent content</h2>' +
          '<button type="button" class="sol-btn" id="solOpenAllBtn">View all</button>' +
        '</div>' +
        '<div class="sol-recent__list">' + rows + '</div>' +
      '</section>'
    );
  }

  function renderCollections() {
    var allActive = !state.collectionId ? ' is-active' : '';
    var rows = (state.collections || [])
      .map(function (c) {
        var active = state.collectionId === c.id ? ' is-active' : '';
        return (
          '<li><button type="button" class="sol-collection-btn' + active + '" data-sol-coll="' + esc(c.id) + '">' +
            esc(c.name) + ' <span style="opacity:0.6">(' + (c.outputCount || 0) + ')</span>' +
          '</button></li>'
        );
      })
      .join('');
    return (
      '<aside class="sol-collections">' +
        '<h3 class="sol-collections__title">Collections</h3>' +
        '<ul class="sol-collection-list">' +
          '<li><button type="button" class="sol-collection-btn' + allActive + '" data-sol-coll="">All outputs</button></li>' +
          rows +
        '</ul>' +
        '<button type="button" class="sol-collection-add" id="solAddCollectionBtn">+ New collection</button>' +
      '</aside>'
    );
  }

  function renderEmpty(ctx, filtered) {
    if (filtered) {
      return '<div class="sol-empty-filter">No outputs match your search or filters. Try adjusting them.</div>';
    }
    return (
      '<div class="sol-empty">' +
        '<div class="sol-empty__icon" aria-hidden="true">📚</div>' +
        '<h3>Your content library is empty</h3>' +
        '<p>Transcripts, translations, summaries, and MP4 exports will appear here automatically after you process videos.</p>' +
        '<button type="button" class="plan-btn" id="solEmptyCtaBtn">Create your first output</button>' +
      '</div>'
    );
  }

  function render(ctx) {
    var target = ctx.target;
    if (!target) return;

    if (state.loading) {
      target.innerHTML = '<div class="sol-root"><p class="dashboard-muted-loading">Loading your library…</p></div>';
      return;
    }

    var filterBtns = FILTERS.map(function (f) {
      var active = state.filter === f.id ? ' is-active' : '';
      return '<button type="button" class="sol-filter-btn' + active + '" data-sol-filter="' + f.id + '">' + esc(f.label) + '</button>';
    }).join('');

    var sortOpts = SORTS.map(function (s) {
      var sel = state.sort === s.id ? ' selected' : '';
      return '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.label) + '</option>';
    }).join('');

    var cards = (state.items || []).map(function (it) { return renderCard(it, ctx); }).join('');
    var hasDbContent = dbHasContent();
    var gridContent = cards || renderEmpty(ctx, hasDbContent);

    if (state.loadError && hasDbContent) {
      gridContent =
        '<div class="sol-empty-filter">Could not load library items. Database has ' +
        esc((Number(state.audit?.dbSavedOutputsCount) || 0) + (Number(state.audit?.dbMp4Count) || 0)) +
        ' outputs. <button type="button" class="sol-btn" id="solRetryLoadBtn">Retry</button></div>';
    }

    target.innerHTML =
      '<div class="sol-root">' +
        renderStats(state.stats) +
        renderRecentStrip(state.recent, ctx) +
        '<div class="sol-toolbar">' +
          '<div class="sol-search-wrap">' +
            '<span class="sol-search-icon" aria-hidden="true">🔍</span>' +
            '<input type="search" class="sol-search" id="solSearchInput" placeholder="Search titles, transcripts, translations, URLs…" value="' + esc(state.search) + '">' +
          '</div>' +
          '<div class="sol-controls">' +
            '<div class="sol-filters">' + filterBtns + '</div>' +
            '<select class="sol-select" id="solSortSelect" aria-label="Sort outputs">' + sortOpts + '</select>' +
            '<select class="sol-select sol-collections--mobile" id="solCollMobile" aria-label="Collection">' +
              '<option value="">All outputs</option>' +
              (state.collections || []).map(function (c) {
                var sel = state.collectionId === c.id ? ' selected' : '';
                return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.name) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="sol-layout">' +
          renderCollections() +
          '<div class="sol-grid" id="solGrid">' + gridContent + '</div>' +
        '</div>' +
      '</div>';

    bindEvents(ctx);
  }

  async function reloadLegacy(ctx) {
    var r = await ctx.apiGet(
      ctx.apiBase + '/api/subscription?action=savedOutputs&session=' + encodeURIComponent(ctx.session) + '&limit=500',
      { headers: { 'X-Session-Id': ctx.session } }
    );
    if (!r.response.ok) return false;
    var outputs = r.data?.outputs || [];
    state.items = outputs.map(function (o) {
      return {
        id: String(o.id),
        kind: 'output',
        type: o.type === 'srt' ? 'translation' : o.type,
        displayType: o.type,
        title: o.title,
        language: o.language,
        sourceUrl: o.sourceUrl,
        content: o.content || '',
        preview: String(o.content || '').slice(0, 1200),
        isFavorite: Boolean(o.isFavorite),
        status: 'ready',
        styleUsed: null,
        downloadCount: 0,
        createdAt: o.createdAt,
        metadata: o.metadata || {},
        mp4: null
      };
    });
    state.recent = state.items.slice(0, 8);
    state.stats = {
      total: state.items.length,
      dbTotal: state.items.length,
      dbSavedOutputs: state.items.length,
      mp4: 0,
      transcripts: state.items.filter(function (i) { return i.type === 'transcript'; }).length,
      translations: state.items.filter(function (i) { return i.type === 'translation' || i.type === 'srt'; }).length,
      summaries: state.items.filter(function (i) { return i.type === 'summary'; }).length
    };
    state.audit = {
      dbSavedOutputsCount: state.items.length,
      dbMp4Count: 0,
      finalReturned: state.items.length,
      fallback: 'savedOutputs_legacy'
    };
    return true;
  }

  async function reload(ctx) {
    if (!ctx.session || !ctx.apiBase) return;
    state.loading = true;
    state.loadError = null;
    render(ctx);
    try {
      var qp = new URLSearchParams({
        action: 'savedOutputsLibrary',
        session: ctx.session,
        filter: state.filter,
        sort: state.sort,
        limit: '500'
      });
      if (state.search) qp.set('search', state.search);
      if (state.collectionId) qp.set('collectionId', state.collectionId);
      var r = await ctx.apiGet(ctx.apiBase + '/api/subscription?' + qp.toString(), {
        headers: { 'X-Session-Id': ctx.session }
      });
      if (r.response.ok && r.data) {
        state.items = r.data.items || [];
        state.recent = r.data.recent || state.items.slice(0, 8);
        state.stats = r.data.stats || {};
        state.collections = r.data.collections || [];
        state.audit = r.data.audit || null;
        state.loaded = true;
        if (state.audit?.error && !state.items.length) {
          state.loadError = state.audit.error;
        }
        console.log('[content-library] audit', state.audit);
        console.log('[content-library] stats', state.stats, 'items', state.items.length);
      } else {
        state.loadError = r.data?.error || 'api_error_' + r.response.status;
        console.warn('[content-library] API failed', state.loadError, r.data);
        var ok = await reloadLegacy(ctx);
        if (!ok) ctx.showBanner?.('Could not load your library right now.', 'error');
        else state.loaded = true;
      }
    } catch (err) {
      state.loadError = err?.message || 'network_error';
      console.error('[content-library] load failed', state.loadError);
      var legacyOk = await reloadLegacy(ctx);
      if (!legacyOk) ctx.showBanner?.('Could not load your library right now.', 'error');
      else state.loaded = true;
    } finally {
      state.loading = false;
      render(ctx);
      if (typeof ctx.onLoaded === 'function') ctx.onLoaded(state);
    }
  }

  function findItem(id) {
    return (state.items || []).find(function (it) { return String(it.id) === String(id); });
  }

  async function recordDownload(ctx, item) {
    try {
      await ctx.apiPost(
        ctx.apiBase + '/api/subscription?action=recordSavedOutputDownload',
        { id: item.id, kind: item.kind },
        { headers: { 'X-Session-Id': ctx.session } }
      );
      item.downloadCount = (Number(item.downloadCount) || 0) + 1;
    } catch (_e) { /* noop */ }
  }

  function downloadItem(ctx, item, formatOverride) {
    var title = (fallbackTitle(item) || 'output').replace(/\s+/g, '_');
    var asDocx = formatOverride === 'docx' || state.filter === 'docx';

    if (item.type === 'mp4' && item.mp4 && item.mp4.renderJobId) {
      var url =
        ctx.apiBase +
        '/api/export-video?action=download&jobId=' +
        encodeURIComponent(item.mp4.renderJobId) +
        '&session=' +
        encodeURIComponent(ctx.session || '');
      window.open(url, '_blank', 'noopener');
      void recordDownload(ctx, item);
      return;
    }

    var ext = item.type === 'srt' || item.type === 'translation' || item.type === 'subtitle' ? 'srt' : 'txt';
    if (asDocx && item.kind === 'output') {
      fetch(ctx.apiBase + '/api/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': ctx.session },
        body: JSON.stringify({ content: item.content || '', filename: title })
      })
        .then(function (res) {
          if (!res.ok) throw new Error('docx');
          return res.blob();
        })
        .then(function (blob) {
          var u = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = u;
          a.download = title + '.docx';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(u);
          void recordDownload(ctx, item);
        })
        .catch(function () {
          ctx.showBanner?.('Could not generate DOCX.', 'error');
        });
      return;
    }

    var blob = new Blob([item.content || ''], { type: 'text/plain;charset=utf-8' });
    var objUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = objUrl;
    a.download = title + '.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
    void recordDownload(ctx, item);
  }

  function bindEvents(ctx) {
    var root = ctx.target;
    if (!root) return;

    root.querySelector('#solEmptyCtaBtn')?.addEventListener('click', function () {
      ctx.openTool?.('');
    });

    root.querySelector('#solRetryLoadBtn')?.addEventListener('click', function () {
      void reload(ctx);
    });

    root.querySelector('#solOpenAllBtn')?.addEventListener('click', function () {
      var grid = root.querySelector('#solGrid');
      if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    root.querySelectorAll('[data-sol-recent]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-sol-recent');
        state.openId = id;
        render(ctx);
        var card = root.querySelector('[data-sol-id="' + id + '"]');
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    var searchInput = root.querySelector('#solSearchInput');
    var searchTimer;
    searchInput?.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var val = searchInput.value;
      searchTimer = setTimeout(function () {
        state.search = val;
        void reload(ctx);
      }, 320);
    });

    root.querySelector('#solSortSelect')?.addEventListener('change', function (e) {
      state.sort = e.target.value || 'newest';
      void reload(ctx);
    });

    root.querySelector('#solCollMobile')?.addEventListener('change', function (e) {
      state.collectionId = e.target.value || null;
      void reload(ctx);
    });

    root.querySelectorAll('[data-sol-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.filter = btn.getAttribute('data-sol-filter') || 'all';
        void reload(ctx);
      });
    });

    root.querySelectorAll('[data-sol-coll]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-sol-coll') || '';
        state.collectionId = id || null;
        void reload(ctx);
      });
    });

    root.querySelector('#solAddCollectionBtn')?.addEventListener('click', async function () {
      var name = window.prompt('Collection name');
      if (!name || !String(name).trim()) return;
      try {
        var res = await ctx.apiPost(
          ctx.apiBase + '/api/subscription?action=createSavedOutputCollection',
          { name: String(name).trim() },
          { headers: { 'X-Session-Id': ctx.session } }
        );
        if (!res.response.ok) throw new Error('fail');
        ctx.showBanner?.('Collection created.', 'success');
        void reload(ctx);
      } catch (_e) {
        ctx.showBanner?.('Could not create collection.', 'error');
      }
    });

    root.querySelectorAll('[data-sol-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-sol-open');
        state.openId = state.openId === id ? null : id;
        render(ctx);
      });
    });

    root.querySelectorAll('[data-sol-download]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-sol-download');
        var item = findItem(id);
        if (!item) return;
        downloadItem(ctx, item);
      });
    });

    root.querySelectorAll('[data-sol-duplicate]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-sol-duplicate');
        try {
          var res = await ctx.apiPost(
            ctx.apiBase + '/api/subscription?action=duplicateSavedOutput',
            { id: id },
            { headers: { 'X-Session-Id': ctx.session } }
          );
          if (!res.response.ok) throw new Error('fail');
          ctx.showBanner?.('Duplicate created.', 'success');
          void reload(ctx);
        } catch (_e) {
          ctx.showBanner?.('Could not duplicate output.', 'error');
        }
      });
    });

    root.querySelectorAll('[data-sol-delete]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-sol-delete');
        var kind = btn.getAttribute('data-sol-kind') || 'output';
        var item = findItem(id);
        var title = item ? fallbackTitle(item) : 'this output';
        if (!window.confirm('Delete "' + title + '" from your library?')) return;
        try {
          var res = await ctx.apiPost(
            ctx.apiBase + '/api/subscription?action=deleteSavedOutput',
            { id: id, kind: kind },
            { headers: { 'X-Session-Id': ctx.session } }
          );
          if (!res.response.ok) throw new Error('fail');
          ctx.showBanner?.('Removed from library.', 'success');
          if (state.openId === id) state.openId = null;
          void reload(ctx);
        } catch (_e) {
          ctx.showBanner?.('Could not delete output.', 'error');
        }
      });
    });

    root.querySelectorAll('[data-sol-fav]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-sol-fav');
        var item = findItem(id);
        if (!item) return;
        var favorite = !item.isFavorite;
        try {
          var res = await ctx.apiPost(
            ctx.apiBase + '/api/subscription?action=toggleSavedOutputFavorite',
            { id: id, favorite: favorite },
            { headers: { 'X-Session-Id': ctx.session } }
          );
          if (!res.response.ok) throw new Error('fail');
          item.isFavorite = favorite;
          ctx.showBanner?.(favorite ? 'Added to favorites.' : 'Removed from favorites.', 'success');
          render(ctx);
        } catch (_e) {
          ctx.showBanner?.('Could not update favorite.', 'error');
        }
      });
    });

    root.querySelectorAll('[data-sol-collection]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-sol-collection');
        if (!state.collections.length) {
          ctx.showBanner?.('Create a collection first.', 'neutral');
          return;
        }
        var names = state.collections.map(function (c, i) { return (i + 1) + '. ' + c.name; }).join('\n');
        var pick = window.prompt('Move to collection (number), or 0 to remove:\n' + names);
        if (pick == null) return;
        var idx = parseInt(pick, 10);
        var collectionId = null;
        if (idx > 0 && state.collections[idx - 1]) collectionId = state.collections[idx - 1].id;
        try {
          var res = await ctx.apiPost(
            ctx.apiBase + '/api/subscription?action=assignSavedOutputCollection',
            { id: id, collectionId: collectionId },
            { headers: { 'X-Session-Id': ctx.session } }
          );
          if (!res.response.ok) throw new Error('fail');
          ctx.showBanner?.('Collection updated.', 'success');
          void reload(ctx);
        } catch (_e) {
          ctx.showBanner?.('Could not move output.', 'error');
        }
      });
    });
  }

  window.CutupSavedOutputsLibrary = {
    render: render,
    reload: reload,
    getState: function () { return state; },
    dbHasContent: dbHasContent,
    getRecent: function (n) {
      var list = state.recent?.length ? state.recent : state.items;
      return (list || []).slice(0, n || 5);
    }
  };
})();
