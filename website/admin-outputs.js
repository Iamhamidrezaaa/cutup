/**
 * Cutup Admin Saved Outputs intelligence workspace
 */
window.CutupAdminOutputs = (function () {
  const RECENT_KEY = 'cutup_admin_output_recent_searches';
  const SEARCH_DEBOUNCE_MS = 320;

  const state = {
    preset: 'all',
    startDate: '',
    endDate: '',
    type: 'all',
    platform: 'all',
    language: 'all',
    plan: 'all',
    search: '',
    favoritesOnly: false,
    highLength: false,
    aiHeavy: false,
    showArchived: false,
    page: 1,
    pageSize: 50,
    sort: 'created_at',
    sortDir: 'desc',
    selected: new Set(),
    data: null,
    previewCache: new Map(),
    hasRendered: false,
    searchTimer: null
  };

  const PLATFORM_ICON = {
    youtube: '▶️',
    instagram: '📷',
    tiktok: '🎵',
    twitter: '𝕏',
    x: '𝕏',
    facebook: 'f',
    vimeo: 'V',
    unknown: '🌐'
  };

  const TYPE_META = {
    transcript: { label: 'Transcript', icon: '🎙️', cls: 'out-badge--transcript' },
    summary: { label: 'Summary', icon: '📝', cls: 'out-badge--summary' },
    srt: { label: 'SRT', icon: '📄', cls: 'out-badge--srt' }
  };

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function fmt() {
    return window.CutupDashFmt || {};
  }

  function initials(email) {
    return String(email || '?').charAt(0).toUpperCase();
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlight(text, q) {
    const raw = String(text ?? '');
    if (!q || q.length < 2) return esc(raw);
    try {
      const re = new RegExp(`(${escapeRe(q)})`, 'gi');
      return esc(raw).replace(re, '<mark class="out-mark">$1</mark>');
    } catch {
      return esc(raw);
    }
  }

  function readRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 8);
    } catch {
      return [];
    }
  }

  function pushRecentSearch(q) {
    const term = String(q || '').trim();
    if (term.length < 2) return;
    const list = readRecentSearches().filter((x) => x !== term);
    list.unshift(term);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  }

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('outputs');
    if (saved) {
      Object.assign(state, saved);
      return;
    }
    const p = new URLSearchParams(window.location.search);
    if (p.get('outPreset')) state.preset = p.get('outPreset');
    if (p.get('outType')) state.type = p.get('outType');
    if (p.get('outPlatform')) state.platform = p.get('outPlatform');
    if (p.get('outLanguage')) state.language = p.get('outLanguage');
    if (p.get('outPlan')) state.plan = p.get('outPlan');
    if (p.get('outSearch')) state.search = p.get('outSearch') || '';
    if (p.get('outPage')) state.page = Number(p.get('outPage')) || 1;
    if (p.get('outStart')) state.startDate = p.get('outStart') || '';
    if (p.get('outEnd')) state.endDate = p.get('outEnd') || '';
    state.favoritesOnly = p.get('outFav') === '1';
    state.highLength = p.get('outLong') === '1';
    state.aiHeavy = p.get('outAi') === '1';
    state.showArchived = p.get('outArch') === '1';
    writeUrlState();
  }

  function writeUrlState() {
    window.CutupAdminFilterState?.saveAdminFilterState?.('outputs', { ...state });
  }

  function activeChips() {
    const chips = [];
    if (state.preset !== 'all') chips.push(`Period: ${state.preset}`);
    if (state.type !== 'all') chips.push(`Type: ${state.type}`);
    if (state.platform !== 'all') chips.push(`Platform: ${state.platform}`);
    if (state.language !== 'all') chips.push(`Language: ${state.language}`);
    if (state.plan !== 'all') chips.push(`Plan: ${state.plan}`);
    if (state.search) chips.push(`Search: ${state.search}`);
    if (state.favoritesOnly) chips.push('Favorites');
    if (state.highLength) chips.push('Long outputs');
    if (state.aiHeavy) chips.push('AI-heavy');
    if (state.showArchived) chips.push('Archived');
    return chips;
  }

  function renderInsightsBlock(insights) {
    if (!insights?.length) return '';
    return `<div class="out-insights">${insights
      .map(
        (i) =>
          `<div class="out-insight out-insight--${esc(i.tone || 'neutral')}"><span class="out-insight-dot"></span>${esc(i.text)}</div>`
      )
      .join('')}</div>`;
  }

  function renderKpis(kpis) {
    if (!kpis) return '';
    const f = fmt();
    const cards = [
      ['Total saved outputs', f.num(kpis.totalSaved), kpis.trends?.totalSaved],
      ['Outputs this week', f.num(kpis.outputsThisWeek), kpis.trends?.outputsThisWeek],
      ['Transcript share', `${f.num(kpis.transcriptPct, 1)}%`, null],
      ['Summary share', `${f.num(kpis.summaryPct, 1)}%`, null],
      ['Top platform', kpis.mostActivePlatform, null],
      ['Top language', kpis.mostActiveLanguage, null],
      ['Favorite rate', `${f.num(kpis.favoriteRate, 1)}%`, null],
      ['Avg output length', f.bytes(kpis.avgOutputLength), null],
      ['Est. AI cost', f.eur(kpis.estimatedAiCostEur), null]
    ];
    return `<div class="out-kpi-grid">${cards
      .map(
        ([label, val, trend]) =>
          `<article class="out-kpi-card"><div class="out-kpi-label">${esc(label)}</div><div class="out-kpi-value">${esc(String(val))}</div>${trend != null ? f.trendHtml(trend) || '' : ''}</article>`
      )
      .join('')}</div>`;
  }

  function renderCharts(analytics) {
    if (!analytics?.timeline?.length && !analytics?.breakdowns) {
      return '<p class="out-partial-note">Charts will populate as saved outputs accumulate.</p>';
    }
    return `
      <div class="out-charts-row">
        <div class="out-chart-card"><h3>Outputs over time</h3><div class="out-chart-wrap"><canvas id="outputsChartTimeline"></canvas></div></div>
        <div class="out-chart-card"><h3>By type</h3><div class="out-chart-wrap"><canvas id="outputsChartType"></canvas></div></div>
      </div>
      <div class="out-charts-row out-charts-row--triple">
        <div class="out-chart-card"><h3>Platform distribution</h3><div class="out-chart-wrap"><canvas id="outputsChartPlatform"></canvas></div></div>
        <div class="out-chart-card"><h3>Language distribution</h3><div class="out-chart-wrap"><canvas id="outputsChartLanguage"></canvas></div></div>
        <div class="out-chart-card"><h3>Favorite trend</h3><div class="out-chart-wrap"><canvas id="outputsChartFavorites"></canvas></div></div>
      </div>`;
  }

  function typeBadge(type) {
    const m = TYPE_META[type] || { label: type, icon: '📁', cls: 'out-badge--other' };
    return `<span class="out-badge ${m.cls}">${m.icon} ${esc(m.label)}</span>`;
  }

  function renderFilters() {
    const chips = activeChips();
    const recent = readRecentSearches();
    const recentHtml = recent.length
      ? `<div class="out-recent" id="outRecentSearches">${recent.map((t) => `<button type="button" class="out-recent-btn" data-recent="${esc(t)}">${esc(t)}</button>`).join('')}</div>`
      : '';
    return `
      <div class="out-filters-sticky">
        <div class="out-filter-bar">
          <div class="out-search-wrap">
            <input type="search" id="outSearchInput" class="out-search-input" placeholder="Search title, email, URL…" value="${esc(state.search)}" autocomplete="off" />
            ${recentHtml}
          </div>
          <div class="out-segment" role="group" aria-label="Date preset">
            ${['all', '7d', '30d', 'custom']
              .map((p) => {
                const label = p === 'all' ? 'All time' : p === '7d' ? '7 days' : p === '30d' ? '30 days' : 'Custom';
                return `<button type="button" data-out-preset="${p}" class="${state.preset === p ? 'active' : ''}">${label}</button>`;
              })
              .join('')}
          </div>
          <select id="outTypeSelect" class="out-select">
            <option value="all">All types</option>
            <option value="transcript"${state.type === 'transcript' ? ' selected' : ''}>Transcript</option>
            <option value="summary"${state.type === 'summary' ? ' selected' : ''}>Summary</option>
            <option value="srt"${state.type === 'srt' ? ' selected' : ''}>SRT</option>
          </select>
          <select id="outPlatformSelect" class="out-select">
            <option value="all">All platforms</option>
            ${['youtube', 'instagram', 'tiktok', 'twitter', 'facebook', 'vimeo']
              .map((pl) => `<option value="${pl}"${state.platform === pl ? ' selected' : ''}>${pl}</option>`)
              .join('')}
          </select>
          <input type="text" id="outLanguageInput" class="out-select" placeholder="Language" value="${state.language !== 'all' ? esc(state.language) : ''}" />
          <select id="outPlanSelect" class="out-select">
            <option value="all">All plans</option>
            <option value="free"${state.plan === 'free' ? ' selected' : ''}>Free</option>
            <option value="starter"${state.plan === 'starter' ? ' selected' : ''}>Starter</option>
            <option value="pro"${state.plan === 'pro' ? ' selected' : ''}>Pro</option>
          </select>
          <label class="out-check"><input type="checkbox" id="outFavOnly"${state.favoritesOnly ? ' checked' : ''} /> Favorites</label>
          <label class="out-check"><input type="checkbox" id="outLongOnly"${state.highLength ? ' checked' : ''} /> Long</label>
          <label class="out-check"><input type="checkbox" id="outAiOnly"${state.aiHeavy ? ' checked' : ''} /> AI-heavy</label>
          <label class="out-check"><input type="checkbox" id="outArchOnly"${state.showArchived ? ' checked' : ''} /> Archived</label>
          <span id="outCustomDates" style="${state.preset === 'custom' ? '' : 'display:none'}">
            <input type="date" id="outStartInput" value="${esc(state.startDate)}" />
            <input type="date" id="outEndInput" value="${esc(state.endDate)}" />
          </span>
          <button type="button" class="btn" id="outApplyBtn">Apply</button>
          <button type="button" class="btn ghost" id="outResetBtn">Reset</button>
        </div>
        ${chips.length ? `<div class="out-chips">${chips.map((c) => `<span class="out-chip">${esc(c)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function renderCard(row) {
    const q = state.search;
    const plat = String(row.platform || 'unknown').toLowerCase();
    const icon = PLATFORM_ICON[plat] || PLATFORM_ICON.unknown;
    const checked = state.selected.has(String(row.id)) ? 'checked' : '';
    return `
      <article class="out-card" data-id="${esc(row.id)}" tabindex="0">
        <label class="out-card-check" onclick="event.stopPropagation()">
          <input type="checkbox" class="out-row-select" data-id="${esc(row.id)}" ${checked} />
        </label>
        <div class="out-card-main">
          <header class="out-card-head">
            <div class="out-avatar" title="${esc(row.email)}">${initials(row.email)}</div>
            <div class="out-card-titles">
              <h4>${highlight(row.title, q)}</h4>
              <span class="out-card-email">${highlight(row.email, q)}</span>
            </div>
            <div class="out-card-badges">
              ${typeBadge(row.type)}
              <span class="out-platform" title="${esc(plat)}">${icon} ${esc(plat)}</span>
              <span class="out-lang">${esc(row.language)}</span>
              ${row.isFavorite ? '<span class="out-fav" title="Favorite">★</span>' : ''}
              ${row.isArchived ? '<span class="out-arch">Archived</span>' : ''}
            </div>
          </header>
          <p class="out-card-snippet">${highlight(row.previewSnippet, q)}</p>
          <footer class="out-card-meta">
            <span>${relativeTime(row.createdAt)}</span>
            <span>${fmt().bytes(row.contentLength)}</span>
            <span>${fmt().eur(row.costEstimateEur)}</span>
            <span class="out-plan">${esc(row.plan)}</span>
          </footer>
        </div>
      </article>`;
  }

  function renderList(outputs, total, page, totalPages) {
    const q = state.search;
    if (!outputs.length) {
      return `
        <div class="out-empty">
          <div class="out-empty-icon" aria-hidden="true">🗂️</div>
          <h3>No saved outputs match</h3>
          <p>When users save transcripts, summaries, or SRT files from Cutup, they appear here with full operational context.</p>
          ${q ? '<p class="out-empty-hint">Try clearing search or switching to <strong>All time</strong>.</p>' : ''}
        </div>`;
    }
    return `
      <div id="outBulkBar" class="out-bulk-bar${state.selected.size ? '' : ' hidden'}">
        ${state.selected.size ? `<span><strong>${state.selected.size}</strong> selected</span>
        <button type="button" class="btn ghost" data-bulk="favorite">Favorite</button>
        <button type="button" class="btn ghost" data-bulk="archive">Archive</button>
        <button type="button" class="btn ghost" data-bulk="export">Export CSV</button>
        <button type="button" class="btn ghost" data-bulk="lookup">User lookup</button>
        <button type="button" class="btn danger" data-bulk="delete">Delete</button>
        <button type="button" class="btn ghost" data-bulk="clear">Clear</button>` : ''}
      </div>
      <div class="out-list-head">
        <label class="out-check"><input type="checkbox" id="outSelectAll" /> Select page</label>
        <span class="out-list-count">${fmt().num(total)} outputs · page ${page} / ${totalPages}</span>
      </div>
      <div class="out-card-list">${outputs.map(renderCard).join('')}</div>
      <div class="out-pagination">
        <button type="button" class="btn ghost" id="outPrevPage" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="btn ghost" id="outNextPage" ${page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>`;
  }

  function collectFiltersFromDom() {
    state.search = document.getElementById('outSearchInput')?.value?.trim() || '';
    state.type = document.getElementById('outTypeSelect')?.value || 'all';
    state.platform = document.getElementById('outPlatformSelect')?.value || 'all';
    const lang = document.getElementById('outLanguageInput')?.value?.trim().toLowerCase() || '';
    state.language = lang ? lang : 'all';
    state.plan = document.getElementById('outPlanSelect')?.value || 'all';
    state.favoritesOnly = Boolean(document.getElementById('outFavOnly')?.checked);
    state.highLength = Boolean(document.getElementById('outLongOnly')?.checked);
    state.aiHeavy = Boolean(document.getElementById('outAiOnly')?.checked);
    state.showArchived = Boolean(document.getElementById('outArchOnly')?.checked);
    state.startDate = document.getElementById('outStartInput')?.value || '';
    state.endDate = document.getElementById('outEndInput')?.value || '';
  }

  async function fetchData() {
    return apiGet('savedOutputs', {
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      type: state.type,
      platform: state.platform,
      language: state.language,
      plan: state.plan,
      search: state.search,
      favoritesOnly: state.favoritesOnly ? '1' : '',
      highLength: state.highLength ? '1' : '',
      aiHeavy: state.aiHeavy ? '1' : '',
      showArchived: state.showArchived ? '1' : '',
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      sortDir: state.sortDir
    });
  }

  async function fetchPreview(id) {
    const key = String(id);
    if (state.previewCache.has(key)) return state.previewCache.get(key);
    const data = await apiGet('savedOutput', { id: key });
    state.previewCache.set(key, data.output);
    return data.output;
  }

  function buildDrawerHtml(detail, meta) {
    const content = detail.content || '';
    return `
      <div class="out-drawer-section">
        <h4>${esc(detail.title)}</h4>
        <div class="out-drawer-badges">${typeBadge(detail.type)} <span class="out-plan">${esc(detail.plan)}</span></div>
      </div>
      <div class="out-drawer-grid">
        <div><span class="lbl">User</span><span>${esc(detail.email)}</span></div>
        <div><span class="lbl">Platform</span><span>${esc(detail.platform)}</span></div>
        <div><span class="lbl">Language</span><span>${esc(detail.language)}</span></div>
        <div><span class="lbl">Created</span><span>${fmt().date(detail.createdAt)}</span></div>
        <div><span class="lbl">Size</span><span>${fmt().bytes(detail.contentLength)}</span></div>
        <div><span class="lbl">Est. cost</span><span>${fmt().eur(detail.costEstimateEur)}</span></div>
      </div>
      ${detail.sourceUrl ? `<p class="out-drawer-link"><a href="${esc(detail.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a></p>` : ''}
      <div class="out-drawer-section"><h5>Content preview</h5>
        <pre class="out-drawer-pre">${esc(content.slice(0, 12000))}${content.length > 12000 ? '\n…' : ''}</pre>
      </div>
      <details class="out-drawer-meta"><summary>Metadata</summary><pre>${esc(JSON.stringify(meta, null, 2))}</pre></details>
      <details class="out-drawer-meta"><summary>Timeline</summary>
        <ul class="out-timeline">
          <li><span>Created</span><span>${fmt().date(detail.createdAt)}</span></li>
          <li><span>Updated</span><span>${fmt().date(detail.updatedAt)}</span></li>
        </ul>
      </details>`;
  }

  function openDrawer(row) {
    const drawer = document.getElementById('outputsDetailDrawer');
    const body = document.getElementById('outputsDrawerBody');
    if (!drawer || !body) return;
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    body.innerHTML = '<p class="out-drawer-loading">Loading preview…</p>';
    fetchPreview(row.id)
      .then((detail) => {
        if (!detail) throw new Error('Not found');
        body.innerHTML = buildDrawerHtml(detail, detail.metadata || {});
      })
      .catch((e) => {
        body.innerHTML = `<p class="out-empty">Could not load preview: ${esc(e.message)}</p>`;
      });
  }

  function closeDrawer() {
    const drawer = document.getElementById('outputsDetailDrawer');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }

  function exportCsv(ids) {
    const rows = (state.data?.outputs || []).filter((r) => ids.includes(String(r.id)));
    if (!rows.length) return;
    const header = ['id', 'email', 'title', 'type', 'platform', 'language', 'favorite', 'length', 'cost_eur', 'created_at'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.id, r.email, r.title, r.type, r.platform, r.language, r.isFavorite, r.contentLength, r.costEstimateEur, r.createdAt]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cutup-outputs-${Date.now()}.csv`;
    a.click();
  }

  async function runBulk(op) {
    const ids = [...state.selected];
    if (!ids.length) return;
    if (op === 'delete' && !window.confirm(`Delete ${ids.length} saved output(s)? This cannot be undone.`)) return;
    if (op === 'lookup') {
      const row = (state.data?.outputs || []).find((r) => state.selected.has(String(r.id)));
      if (row?.email) {
        const p = new URLSearchParams(window.location.search);
        p.set('section', 'users');
        p.set('userSearch', row.email);
        window.location.search = p.toString();
      }
      return;
    }
    if (op === 'export') {
      exportCsv(ids);
      return;
    }
    const map = { favorite: 'favorite', archive: 'archive', delete: 'delete' };
    const operation = map[op];
    if (!operation) return;
    await apiPost('bulkSavedOutputs', { operation, ids });
    state.selected.clear();
    await load({ fullRender: false });
  }

  function bindBulkEvents() {
    document.getElementById('outBulkBar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bulk]');
      if (!btn) return;
      const op = btn.getAttribute('data-bulk');
      if (op === 'clear') {
        state.selected.clear();
        load({ fullRender: false });
        return;
      }
      runBulk(op).catch((err) => {
        if (typeof showBanner === 'function') showBanner(err.message);
      });
    });
  }

  function bindWorkspaceEvents() {
    document.querySelectorAll('[data-out-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.preset = btn.getAttribute('data-out-preset') || 'all';
        state.page = 1;
        const custom = document.getElementById('outCustomDates');
        if (custom) custom.style.display = state.preset === 'custom' ? '' : 'none';
        document.querySelectorAll('[data-out-preset]').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.preset !== 'custom') load();
      });
    });

    const searchInput = document.getElementById('outSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          collectFiltersFromDom();
          state.page = 1;
          if (state.search.length >= 2) pushRecentSearch(state.search);
          load({ fullRender: false });
        }, SEARCH_DEBOUNCE_MS);
      });
    }

    document.getElementById('outRecentSearches')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-recent]');
      if (!btn) return;
      state.search = btn.getAttribute('data-recent') || '';
      const inp = document.getElementById('outSearchInput');
      if (inp) inp.value = state.search;
      state.page = 1;
      load();
    });

    document.getElementById('outApplyBtn')?.addEventListener('click', () => {
      collectFiltersFromDom();
      state.page = 1;
      if (state.search.length >= 2) pushRecentSearch(state.search);
      load();
    });

    document.getElementById('outResetBtn')?.addEventListener('click', () => {
      Object.assign(state, {
        preset: 'all',
        startDate: '',
        endDate: '',
        type: 'all',
        platform: 'all',
        language: 'all',
        plan: 'all',
        search: '',
        favoritesOnly: false,
        highLength: false,
        aiHeavy: false,
        showArchived: false,
        page: 1
      });
      state.selected.clear();
      load();
    });

    document.getElementById('outPrevPage')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        load({ fullRender: false });
      }
    });
    document.getElementById('outNextPage')?.addEventListener('click', () => {
      if (state.page < (state.data?.totalPages || 1)) {
        state.page += 1;
        load({ fullRender: false });
      }
    });

    document.getElementById('outSelectAll')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      (state.data?.outputs || []).forEach((r) => {
        if (on) state.selected.add(String(r.id));
        else state.selected.delete(String(r.id));
      });
      load({ fullRender: false });
    });

    document.querySelectorAll('.out-row-select').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-id');
        if (cb.checked) state.selected.add(id);
        else state.selected.delete(id);
        load({ fullRender: false });
      });
    });

    document.querySelectorAll('.out-card[data-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.out-card-check')) return;
        const id = card.getAttribute('data-id');
        const row = (state.data?.outputs || []).find((r) => String(r.id) === String(id));
        if (row) openDrawer(row);
      });
    });

    document.getElementById('outputsDrawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('outputsDrawerBackdrop')?.addEventListener('click', closeDrawer);
    bindBulkEvents();
  }

  function buildWorkspaceHtml(data, outputs, total, page, totalPages) {
    const parts = [renderFilters()];
    if (data.insights?.length) parts.push(renderInsightsBlock(data.insights));
    if (data.analytics?.kpis) parts.push(renderKpis(data.analytics.kpis));
    if (data.analytics) parts.push(renderCharts(data.analytics));
    parts.push(renderList(outputs, total, page, totalPages));
    return parts.join('');
  }

  function paintWorkspace(root, data, outputs, total, page, totalPages) {
    root.classList.remove('out-skeleton');
    root.innerHTML = buildWorkspaceHtml(data, outputs, total, page, totalPages);
    bindWorkspaceEvents();
    if (data.analytics && typeof Chart !== 'undefined') {
      requestAnimationFrame(() => window.CutupOutputsCharts?.renderAll?.(data.analytics));
    }
  }

  async function load(opts = {}) {
    const options = typeof opts === 'boolean' ? { fullRender: opts } : opts;
    const { fullRender = true, silent = false } = options;
    const root = document.getElementById('outputsWorkspace');
    const legacyWrap = document.getElementById('outputsLegacyWrap');
    if (!root) return;

    if (fullRender && !silent) {
      root.classList.add('out-skeleton');
      root.innerHTML = '<div class="out-kpi-grid out-kpi-grid--skel"></div>';
    }

    writeUrlState();

    try {
      const data = await fetchData();
      state.data = data;
      const outputs = data.outputs || [];
      state.hasRendered = true;
      if (legacyWrap) legacyWrap.hidden = true;
      paintWorkspace(root, data, outputs, data.total || 0, data.page || 1, data.totalPages || 1);

      if (!outputs.length && typeof renderOutputsTable === 'function' && legacyWrap) {
        legacyWrap.hidden = false;
        const legacy = await apiGet('savedOutputs', { legacy: '1', limit: 300 });
        renderOutputsTable(legacy.outputs || []);
      }
    } catch (e) {
      if (silent && state.hasRendered) {
        console.warn('[Cutup Outputs] refresh failed', e);
        return;
      }
      root.classList.remove('out-skeleton');
      try {
        const legacy = await apiGet('savedOutputs', { legacy: '1', limit: 300 });
        root.innerHTML = `${renderFilters()}<p class="out-partial-note">Dashboard unavailable; showing legacy table.</p>`;
        bindWorkspaceEvents();
        if (legacyWrap) {
          legacyWrap.hidden = false;
          renderOutputsTable(legacy.outputs || []);
        }
      } catch (e2) {
        root.innerHTML = `<p class="out-empty">Failed to load outputs: ${esc(e.message || e2.message)}</p>`;
      }
    }
  }

  function initGlobal() {
    readUrlState();
    document.getElementById('outputsExportCsvBtn')?.addEventListener('click', () => {
      const ids = state.selected.size
        ? [...state.selected]
        : (state.data?.outputs || []).map((r) => String(r.id));
      exportCsv(ids);
    });
  }

  initGlobal();

  return { load, readUrlState, getState: () => ({ ...state }) };
})();
