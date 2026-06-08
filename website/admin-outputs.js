/**
 * Cutup Admin Saved Outputs intelligence workspace
 */
window.CutupAdminOutputs = (function () {
  const RECENT_KEY = 'cutup_admin_output_recent_searches';
  const SEARCH_DEBOUNCE_MS = 320;
  const REFRESH_MS = 20000;
  const STATUS_TICK_MS = 1000;

  const state = {
    preset: 'all',
    startDate: '',
    endDate: '',
    type: 'all',
    platform: 'all',
    language: 'all',
    plan: 'all',
    search: '',
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
    searchTimer: null,
    lastUpdatedAt: null,
    lastRefreshError: null,
    refreshTimer: null,
    statusTickTimer: null,
    refreshInFlight: false
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
    translation: { label: 'Translation', icon: '🌐', cls: 'out-badge--translation' },
    subtitle: { label: 'Subtitle', icon: '📄', cls: 'out-badge--subtitle' },
    srt: { label: 'Subtitle', icon: '📄', cls: 'out-badge--subtitle' },
    mp4: { label: 'MP4 export', icon: '🎬', cls: 'out-badge--mp4' }
  };

  const TYPE_LABELS = {
    all: 'All types',
    transcript: 'Transcript',
    summary: 'Summary',
    translation: 'Translation',
    subtitle: 'Subtitle (SRT)',
    mp4: 'MP4 export'
  };

  const PLATFORM_LABELS = {
    all: 'All platforms',
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    twitter: 'X / Twitter',
    facebook: 'Facebook',
    vimeo: 'Vimeo',
    upload: 'Upload'
  };

  const PLAN_LABELS = {
    all: 'All plans',
    free: 'Free',
    starter: 'Starter',
    pro: 'Pro',
    business: 'Business'
  };

  const PRESET_LABELS = {
    all: 'All time',
    '7d': '7 days',
    '30d': '30 days',
    custom: 'Custom'
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

  function persistableState() {
    return {
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      type: state.type,
      platform: state.platform,
      language: state.language,
      plan: state.plan,
      search: state.search,
      highLength: state.highLength,
      aiHeavy: state.aiHeavy,
      showArchived: state.showArchived,
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      sortDir: state.sortDir
    };
  }

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('outputs');
    if (saved) {
      Object.assign(state, persistableState(), saved);
      state.selected = new Set();
      state.previewCache = new Map();
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
    state.highLength = p.get('outLong') === '1';
    state.aiHeavy = p.get('outAi') === '1';
    state.showArchived = p.get('outArch') === '1';
    writeUrlState();
  }

  function writeUrlState() {
    window.CutupAdminFilterState?.saveAdminFilterState?.('outputs', persistableState());
  }

  function formatUpdatedAgo(ts) {
    if (!ts) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 8) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  }

  function updateLiveStatus(phase = 'ok') {
    const el = document.getElementById('outputsLiveStatus');
    const updatedEl = document.getElementById('outputsLiveUpdated');
    if (!el) return;
    el.classList.remove('out-live-status--syncing', 'out-live-status--error');
    if (phase === 'syncing') el.classList.add('out-live-status--syncing');
    if (phase === 'error') el.classList.add('out-live-status--error');
    const label = el.querySelector('.out-live-label');
    if (label) {
      label.textContent = phase === 'error' ? 'Update paused — showing last data' : 'Live updates enabled';
    }
    if (updatedEl) {
      updatedEl.textContent = state.lastUpdatedAt
        ? `Updated ${formatUpdatedAgo(state.lastUpdatedAt)}`
        : 'Loading…';
    }
  }

  function activeChips() {
    const chips = [];
    if (state.preset !== 'all') chips.push({ text: `Period: ${PRESET_LABELS[state.preset] || state.preset}` });
    if (state.type !== 'all') chips.push({ text: `Type: ${TYPE_LABELS[state.type] || state.type}` });
    if (state.platform !== 'all') chips.push({ text: `Platform: ${PLATFORM_LABELS[state.platform] || state.platform}` });
    if (state.language !== 'all') chips.push({ text: `Language: ${state.language}` });
    if (state.plan !== 'all') chips.push({ text: `Plan: ${PLAN_LABELS[state.plan] || state.plan}` });
    if (state.search) chips.push({ text: `Search: ${state.search}` });
    if (state.highLength) chips.push({ text: 'Long outputs' });
    if (state.aiHeavy) chips.push({ text: 'AI-heavy' });
    if (state.showArchived) chips.push({ text: 'Archived' });
    return chips;
  }

  function resolveOutputKind(type, metadata = {}) {
    const t = String(type || '').toLowerCase();
    if (t === 'mp4') return 'mp4';
    if (t === 'summary' || t === 'summarization') return 'summary';
    if (t === 'translation') return 'translation';
    if (t === 'subtitle' || t === 'srt') return 'subtitle';
    if (t === 'transcript' || t === 'transcription') return 'transcript';
    const meta = metadata || {};
    if (
      meta.translationOnly === true ||
      String(meta.translationOnly || '').toLowerCase() === 'true' ||
      meta.operation === 'translation' ||
      meta.outputType === 'translation'
    ) {
      return 'translation';
    }
    if (t === 'srt') return 'subtitle';
    return t || 'transcript';
  }

  function srtToReadable(srt) {
    const lines = String(srt || '').split('\n');
    const cues = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (/^\d+$/.test(line)) {
        i += 1;
        continue;
      }
      if (/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(line)) {
        i += 1;
        const textLines = [];
        while (i < lines.length && lines[i].trim()) {
          textLines.push(lines[i].trim());
          i += 1;
        }
        if (textLines.length) cues.push(textLines.join(' '));
        continue;
      }
      i += 1;
    }
    const unique = [];
    cues.forEach((c) => {
      if (!unique.length || unique[unique.length - 1] !== c) unique.push(c);
    });
    return unique.join('\n\n');
  }

  function formatContentPreview(detail) {
    const kind = resolveOutputKind(detail.type, detail.metadata);
    const raw = String(detail.content || '').trim();

    if (kind === 'mp4') {
      const meta = detail.metadata || {};
      const lines = [
        ['Export file', meta.quality ? `${detail.title} (${meta.quality})` : detail.title || '—'],
        ['Resolution', meta.resolution || '—'],
        ['Duration', meta.videoDurationSec != null ? `${Math.round(meta.videoDurationSec)}s` : '—'],
        ['File size', fmt().bytes?.(detail.contentLength) || detail.contentLength || '—'],
        ['Expires', meta.expiresAt ? fmt().date?.(meta.expiresAt) || meta.expiresAt : '—']
      ];
      return {
        html: `<dl class="out-preview-meta">${lines
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
          .join('')}</dl>`,
        plain: lines.map(([k, v]) => `${k}: ${v}`).join('\n')
      };
    }

    if (!raw) {
      return { html: '<p class="out-preview-empty">No text content stored for this output.</p>', plain: '' };
    }

    if (kind === 'subtitle' || kind === 'translation') {
      const readable = srtToReadable(raw);
      const cues = readable.split('\n\n').filter(Boolean).slice(0, 16);
      return {
        html: `<div class="out-preview-cues">${cues.map((c) => `<p>${esc(c)}</p>`).join('')}${
          readable.split('\n\n').length > 16 ? '<p class="out-preview-more">… more cues in full export</p>' : ''
        }</div>`,
        plain: readable
      };
    }

    if (kind === 'summary') {
      return {
        html: `<div class="out-preview-prose">${esc(raw).replace(/\n/g, '<br>')}</div>`,
        plain: raw
      };
    }

    const excerpt = raw.length > 4000 ? `${raw.slice(0, 4000)}…` : raw;
    return {
      html: `<div class="out-preview-prose">${esc(excerpt).replace(/\n/g, '<br>')}</div>`,
      plain: excerpt
    };
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
      ['Translation share', `${f.num(kpis.translationPct, 1)}%`, null],
      ['MP4 exports', f.num(kpis.mp4Count), null],
      ['Top platform', kpis.mostActivePlatform, null],
      ['Top language', kpis.mostActiveLanguage, null],
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
        <div class="out-chart-card"><h3>Translation & subtitles</h3><div class="out-chart-wrap"><canvas id="outputsChartTranslation"></canvas></div></div>
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
    const customVisible = state.preset === 'custom';
    return `
      <div class="out-filters-sticky">
        <div class="out-filters-card">
          <div class="out-filters-period">
            <div class="out-filters-period-main">
              <span class="out-filters-label">Time range</span>
              <div class="out-segment" role="group" aria-label="Date preset">
                ${['all', '7d', '30d', 'custom']
                  .map((p) => {
                    const label = PRESET_LABELS[p] || p;
                    return `<button type="button" data-out-preset="${p}" class="${state.preset === p ? 'active' : ''}">${label}</button>`;
                  })
                  .join('')}
              </div>
            </div>
            <div id="outCustomDates" class="out-filters-custom${customVisible ? ' is-visible' : ''}">
              <label class="out-filter-field out-filter-field--date">
                <span>From</span>
                <input type="date" id="outStartInput" class="out-filter-input" value="${esc(state.startDate)}" />
              </label>
              <label class="out-filter-field out-filter-field--date">
                <span>To</span>
                <input type="date" id="outEndInput" class="out-filter-input" value="${esc(state.endDate)}" />
              </label>
            </div>
          </div>
          <div class="out-filters-grid">
            <label class="out-filter-field out-filter-field--search">
              <span>Search</span>
              <input type="search" id="outSearchInput" class="out-filter-input" placeholder="Title, email, URL…" value="${esc(state.search)}" autocomplete="off" />
              ${recentHtml}
            </label>
            <label class="out-filter-field">
              <span>Output type</span>
              <select id="outTypeSelect" class="out-filter-input" aria-label="Output type">
                ${Object.entries(TYPE_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.type === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="out-filter-field">
              <span>Platform</span>
              <select id="outPlatformSelect" class="out-filter-input" aria-label="Platform">
                ${Object.entries(PLATFORM_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.platform === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="out-filter-field">
              <span>Language</span>
              <input type="text" id="outLanguageInput" class="out-filter-input" placeholder="e.g. en" value="${state.language !== 'all' ? esc(state.language) : ''}" />
            </label>
            <label class="out-filter-field">
              <span>Plan</span>
              <select id="outPlanSelect" class="out-filter-input" aria-label="Plan">
                ${Object.entries(PLAN_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.plan === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
          </div>
          <div class="out-filters-toggles">
            <label class="out-check"><input type="checkbox" id="outLongOnly"${state.highLength ? ' checked' : ''} /> Long outputs</label>
            <label class="out-check"><input type="checkbox" id="outAiOnly"${state.aiHeavy ? ' checked' : ''} /> AI-heavy</label>
            <label class="out-check"><input type="checkbox" id="outArchOnly"${state.showArchived ? ' checked' : ''} /> Archived</label>
          </div>
          <div class="out-filters-footer">
            ${chips.length ? `<div class="out-chips">${chips.map((c) => `<span class="out-chip">${esc(c.text)}</span>`).join('')}</div>` : '<span class="out-filters-hint">Browse transcripts, summaries, subtitles, translations, and MP4 exports.</span>'}
            <div class="out-filters-actions">
              <button type="button" class="btn ghost" id="outResetBtn">Reset</button>
              <button type="button" class="btn" id="outApplyBtn">Apply filters</button>
            </div>
          </div>
        </div>
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
        <button type="button" class="btn ghost" data-bulk="archive">Archive</button>
        <button type="button" class="btn ghost" data-bulk="export">Export CSV</button>
        <button type="button" class="btn ghost" data-bulk="lookup">User lookup</button>
        <button type="button" class="btn danger" data-bulk="delete">Delete</button>
        <button type="button" class="btn ghost" data-bulk="clear">Clear</button>` : ''}
      </div>
      <div class="out-list-toolbar">
        <div class="out-list-toolbar-main">
          <h3 class="out-list-title">Saved content</h3>
          <span class="out-list-count">${fmt().num(total)} outputs</span>
        </div>
        <label class="out-check"><input type="checkbox" id="outSelectAll" /> Select page</label>
      </div>
      <div class="out-card-list">${outputs.map(renderCard).join('')}</div>
      <div class="out-pagination">
        <span class="out-pagination-meta">Page <strong>${page}</strong> of <strong>${totalPages}</strong></span>
        <div class="out-pagination-actions">
          <button type="button" class="btn ghost" id="outPrevPage" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
          <button type="button" class="btn ghost" id="outNextPage" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>`;
  }

  function collectFiltersFromDom() {
    state.search = document.getElementById('outSearchInput')?.value?.trim() || '';
    state.type = document.getElementById('outTypeSelect')?.value || 'all';
    state.platform = document.getElementById('outPlatformSelect')?.value || 'all';
    const lang = document.getElementById('outLanguageInput')?.value?.trim().toLowerCase() || '';
    state.language = lang ? lang : 'all';
    state.plan = document.getElementById('outPlanSelect')?.value || 'all';
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
    const preview = formatContentPreview(detail);
    return `
      <div class="out-drawer-section">
        <h4>${esc(detail.title)}</h4>
        <div class="out-drawer-badges">${typeBadge(detail.type)} <span class="out-plan">${esc(fmt().planLabel?.(detail.plan) || detail.plan)}</span></div>
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
      <div class="out-drawer-section"><h5>Preview</h5>
        <div class="out-drawer-preview">${preview.html}</div>
      </div>
      <details class="out-drawer-meta"><summary>Raw content</summary><pre class="out-drawer-pre">${esc(preview.plain || detail.content || '—')}</pre></details>
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
    const header = ['id', 'email', 'title', 'type', 'platform', 'language', 'length', 'cost_eur', 'created_at'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [r.id, r.email, r.title, r.type, r.platform, r.language, r.contentLength, r.costEstimateEur, r.createdAt]
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
    const map = { archive: 'archive', delete: 'delete' };
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
        if (custom) custom.classList.toggle('is-visible', state.preset === 'custom');
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

    if (silent && !state.hasRendered) {
      return load({ fullRender: true, silent: false });
    }
    if (state.refreshInFlight && silent) return;

    if (fullRender && !silent) {
      root.classList.add('out-skeleton');
      root.innerHTML = '<div class="out-kpi-grid out-kpi-grid--skel"></div>';
      updateLiveStatus('syncing');
    } else if (silent) {
      updateLiveStatus('syncing');
    }

    writeUrlState();
    state.refreshInFlight = true;

    try {
      const data = await fetchData();
      state.data = data;
      const outputs = data.outputs || [];
      state.hasRendered = true;
      state.lastUpdatedAt = Date.now();
      state.lastRefreshError = null;
      if (legacyWrap) legacyWrap.hidden = true;
      paintWorkspace(root, data, outputs, data.total || 0, data.page || 1, data.totalPages || 1);
      updateLiveStatus('ok');
    } catch (e) {
      state.lastRefreshError = e;
      if (silent && state.hasRendered) {
        console.warn('[Cutup Outputs] refresh failed', e);
        updateLiveStatus('error');
        return;
      }
      root.classList.remove('out-skeleton');
      if (state.hasRendered && state.data) {
        updateLiveStatus('error');
        return;
      }
      try {
        const legacy = await apiGet('savedOutputs', { legacy: '1', limit: 300 });
        root.innerHTML = `${renderFilters()}<p class="out-partial-note">Dashboard unavailable; showing simplified list.</p>`;
        bindWorkspaceEvents();
        state.hasRendered = true;
        state.lastUpdatedAt = Date.now();
        if (legacyWrap) {
          legacyWrap.hidden = false;
          renderOutputsTable(legacy.outputs || []);
        }
        updateLiveStatus('error');
      } catch (e2) {
        root.innerHTML = `<p class="out-empty">Failed to load outputs: ${esc(e.message || e2.message)}</p>`;
        updateLiveStatus('error');
      }
    } finally {
      state.refreshInFlight = false;
    }
  }

  function isOutputsSectionActive() {
    return document.getElementById('section-outputs')?.classList.contains('active');
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (!isOutputsSectionActive()) return;
      load({ fullRender: false, silent: true });
    }, REFRESH_MS);
    if (!state.statusTickTimer) {
      state.statusTickTimer = setInterval(() => {
        if (!isOutputsSectionActive() || !state.lastUpdatedAt) return;
        updateLiveStatus(state.refreshInFlight ? 'syncing' : state.lastRefreshError ? 'error' : 'ok');
      }, STATUS_TICK_MS);
    }
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    if (state.statusTickTimer) {
      clearInterval(state.statusTickTimer);
      state.statusTickTimer = null;
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
    if (isOutputsSectionActive()) startAutoRefresh();
  }

  initGlobal();

  return { load, readUrlState, startAutoRefresh, stopAutoRefresh, openDrawer, getState: () => ({ ...state }) };
})();
