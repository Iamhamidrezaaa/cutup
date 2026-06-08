/**
 * Cutup Admin Usage analytics workspace
 */
window.CutupAdminUsage = (function () {
  const state = {
    preset: 'all',
    startDate: '',
    endDate: '',
    type: 'all',
    platform: 'all',
    plan: 'all',
    country: 'all',
    search: '',
    page: 1,
    pageSize: 100,
    sort: 'created_at',
    sortDir: 'desc',
    lastTopId: null,
    data: null,
    lastUpdatedAt: null,
    lastRefreshError: null,
    refreshTimer: null,
    statusTickTimer: null,
    refreshInFlight: false,
    hasRendered: false
  };

  const REFRESH_MS = 20000;
  const STATUS_TICK_MS = 1000;

  const TYPE_ICONS = {
    transcription: '🎙️',
    summarization: '📝',
    srt: '📄',
    download: '⬇️'
  };

  function fmt() {
    return window.CutupDashFmt || {};
  }

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function initials(email) {
    const e = String(email || '?');
    return e.charAt(0).toUpperCase();
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

  function sparkHtml(series) {
    const pts = series || [];
    if (!pts.length) return '<div class="usage-spark"></div>';
    const max = Math.max(...pts.map((p) => p.value), 1);
    return `<div class="usage-spark">${pts
      .map((p) => {
        const h = Math.max(4, Math.round((p.value / max) * 100));
        return `<span class="${p.value > 0 ? 'on' : ''}" style="height:${h}%" title="${esc(p.day)}"></span>`;
      })
      .join('')}</div>`;
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
    const el = document.getElementById('usageLiveStatus');
    const updatedEl = document.getElementById('usageLiveUpdated');
    if (!el) return;
    el.classList.remove('usage-live-status--syncing', 'usage-live-status--error');
    if (phase === 'syncing') el.classList.add('usage-live-status--syncing');
    if (phase === 'error') el.classList.add('usage-live-status--error');
    const label = el.querySelector('.usage-live-label');
    if (label) {
      label.textContent =
        phase === 'error' ? 'Update paused — showing last data' : 'Live updates enabled';
    }
    if (updatedEl) {
      updatedEl.textContent = state.lastUpdatedAt
        ? `Updated ${formatUpdatedAgo(state.lastUpdatedAt)}`
        : 'Loading…';
    }
  }

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('usage');
    if (saved) {
      if (saved.preset != null) state.preset = saved.preset;
      if (saved.type != null) state.type = saved.type;
      if (saved.platform != null) state.platform = saved.platform;
      if (saved.plan != null) state.plan = saved.plan;
      if (saved.country != null) state.country = saved.country;
      if (saved.search != null) state.search = saved.search;
      if (saved.page != null) state.page = Number(saved.page) || 1;
      if (saved.startDate != null) state.startDate = saved.startDate;
      if (saved.endDate != null) state.endDate = saved.endDate;
      return;
    }
    const p = new URLSearchParams(window.location.search);
    if (p.get('usagePreset')) state.preset = p.get('usagePreset');
    if (p.get('usageType')) state.type = p.get('usageType');
    if (p.get('usagePlatform')) state.platform = p.get('usagePlatform');
    if (p.get('usagePlan')) state.plan = p.get('usagePlan');
    if (p.get('usageCountry')) state.country = p.get('usageCountry');
    if (p.get('usageSearch')) state.search = p.get('usageSearch');
    if (p.get('usagePage')) state.page = Number(p.get('usagePage')) || 1;
    if (p.get('usageStart')) state.startDate = p.get('usageStart') || '';
    if (p.get('usageEnd')) state.endDate = p.get('usageEnd') || '';
    writeUrlState();
  }

  function writeUrlState() {
    window.CutupAdminFilterState?.saveAdminFilterState?.('usage', {
      preset: state.preset,
      type: state.type,
      platform: state.platform,
      plan: state.plan,
      country: state.country,
      search: state.search,
      page: state.page,
      startDate: state.startDate,
      endDate: state.endDate
    });
  }

  const TYPE_LABELS = {
    all: 'All types',
    transcription: 'Transcription',
    summarization: 'Summarization',
    srt: 'SRT export',
    download: 'Download'
  };

  const PLATFORM_LABELS = {
    all: 'All platforms',
    youtube: 'YouTube',
    instagram: 'Instagram',
    tiktok: 'TikTok',
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
    today: 'Today',
    yesterday: 'Yesterday',
    '7d': '7 days',
    '30d': '30 days',
    custom: 'Custom'
  };

  function activeChips() {
    const chips = [];
    if (state.preset !== 'all') chips.push({ key: 'preset', text: `Period: ${PRESET_LABELS[state.preset] || state.preset}` });
    if (state.type !== 'all') chips.push({ key: 'type', text: `Type: ${TYPE_LABELS[state.type] || state.type}` });
    if (state.platform !== 'all') chips.push({ key: 'platform', text: `Platform: ${PLATFORM_LABELS[state.platform] || state.platform}` });
    if (state.plan !== 'all') chips.push({ key: 'plan', text: `Plan: ${PLAN_LABELS[state.plan] || state.plan}` });
    if (state.country !== 'all') chips.push({ key: 'country', text: `Country: ${state.country}` });
    if (state.search) chips.push({ key: 'search', text: `Email: ${state.search}` });
    return chips;
  }

  function renderFilters() {
    const chips = activeChips();
    const customVisible = state.preset === 'custom';
    return `
      <div class="usage-filters-sticky">
        <div class="usage-filters-card">
          <div class="usage-filters-period">
            <div class="usage-filters-period-main">
              <span class="usage-filters-label">Time range</span>
              <div class="usage-segment" role="group" aria-label="Date preset">
                ${['all', 'today', 'yesterday', '7d', '30d', 'custom']
                  .map((p) => {
                    const label = PRESET_LABELS[p] || p;
                    return `<button type="button" data-preset="${p}" class="${state.preset === p ? 'active' : ''}">${label}</button>`;
                  })
                  .join('')}
              </div>
            </div>
            <div id="usageCustomDates" class="usage-filters-custom${customVisible ? ' is-visible' : ''}">
              <label class="usage-filter-field usage-filter-field--date">
                <span>From</span>
                <input type="date" id="usageStartInput" value="${esc(state.startDate)}" />
              </label>
              <label class="usage-filter-field usage-filter-field--date">
                <span>To</span>
                <input type="date" id="usageEndInput" value="${esc(state.endDate)}" />
              </label>
            </div>
          </div>
          <div class="usage-filters-grid">
            <label class="usage-filter-field usage-filter-field--search">
              <span>Search user</span>
              <input type="search" id="usageSearchInput" class="usage-filter-input" placeholder="Filter by email…" value="${esc(state.search)}" autocomplete="off" />
            </label>
            <label class="usage-filter-field">
              <span>Activity type</span>
              <select id="usageTypeSelect" class="usage-filter-input" aria-label="Activity type">
                ${Object.entries(TYPE_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.type === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="usage-filter-field">
              <span>Platform</span>
              <select id="usagePlatformSelect" class="usage-filter-input" aria-label="Platform">
                ${Object.entries(PLATFORM_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.platform === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="usage-filter-field">
              <span>Plan</span>
              <select id="usagePlanSelect" class="usage-filter-input" aria-label="Plan">
                ${Object.entries(PLAN_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.plan === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="usage-filter-field usage-filter-field--country">
              <span>Country</span>
              <input type="text" id="usageCountryInput" class="usage-filter-input" placeholder="ISO code" maxlength="2" value="${esc(state.country === 'all' ? '' : state.country)}" aria-label="Country ISO code" />
            </label>
          </div>
          <div class="usage-filters-footer">
            ${chips.length ? `<div class="usage-chips">${chips.map((c) => `<span class="usage-chip">${esc(c.text)}</span>`).join('')}</div>` : '<span class="usage-filters-hint">Refine usage events, KPIs, and charts with the filters above.</span>'}
            <div class="usage-filters-actions">
              <button type="button" class="btn ghost" id="usageResetBtn">Reset</button>
              <button type="button" class="btn" id="usageApplyBtn">Apply filters</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function kpiCard(label, value, trend, sparkSeries) {
    const f = fmt();
    const spark = sparkHtml(sparkSeries);
    return `<article class="usage-kpi">
      <p class="usage-kpi-label">${esc(label)}</p>
      <p class="usage-kpi-value">${esc(value)}</p>
      ${trend != null ? f.trendHtml?.(trend) || '' : ''}
      ${spark}
    </article>`;
  }

  function renderKpis(kpis) {
    if (!kpis) return '';
    const f = fmt();
    const sp = kpis.sparklines?.minutes || [];
    return `<div class="usage-kpi-grid">
      ${kpiCard('Processing minutes', f.num?.(kpis.totalMinutes, 1) ?? kpis.totalMinutes, kpis.trends?.totalMinutes, sp)}
      ${kpiCard('AI jobs', f.num?.(kpis.totalJobs) ?? kpis.totalJobs, kpis.trends?.totalJobs, kpis.sparklines?.jobs)}
      ${kpiCard('Exports', f.num?.(kpis.totalExports) ?? kpis.totalExports, kpis.trends?.totalExports, null)}
      ${kpiCard('Avg duration', `${kpis.avgDuration} min`, kpis.trends?.avgDuration, null)}
      ${kpiCard('Avg transcript len', f.num?.(kpis.avgTranscriptLength) ?? kpis.avgTranscriptLength, null, null)}
      ${kpiCard('Translation %', `${kpis.translationPct}%`, null, null)}
      ${kpiCard('Top platform', esc(kpis.mostUsedPlatform), null, null)}
      ${kpiCard('Active today', f.num?.(kpis.activeUsersToday) ?? kpis.activeUsersToday, null, null)}
      ${kpiCard('Est. AI cost', f.eur?.(kpis.estimatedCostEur) ?? `€${kpis.estimatedCostEur}`, kpis.trends?.estimatedCostEur, null)}
      ${kpiCard('Top country', esc(kpis.mostActiveCountry), null, null)}
    </div>`;
  }

  function renderInsights(insights) {
    if (!insights?.length) return '';
    return `<div class="usage-insights">${insights
      .map((i) => `<span class="usage-insight ${esc(i.tone || 'neutral')}">${esc(i.text)}</span>`)
      .join('')}</div>`;
  }

  function typeBadge(row) {
    const t = row.isTranslation ? 'translate' : row.type || 'unknown';
    const cls = t === 'transcription' ? 'transcription' : t;
    return `<span class="usage-badge ${esc(cls)}">${esc(t)}</span>`;
  }

  const SORT_LABELS = {
    created_at: 'Date',
    minutes: 'Duration',
    email: 'Email',
    type: 'Activity type'
  };

  function renderTable(rows, total, page, totalPages) {
    const head = `
      <thead><tr>
        <th></th><th>User</th><th>Plan</th><th>Country</th><th>Type</th><th>Platform</th>
        <th>Duration</th><th>AI cost</th><th>Export</th><th>Status</th><th>When</th>
      </tr></thead>`;
    const body = rows.length
      ? rows
          .map((r) => {
            const icon = r.isTranslation ? '🌐' : TYPE_ICONS[r.type] || '•';
            return `<tr data-id="${esc(r.id)}">
          <td><span class="usage-type-icon">${icon}</span></td>
          <td><span class="usage-avatar">${esc(initials(r.email))}</span> ${esc(r.email)}</td>
          <td>${esc(fmt().planLabel?.(r.plan) || r.plan)}</td>
          <td>${esc(r.country)}</td>
          <td>${typeBadge(r)}</td>
          <td>${esc(r.platform)}</td>
          <td>${esc(r.durationMinutes)} min</td>
          <td>${esc(fmt().eur?.(r.costEstimateEur) || r.costEstimateEur)}</td>
          <td>${esc(r.exportType)}</td>
          <td><span class="usage-badge ${esc(r.status)}">${esc(r.status)}</span></td>
          <td title="${esc(fmt().date?.(r.createdAt) || r.createdAt)}">${esc(relativeTime(r.createdAt))}</td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="11" class="usage-empty">No usage events match your filters.</td></tr>`;

    const sortSummary = `${SORT_LABELS[state.sort] || state.sort} · ${state.sortDir === 'asc' ? 'Oldest first' : 'Newest first'}`;

    return `
      <div class="usage-table-card">
        <div class="usage-table-toolbar">
          <div class="usage-table-toolbar-main">
            <h3 class="usage-table-title">Activity log</h3>
            <span class="usage-table-count">${esc(fmt().num?.(total) ?? total)} events</span>
          </div>
          <div class="usage-table-controls">
            <label class="usage-filter-field usage-filter-field--sort">
              <span>Sort by</span>
              <select id="usageSortSelect" class="usage-filter-input" aria-label="Sort by">
                ${Object.entries(SORT_LABELS)
                  .map(([value, label]) => `<option value="${value}"${state.sort === value ? ' selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <div class="usage-filter-field usage-filter-field--order">
              <span>Order</span>
              <div class="usage-segment usage-segment--compact" role="group" aria-label="Sort order">
                <button type="button" data-sort-dir="desc" class="${state.sortDir === 'desc' ? 'active' : ''}">Newest</button>
                <button type="button" data-sort-dir="asc" class="${state.sortDir === 'asc' ? 'active' : ''}">Oldest</button>
              </div>
            </div>
          </div>
        </div>
        <div class="usage-table-scroll">
          <table>${head}<tbody>${body}</tbody></table>
        </div>
        <div class="usage-pagination">
          <span class="usage-pagination-meta">
            Page <strong>${page}</strong> of <strong>${totalPages}</strong>
            <span class="usage-pagination-sort">${esc(sortSummary)}</span>
          </span>
          <div class="usage-pagination-actions">
            <button type="button" class="btn ghost" id="usagePrevPage" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
            <button type="button" class="btn ghost" id="usageNextPage" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
          </div>
        </div>
      </div>`;
  }

  function normalizeRows(rows) {
    return (rows || []).map((r) => {
      if (!r) return null;
      if (r.platform != null && r.email) return r;
      const meta = r.metadata || {};
      return {
        id: String(r.id || ''),
        email: r.email || '—',
        plan: r.plan || 'free',
        country: r.country || '—',
        type: r.type || 'unknown',
        minutes: Number(r.minutes || 0),
        metadata: meta,
        createdAt: r.createdAt,
        platform: meta.platform || meta.source || 'unknown',
        title: meta.title || meta.videoTitle || meta.filename || '—',
        sourceUrl: meta.sourceUrl || meta.url || '',
        costEstimateEur: Math.round(Math.max(0, Number(r.minutes || 0)) * 0.0055 * 100) / 100,
        durationMinutes: Math.max(0, Number(r.minutes || 0)),
        exportType: r.type === 'download' ? meta.kind || 'download' : r.type === 'srt' ? 'srt' : '—',
        status: Number(r.minutes) < 0 ? 'refunded' : 'completed',
        isTranslation: meta.translationOnly === true || String(meta.translationOnly).toLowerCase() === 'true'
      };
    }).filter(Boolean);
  }

  function renderCharts(analytics) {
    if (!analytics?.timeline?.length && !analytics?.breakdowns) {
      return '<p class="usage-partial-note metric-subtle">Charts will populate as more usage is recorded in this period.</p>';
    }
    return `
      <div class="usage-charts-row">
        <div class="usage-chart-card">
          <h3>Usage timeline</h3>
          <div class="usage-chart-wrap"><canvas id="usageChartTimeline"></canvas></div>
        </div>
        <div class="usage-chart-card">
          <h3>By feature</h3>
          <div class="usage-chart-wrap"><canvas id="usageChartFeature"></canvas></div>
        </div>
      </div>
      <div class="usage-breakdown-grid">
        <div class="usage-breakdown-card"><h4>By platform</h4><div class="usage-chart-wrap" style="height:180px"><canvas id="usageChartPlatform"></canvas></div></div>
        <div class="usage-breakdown-card"><h4>Top countries</h4><ul class="metric-subtle" style="margin:0;padding-left:18px;">${(analytics?.breakdowns?.byCountry || [])
          .slice(0, 8)
          .map((c) => `<li>${esc(c.name)} — ${c.count}</li>`)
          .join('') || '<li>No data</li>'}</ul></div>
        <div class="usage-breakdown-card"><h4>By plan</h4><ul class="metric-subtle" style="margin:0;padding-left:18px;">${(analytics?.breakdowns?.byPlan || [])
          .map((c) => `<li>${esc(fmt().planLabel?.(c.name) || c.name)} — ${c.count}</li>`)
          .join('') || '<li>No data</li>'}</ul></div>
      </div>
      <div class="usage-breakdown-card" style="margin-top:12px">
        <h4>Most expensive users (est. AI cost)</h4>
        <div class="usage-table-scroll" style="max-height:200px">
          <table><thead><tr><th>Email</th><th>Minutes</th><th>Cost</th></tr></thead><tbody>
          ${(analytics?.breakdowns?.topExpensiveUsers || [])
            .map(
              (u) =>
                `<tr><td>${esc(u.email)}</td><td>${esc(u.minutes)}</td><td>${esc(fmt().eur?.(u.costEur) || u.costEur)}</td></tr>`
            )
            .join('') || emptyRow(3, 'No data')}
          </tbody></table>
        </div>
      </div>`;
  }

  function emptyRow(cols, msg) {
    return `<tr><td colspan="${cols}">${esc(msg)}</td></tr>`;
  }

  function openDrawer(row) {
    const drawer = document.getElementById('usageDetailDrawer');
    const body = document.getElementById('usageDrawerBody');
    if (!drawer || !body) return;
    const meta = row.metadata || {};
    body.innerHTML = `
      <dl>
        <dt>User</dt><dd>${esc(row.email)}</dd>
        <dt>Plan</dt><dd>${esc(row.plan)}</dd>
        <dt>Country</dt><dd>${esc(row.country)}</dd>
        <dt>Type</dt><dd>${esc(row.type)}</dd>
        <dt>Platform</dt><dd>${esc(row.platform)}</dd>
        <dt>Duration</dt><dd>${esc(row.durationMinutes)} min</dd>
        <dt>AI cost est.</dt><dd>${esc(fmt().eur?.(row.costEstimateEur) || row.costEstimateEur)}</dd>
        <dt>Status</dt><dd>${esc(row.status)}</dd>
        <dt>Created</dt><dd>${esc(fmt().date?.(row.createdAt) || row.createdAt)}</dd>
        <dt>Source</dt><dd>${row.sourceUrl ? `<a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener">${esc(row.sourceUrl)}</a>` : '—'}</dd>
      </dl>
      <h4>Title / context</h4>
      <p>${esc(row.title)}</p>
      <h4>Metadata</h4>
      <pre class="usage-drawer-pre">${esc(JSON.stringify(meta, null, 2))}</pre>
      ${meta.summary ? `<h4>Summary preview</h4><pre class="usage-drawer-pre">${esc(String(meta.summary).slice(0, 1200))}</pre>` : ''}
      ${meta.transcript ? `<h4>Transcript preview</h4><pre class="usage-drawer-pre">${esc(String(meta.transcript).slice(0, 1200))}</pre>` : ''}
    `;
    drawer.hidden = false;
    drawer.removeAttribute('aria-hidden');
  }

  function closeDrawer() {
    const drawer = document.getElementById('usageDetailDrawer');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }

  function collectFiltersFromDom() {
    state.search = document.getElementById('usageSearchInput')?.value?.trim() || '';
    state.type = document.getElementById('usageTypeSelect')?.value || 'all';
    state.platform = document.getElementById('usagePlatformSelect')?.value || 'all';
    state.plan = document.getElementById('usagePlanSelect')?.value || 'all';
    const c = document.getElementById('usageCountryInput')?.value?.trim().toUpperCase() || '';
    state.country = c.length === 2 ? c : 'all';
    state.startDate = document.getElementById('usageStartInput')?.value || '';
    state.endDate = document.getElementById('usageEndInput')?.value || '';
    state.sort = document.getElementById('usageSortSelect')?.value || 'created_at';
    state.sortDir = document.querySelector('[data-sort-dir].active')?.getAttribute('data-sort-dir') || state.sortDir || 'desc';
  }

  function bindWorkspaceEvents() {
    document.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.preset = btn.getAttribute('data-preset') || 'all';
        state.page = 1;
        const custom = document.getElementById('usageCustomDates');
        if (custom) custom.classList.toggle('is-visible', state.preset === 'custom');
        document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.preset !== 'custom') load();
      });
    });
    document.getElementById('usageSearchInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        collectFiltersFromDom();
        state.page = 1;
        load();
      }
    });
    document.getElementById('usageApplyBtn')?.addEventListener('click', () => {
      collectFiltersFromDom();
      state.page = 1;
      load();
    });
    document.getElementById('usageResetBtn')?.addEventListener('click', () => {
      Object.assign(state, {
        preset: 'all',
        startDate: '',
        endDate: '',
        type: 'all',
        platform: 'all',
        plan: 'all',
        country: 'all',
        search: '',
        page: 1,
        sort: 'created_at',
        sortDir: 'desc'
      });
      load();
    });
    document.getElementById('usagePrevPage')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        load({ fullRender: false });
      }
    });
    document.getElementById('usageNextPage')?.addEventListener('click', () => {
      if (state.page < (state.data?.totalPages || 1)) {
        state.page += 1;
        load({ fullRender: false });
      }
    });
    document.getElementById('usageSortSelect')?.addEventListener('change', () => {
      state.sort = document.getElementById('usageSortSelect')?.value || 'created_at';
      load({ fullRender: false });
    });
    document.querySelectorAll('[data-sort-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.sortDir = btn.getAttribute('data-sort-dir') || 'desc';
        document.querySelectorAll('[data-sort-dir]').forEach((b) => b.classList.toggle('active', b === btn));
        load({ fullRender: false });
      });
    });
    document.querySelectorAll('.usage-table-scroll tbody tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = tr.getAttribute('data-id');
        const row = (state.data?.activities || []).find((r) => String(r.id) === String(id));
        if (row) openDrawer(row);
      });
    });
    document.getElementById('usageDrawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('usageDrawerBackdrop')?.addEventListener('click', closeDrawer);
  }

  function exportCsv() {
    const rows = state.data?.activities || [];
    if (!rows.length) return;
    const header = ['email', 'plan', 'country', 'type', 'platform', 'minutes', 'cost_eur', 'export', 'status', 'created_at'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.email,
          r.plan,
          r.country,
          r.type,
          r.platform,
          r.durationMinutes,
          r.costEstimateEur,
          r.exportType,
          r.status,
          r.createdAt
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cutup-usage-${state.preset}-${Date.now()}.csv`;
    a.click();
  }

  async function fetchData() {
    return apiGet('usage', {
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      type: state.type,
      platform: state.platform,
      plan: state.plan,
      country: state.country,
      search: state.search,
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      sortDir: state.sortDir
    });
  }

  function highlightNewRows(rows) {
    if (!state.lastTopId || !rows.length) return;
    const top = String(rows[0].id);
    if (top !== state.lastTopId) {
      document.querySelector('.usage-table-scroll tbody tr')?.classList.add('usage-row-new');
    }
    state.lastTopId = top;
  }

  function logUsageDebug(data, label) {
    const dbg = data?.debug || {};
    console.debug('[Cutup Usage]', label, {
      rowsFetched: (data?.activities || []).length,
      totalFiltered: data?.total ?? 0,
      chartTimelinePoints: data?.analytics?.timeline?.length ?? 0,
      chartFeatureBuckets: data?.analytics?.breakdowns?.byFeature
        ? Object.values(data.analytics.breakdowns.byFeature).reduce((a, b) => a + Number(b || 0), 0)
        : 0,
      widgetsFailed: data?.analytics?._widgetErrors || dbg.widgetsFailed || [],
      preset: state.preset,
      ...dbg
    });
  }

  function buildWorkspaceHtml(data, activities, total, page, totalPages) {
    const analytics = data.analytics;
    const parts = [renderFilters()];

    if (data.insights?.length) {
      parts.push(renderInsights(data.insights));
    }

    if (analytics?.kpis) {
      parts.push(renderKpis(analytics.kpis));
    } else if (activities.length) {
      parts.push(
        '<p class="usage-partial-note metric-subtle">Summary metrics are temporarily unavailable; your usage history is shown below.</p>'
      );
    }

    if (analytics) {
      parts.push(renderCharts(analytics));
    }

    parts.push(renderTable(activities, total, page, totalPages));

    if (!activities.length && total === 0) {
      parts.push(
        '<p class="usage-empty">No usage events match the current filters. Try <strong>All time</strong> or clear filters.</p>'
      );
    }

    return { html: parts.join(''), analytics };
  }

  function paintWorkspace(root, data, activities, total, page, totalPages) {
    const { html, analytics } = buildWorkspaceHtml(data, activities, total, page, totalPages);
    root.classList.remove('usage-skeleton');
    root.innerHTML = html;
    bindWorkspaceEvents();
    highlightNewRows(activities);
    if (analytics && typeof Chart !== 'undefined') {
      try {
        requestAnimationFrame(() => window.CutupUsageCharts?.renderAll?.(analytics));
      } catch (chartErr) {
        console.warn('[Cutup Usage] charts failed', chartErr);
      }
    }
  }

  async function load(opts = {}) {
    const options = typeof opts === 'boolean' ? { fullRender: opts } : opts;
    const { fullRender = true, silent = false } = options;

    const root = document.getElementById('usageWorkspace');
    const legacyWrap = document.getElementById('usageLegacyWrap');
    if (!root) return;

    if (silent && !state.hasRendered) {
      return load({ fullRender: true, silent: false });
    }

    if (state.refreshInFlight && silent) return;

    if (fullRender && !silent) {
      root.classList.add('usage-skeleton');
      root.innerHTML = '<div class="usage-kpi-grid"></div>';
      updateLiveStatus('syncing');
    } else if (silent) {
      updateLiveStatus('syncing');
    }

    writeUrlState();
    state.refreshInFlight = true;

    try {
      const data = await fetchData();
      const activities = normalizeRows(data.activities || []);
      const total = Number(data.total ?? activities.length);
      const page = Number(data.page || 1);
      const totalPages = Number(data.totalPages || 1);

      state.data = data;
      state.lastUpdatedAt = Date.now();
      state.lastRefreshError = null;
      state.hasRendered = true;

      logUsageDebug(data, silent ? 'refresh' : 'loaded');

      if (legacyWrap) legacyWrap.hidden = true;

      paintWorkspace(root, data, activities, total, page, totalPages);

      if (!activities.length && typeof renderUsageTable === 'function' && legacyWrap) {
        legacyWrap.hidden = false;
        const legacyRows = await apiGet('usage', { legacy: '1', limit: 300 });
        renderUsageTable(legacyRows.activities || []);
        console.debug('[Cutup Usage] legacy table fallback', (legacyRows.activities || []).length);
      }

      updateLiveStatus('ok');
    } catch (e) {
      state.lastRefreshError = e;
      if (silent && state.hasRendered) {
        console.warn('[Cutup Usage] background refresh failed', e);
        updateLiveStatus('error');
        return;
      }
      console.error('[Cutup Usage] load failed', e);
      root.classList.remove('usage-skeleton');
      if (state.hasRendered && state.data) {
        updateLiveStatus('error');
        return;
      }
      try {
        const legacyRows = await apiGet('usage', { legacy: '1', limit: 300 });
        root.innerHTML = `${renderFilters()}<p class="usage-partial-note">Analytics request failed; showing raw usage log.</p>`;
        bindWorkspaceEvents();
        state.hasRendered = true;
        state.lastUpdatedAt = Date.now();
        if (legacyWrap) {
          legacyWrap.hidden = false;
          renderUsageTable(legacyRows.activities || []);
        }
        updateLiveStatus('error');
      } catch (e2) {
        root.innerHTML = `<p class="usage-empty">Failed to load usage: ${esc(e.message || e2.message || 'error')}</p>`;
        updateLiveStatus('error');
      }
    } finally {
      state.refreshInFlight = false;
    }
  }

  function isUsageSectionActive() {
    return document.getElementById('section-usage')?.classList.contains('active');
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (!isUsageSectionActive()) return;
      load({ fullRender: false, silent: true });
    }, REFRESH_MS);
    if (!state.statusTickTimer) {
      state.statusTickTimer = setInterval(() => {
        if (!isUsageSectionActive() || !state.lastUpdatedAt) return;
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
    document.getElementById('usageExportCsvBtn')?.addEventListener('click', exportCsv);
    if (isUsageSectionActive()) startAutoRefresh();
  }

  initGlobal();

  return {
    load,
    readUrlState,
    startAutoRefresh,
    stopAutoRefresh,
    getState: () => ({ ...state })
  };
})();
