/**
 * Cutup Admin Payments fintech workspace
 */
window.CutupAdminPayments = (function () {
  const SEARCH_DEBOUNCE_MS = 320;
  const REFRESH_MS = 20000;
  const STATUS_TICK_MS = 1000;

  const PRESET_LABELS = {
    all: 'All time',
    today: 'Today',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
    custom: 'Custom'
  };

  const state = {
    preset: '30d',
    startDate: '',
    endDate: '',
    provider: 'all',
    status: 'all',
    callbackStatus: 'all',
    plan: 'all',
    country: 'all',
    search: '',
    page: 1,
    pageSize: 50,
    failedOnly: false,
    retriesOnly: false,
    highValueOnly: false,
    sandboxOnly: false,
    liveOnly: false,
    minAmount: '',
    maxAmount: '',
    selected: new Set(),
    data: null,
    detailCache: new Map(),
    hasRendered: false,
    searchTimer: null,
    lastUpdatedAt: null,
    lastRefreshError: null,
    refreshTimer: null,
    statusTickTimer: null,
    refreshInFlight: false
  };

  const PROVIDER_META = {
    yekpay: { label: 'YekPay', icon: '🇮🇷', cls: 'pay-provider--yekpay', primary: true },
    stripe: { label: 'Stripe', icon: '💳', cls: 'pay-provider--stripe', primary: false }
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
      return esc(raw).replace(re, '<mark class="pay-mark">$1</mark>');
    } catch {
      return esc(raw);
    }
  }

  function sparkHtml(series) {
    const pts = series || [];
    if (!pts.length) return '';
    const max = Math.max(...pts.map((p) => Number(p.value) || 0), 1);
    return `<div class="pay-kpi-spark">${pts
      .map((p) => {
        const v = Number(p.value) || 0;
        const h = Math.max(4, Math.round((v / max) * 100));
        return `<span style="height:${h}%" title="${esc(p.day || '')}"></span>`;
      })
      .join('')}</div>`;
  }

  function persistableState() {
    return {
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      provider: state.provider,
      status: state.status,
      callbackStatus: state.callbackStatus,
      plan: state.plan,
      country: state.country,
      search: state.search,
      page: state.page,
      pageSize: state.pageSize,
      failedOnly: state.failedOnly,
      retriesOnly: state.retriesOnly,
      highValueOnly: state.highValueOnly,
      sandboxOnly: state.sandboxOnly,
      liveOnly: state.liveOnly,
      minAmount: state.minAmount,
      maxAmount: state.maxAmount
    };
  }

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('payments');
    if (saved) {
      Object.assign(state, persistableState(), saved);
      state.selected = new Set();
      state.detailCache = new Map();
      return;
    }
    const p = new URLSearchParams(window.location.search);
    if (p.get('payPreset')) state.preset = p.get('payPreset');
    if (p.get('paySearch')) state.search = p.get('paySearch') || '';
    if (p.get('payProvider')) state.provider = p.get('payProvider');
    if (p.get('payStatus')) state.status = p.get('payStatus');
    if (p.get('payCallback')) state.callbackStatus = p.get('payCallback');
    if (p.get('payPlan')) state.plan = p.get('payPlan');
    if (p.get('payCountry')) state.country = p.get('payCountry');
    if (p.get('payPage')) state.page = Number(p.get('payPage')) || 1;
    if (p.get('payStart')) state.startDate = p.get('payStart') || '';
    if (p.get('payEnd')) state.endDate = p.get('payEnd') || '';
    state.failedOnly = p.get('payFailed') === '1';
    state.retriesOnly = p.get('payRetries') === '1';
    state.highValueOnly = p.get('payHigh') === '1';
    state.sandboxOnly = p.get('paySandbox') === '1';
    state.liveOnly = p.get('payLive') === '1';
    if (p.get('payMin')) state.minAmount = p.get('payMin') || '';
    if (p.get('payMax')) state.maxAmount = p.get('payMax') || '';
    writeUrlState();
  }

  function writeUrlState() {
    window.CutupAdminFilterState?.saveAdminFilterState?.('payments', persistableState());
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
    const el = document.getElementById('paymentsLiveStatus');
    const updatedEl = document.getElementById('paymentsLiveUpdated');
    if (!el) return;
    el.classList.remove('pay-live-status--syncing', 'pay-live-status--error');
    if (phase === 'syncing') el.classList.add('pay-live-status--syncing');
    if (phase === 'error') el.classList.add('pay-live-status--error');
    if (updatedEl) {
      if (phase === 'syncing') updatedEl.textContent = 'Syncing…';
      else if (phase === 'error') updatedEl.textContent = 'Update failed';
      else updatedEl.textContent = state.lastUpdatedAt ? `Updated ${formatUpdatedAgo(state.lastUpdatedAt)}` : 'Loading…';
    }
  }

  function activeChips() {
    const chips = [];
    if (state.preset !== '30d') chips.push(`Period: ${state.preset}`);
    if (state.provider !== 'all') chips.push(`Gateway: ${state.provider}`);
    if (state.status !== 'all') chips.push(`Status: ${state.status}`);
    if (state.callbackStatus !== 'all') chips.push(`Callback: ${state.callbackStatus}`);
    if (state.plan !== 'all') chips.push(`Plan: ${state.plan}`);
    if (state.country !== 'all') chips.push(`Country: ${state.country}`);
    if (state.search) chips.push(`Search: ${state.search}`);
    if (state.failedOnly) chips.push('Failed only');
    if (state.retriesOnly) chips.push('Retries');
    if (state.highValueOnly) chips.push('High value');
    if (state.sandboxOnly) chips.push('Sandbox');
    if (state.liveOnly) chips.push('Live only');
    if (state.minAmount) chips.push(`Min €${state.minAmount}`);
    if (state.maxAmount) chips.push(`Max €${state.maxAmount}`);
    return chips;
  }

  function providerBadge(provider) {
    const key = String(provider || 'yekpay').toLowerCase();
    const m = PROVIDER_META[key] || { label: key, icon: '💳', cls: 'pay-provider--yekpay' };
    return `<span class="pay-provider-badge ${m.cls}">${m.icon} ${esc(m.label)}</span>`;
  }

  function statusPill(status) {
    const s = String(status || 'unknown').toLowerCase();
    const cls =
      s === 'success'
        ? 'pay-status--success'
        : s === 'pending'
          ? 'pay-status--pending'
          : s === 'canceled'
            ? 'pay-status--canceled'
            : 'pay-status--failed';
    return `<span class="pay-status-pill ${cls}">${esc(s)}</span>`;
  }

  function callbackPill(cb) {
    const s = String(cb || 'unknown').toLowerCase();
    const cls =
      s === 'verified' || s === 'success'
        ? 'pay-status--success'
        : s === 'pending'
          ? 'pay-status--pending'
          : 'pay-status--failed';
    return `<span class="pay-status-pill ${cls}" title="Callback">${esc(s)}</span>`;
  }

  function healthBadge(health) {
    const h = String(health || 'attention').toLowerCase();
    const cls = h === 'healthy' || h === 'ok' ? 'pay-health--ok' : h === 'degraded' ? 'pay-health--warn' : 'pay-health--warn';
    const label = h === 'healthy' ? 'Healthy' : h === 'degraded' ? 'Degraded' : 'Needs attention';
    return `<span class="pay-health ${cls}"><span class="pay-health-dot" aria-hidden="true"></span>${esc(label)}</span>`;
  }

  function renderInfrastructure(infra) {
    if (!infra?.primary) return '';
    const yek = infra.primary;
    const optional = infra.optionalGateways || [];
    const optionalHtml = optional.length
      ? `<details class="pay-optional-gateways">
          <summary>Optional gateways (${optional.length})</summary>
          <div class="pay-infra-grid" style="margin-top:12px">
            ${optional
              .map(
                (g) => `
              <div class="pay-infra-item">
                <span class="lbl">${esc(g.label || g.provider)}</span>
                <span>${g.configured ? 'Configured' : 'Not configured'}${g.webhookConfigured != null ? ` · Webhook ${g.webhookConfigured ? 'OK' : 'missing'}` : ''}</span>
                ${g.note ? `<span class="muted" style="display:block;font-size:12px;margin-top:4px">${esc(g.note)}</span>` : ''}
              </div>`
              )
              .join('')}
          </div>
        </details>`
      : '';

    return `
      <article class="pay-infra-card pay-infra-card--primary">
        <header class="pay-infra-head">
          <h3 class="pay-infra-title">${providerBadge('yekpay')} Primary gateway</h3>
          ${healthBadge(yek.callbackHealth)}
        </header>
        <div class="pay-infra-grid">
          <div class="pay-infra-item"><span class="lbl">Environment</span><span>${esc(yek.environment || (yek.sandboxMode ? 'sandbox' : 'production'))}</span></div>
          <div class="pay-infra-item"><span class="lbl">Merchant</span><span>${yek.merchantConfigured ? 'Configured' : 'Missing'}</span></div>
          <div class="pay-infra-item"><span class="lbl">FX (EUR→IRR)</span><span>${yek.eurToIrrConfigured ? esc(String(yek.eurToIrrRate || 'configured')) : 'Rate missing'}</span></div>
          <div class="pay-infra-item"><span class="lbl">24h success</span><span>${fmt().num(yek.success24h)}</span></div>
          <div class="pay-infra-item"><span class="lbl">24h failed</span><span>${fmt().num(yek.failed24h)}</span></div>
          <div class="pay-infra-item"><span class="lbl">Pending now</span><span>${fmt().num(yek.pendingNow)}</span></div>
          <div class="pay-infra-item"><span class="lbl">Last success</span><span>${yek.lastSuccessAt ? fmt().date(yek.lastSuccessAt) : '—'}</span></div>
          ${yek.callbackUrl ? `<div class="pay-infra-item"><span class="lbl">Callback URL</span><span class="truncate-link">${esc(yek.callbackUrl)}</span></div>` : ''}
        </div>
        ${optionalHtml}
      </article>`;
  }

  function renderInsightsBlock(insights) {
    if (!insights?.length) return '';
    return `<div class="pay-insights">${insights
      .map(
        (i) =>
          `<div class="pay-insight pay-insight--${esc(i.tone || 'neutral')}"><span aria-hidden="true">●</span> ${esc(i.text)}</div>`
      )
      .join('')}</div>`;
  }

  function renderKpis(kpis) {
    if (!kpis) return '';
    const f = fmt();
    const spark = sparkHtml(kpis.sparkline);
    const cards = [
      ['Gross revenue', f.eur(kpis.totalRevenueEur), kpis.trends?.totalRevenueEur, spark],
      ['Net revenue', f.eur(kpis.netRevenueEur), null, ''],
      ['Successful', f.num(kpis.successfulPayments), kpis.trends?.successfulPayments, ''],
      ['Failed', f.num(kpis.failedPayments), null, ''],
      ['Canceled', f.num(kpis.canceledPayments), null, ''],
      ['Pending', f.num(kpis.pendingPayments), null, ''],
      ['Conversion', `${f.num(kpis.conversionRate, 1)}%`, kpis.trends?.conversionRate, ''],
      ['Avg order', f.eur(kpis.avgOrderValue), null, ''],
      ['MRR (est.)', f.eur(kpis.mrr), null, ''],
      ['Active subs', f.num(kpis.activeSubscribers), null, ''],
      ['Churn risk (7d)', f.num(kpis.churnRisk), null, ''],
      ['Retry recovery', f.num(kpis.retryRecovery), null, ''],
      ['YekPay success', kpis.gatewaySuccessRate != null ? `${f.num(kpis.gatewaySuccessRate, 1)}%` : '—', null, '']
    ];
    return `<div class="pay-kpi-grid">${cards
      .map(
        ([label, val, trend, extra]) =>
          `<article class="pay-kpi-card"><div class="pay-kpi-label">${esc(label)}</div><div class="pay-kpi-value">${esc(String(val))}</div>${trend != null ? f.trendHtml(trend) || '' : ''}${extra || ''}</article>`
      )
      .join('')}</div>`;
  }

  function renderCharts(analytics) {
    if (!analytics?.timeline?.length && !analytics?.funnel && !analytics?.breakdowns) {
      return '<p class="pay-partial-note">Charts populate as payment volume grows.</p>';
    }
    return `
      <div class="pay-charts-row">
        <article class="pay-chart-card"><h3>Revenue over time</h3><div class="pay-chart-wrap"><canvas id="payChartRevenue"></canvas></div></article>
        <article class="pay-chart-card"><h3>Checkout funnel</h3><div class="pay-chart-wrap"><canvas id="payChartFunnel"></canvas></div></article>
      </div>
      <div class="pay-charts-row">
        <article class="pay-chart-card"><h3>Gateway performance</h3><div class="pay-chart-wrap"><canvas id="payChartGateway"></canvas></div></article>
        <article class="pay-chart-card"><h3>Revenue by plan</h3><div class="pay-chart-wrap"><canvas id="payChartPlans"></canvas></div></article>
      </div>`;
  }

  function renderFilters() {
    const chips = activeChips();
    const customVisible = state.preset === 'custom';
    return `
      <div class="pay-filters-sticky">
        <div class="pay-filters-card">
          <div class="pay-filters-period">
            <div class="pay-filters-period-main">
              <span class="pay-filters-label">Time range</span>
              <div class="pay-segment" role="group" aria-label="Date preset">
                ${['all', 'today', '7d', '30d', '90d', 'custom']
                  .map((p) => {
                    const label = PRESET_LABELS[p] || p;
                    return `<button type="button" data-pay-preset="${p}" class="${state.preset === p ? 'active' : ''}">${label}</button>`;
                  })
                  .join('')}
              </div>
            </div>
            <div id="payCustomDates" class="pay-filters-custom${customVisible ? ' is-visible' : ''}">
              <label class="pay-filter-field pay-filter-field--date">
                <span>From</span>
                <input type="date" id="payStartInput" class="pay-filter-input" value="${esc(state.startDate)}" />
              </label>
              <label class="pay-filter-field pay-filter-field--date">
                <span>To</span>
                <input type="date" id="payEndInput" class="pay-filter-input" value="${esc(state.endDate)}" />
              </label>
            </div>
          </div>
          <div class="pay-filters-quick">
            <span class="pay-filters-label">Quick view</span>
            <div class="pay-segment pay-segment--compact" role="group" aria-label="Payment status quick filter">
              ${[
                ['all', 'All'],
                ['success', 'Successful'],
                ['failed', 'Failed'],
                ['canceled', 'Canceled'],
                ['pending', 'Pending']
              ]
                .map(
                  ([value, label]) =>
                    `<button type="button" data-pay-quick-status="${value}" class="${state.status === value ? 'active' : ''}">${label}</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="pay-filters-grid">
            <label class="pay-filter-field pay-filter-field--search">
              <span>Search</span>
              <input type="search" id="paySearchInput" class="pay-filter-input" placeholder="Email, authority, ref ID, payment ID…" value="${esc(state.search)}" autocomplete="off" />
            </label>
            <label class="pay-filter-field">
              <span>Gateway</span>
              <select id="payProviderSelect" class="pay-filter-input" aria-label="Provider">
                <option value="all">All gateways</option>
                <option value="yekpay"${state.provider === 'yekpay' ? ' selected' : ''}>YekPay</option>
                <option value="stripe"${state.provider === 'stripe' ? ' selected' : ''}>Stripe</option>
              </select>
            </label>
            <label class="pay-filter-field">
              <span>Status</span>
              <select id="payStatusSelect" class="pay-filter-input" aria-label="Status">
                <option value="all">All statuses</option>
                <option value="success"${state.status === 'success' ? ' selected' : ''}>Success</option>
                <option value="failed"${state.status === 'failed' ? ' selected' : ''}>Failed</option>
                <option value="pending"${state.status === 'pending' ? ' selected' : ''}>Pending</option>
                <option value="canceled"${state.status === 'canceled' ? ' selected' : ''}>Canceled</option>
              </select>
            </label>
            <label class="pay-filter-field">
              <span>Callback</span>
              <select id="payCallbackSelect" class="pay-filter-input" aria-label="Callback">
                <option value="all">All callbacks</option>
                <option value="success"${state.callbackStatus === 'success' ? ' selected' : ''}>Verified</option>
                <option value="pending"${state.callbackStatus === 'pending' ? ' selected' : ''}>Pending</option>
                <option value="failed"${state.callbackStatus === 'failed' ? ' selected' : ''}>Failed</option>
              </select>
            </label>
            <label class="pay-filter-field">
              <span>Plan</span>
              <select id="payPlanSelect" class="pay-filter-input" aria-label="Plan">
                <option value="all">All plans</option>
                <option value="free"${state.plan === 'free' ? ' selected' : ''}>Free</option>
                <option value="starter"${state.plan === 'starter' ? ' selected' : ''}>Starter</option>
                <option value="pro"${state.plan === 'pro' ? ' selected' : ''}>Pro</option>
                <option value="business"${state.plan === 'business' ? ' selected' : ''}>Business</option>
              </select>
            </label>
            <label class="pay-filter-field">
              <span>Country</span>
              <input type="text" id="payCountryInput" class="pay-filter-input" placeholder="ISO code" value="${state.country !== 'all' ? esc(state.country) : ''}" maxlength="2" />
            </label>
            <label class="pay-filter-field">
              <span>Min amount</span>
              <input type="number" id="payMinInput" class="pay-filter-input" placeholder="€" value="${esc(state.minAmount)}" min="0" step="0.01" />
            </label>
            <label class="pay-filter-field">
              <span>Max amount</span>
              <input type="number" id="payMaxInput" class="pay-filter-input" placeholder="€" value="${esc(state.maxAmount)}" min="0" step="0.01" />
            </label>
          </div>
          <div class="pay-filters-toggles">
            <label class="pay-check"><input type="checkbox" id="payFailedOnly"${state.failedOnly ? ' checked' : ''} /> Failed &amp; canceled</label>
            <label class="pay-check"><input type="checkbox" id="payRetriesOnly"${state.retriesOnly ? ' checked' : ''} /> Retries only</label>
            <label class="pay-check"><input type="checkbox" id="payHighOnly"${state.highValueOnly ? ' checked' : ''} /> High value (€50+)</label>
            <label class="pay-check"><input type="checkbox" id="paySandboxOnly"${state.sandboxOnly ? ' checked' : ''} /> Sandbox</label>
            <label class="pay-check"><input type="checkbox" id="payLiveOnly"${state.liveOnly ? ' checked' : ''} /> Live only</label>
          </div>
          <div class="pay-filters-footer">
            ${chips.length ? `<div class="pay-chips">${chips.map((c) => `<span class="pay-chip">${esc(c)}</span>`).join('')}</div>` : '<span class="pay-filters-hint">Filter by gateway, status, callback verification, plan, and amount range.</span>'}
            <div class="pay-filters-actions">
              <button type="button" class="btn ghost" id="payResetBtn">Reset</button>
              <button type="button" class="btn" id="payApplyBtn">Apply filters</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderTxCard(row) {
    const q = state.search;
    const checked = state.selected.has(String(row.id)) ? 'checked' : '';
    return `
      <article class="pay-tx" data-id="${esc(row.id)}" tabindex="0">
        <label class="pay-check" onclick="event.stopPropagation()" style="margin-right:4px">
          <input type="checkbox" class="pay-row-select" data-id="${esc(row.id)}" ${checked} />
        </label>
        <div class="pay-tx-avatar" title="${esc(row.email)}">${initials(row.email)}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
            <strong>${highlight(row.email, q)}</strong>
            <strong>${fmt().eur(row.amountEur)}</strong>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;align-items:center">
            ${providerBadge(row.provider)}
            ${statusPill(row.status)}
            ${callbackPill(row.callbackStatus)}
            <span class="pay-chip">${esc(fmt().planLabel(row.plan))}</span>
            ${row.attemptCount > 1 ? `<span class="pay-chip">${row.attemptCount} attempts</span>` : ''}
          </div>
          <div class="pay-tx-meta">
            <span>${relativeTime(row.createdAt)}</span>
            <span>${esc(row.country || '—')}</span>
            ${row.authority ? `<span title="Authority">${highlight(String(row.authority).slice(0, 24), q)}</span>` : ''}
            ${row.refId ? `<span>Ref ${highlight(row.refId, q)}</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  function hasActiveFilters() {
    return (
      state.preset !== '30d' ||
      state.provider !== 'all' ||
      state.status !== 'all' ||
      state.callbackStatus !== 'all' ||
      state.plan !== 'all' ||
      state.country !== 'all' ||
      state.search ||
      state.failedOnly ||
      state.retriesOnly ||
      state.highValueOnly ||
      state.sandboxOnly ||
      state.liveOnly ||
      state.minAmount ||
      state.maxAmount
    );
  }

  function renderList(payments, total, page, totalPages) {
    const q = state.search;
    const emptyBody = !payments.length
      ? `<div class="pay-empty pay-empty--inline">
          <div class="pay-empty-icon" aria-hidden="true">💳</div>
          <h3>${hasActiveFilters() || q ? 'No transactions match your filters' : 'No payments recorded yet'}</h3>
          <p>${
            hasActiveFilters() || q
              ? 'Try clearing search, widening the date range, or switching the status quick view.'
              : 'When customers complete checkout via YekPay, successful payments, pending authorizations, failures, and cancellations will appear here with full gateway context.'
          }</p>
        </div>`
      : `<div class="pay-tx-list">${payments.map(renderTxCard).join('')}</div>`;

    return `
      <div class="pay-table-card">
        <div id="payBulkBar" class="pay-bulk-bar"${state.selected.size ? '' : ' hidden'}>
          <span><strong>${state.selected.size}</strong> selected</span>
          <button type="button" class="btn ghost" data-bulk="export">Export CSV</button>
          <button type="button" class="btn ghost" data-bulk="lookup">User lookup</button>
          <button type="button" class="btn ghost" data-bulk="clear">Clear selection</button>
        </div>
        <div class="pay-table-toolbar">
          <div class="pay-table-toolbar-main">
            <h3 class="pay-table-title">Transactions</h3>
            <span class="pay-table-count">${fmt().num(total)} payments</span>
          </div>
          <label class="pay-check pay-table-select-all">
            <input type="checkbox" id="paySelectAll" /> Select page
          </label>
        </div>
        ${emptyBody}
        <div class="pay-pagination">
          <span class="pay-pagination-meta">
            Page <strong>${page}</strong> of <strong>${totalPages}</strong>
          </span>
          <div class="pay-pagination-actions">
            <button type="button" class="btn ghost" id="payPrevPage" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
            <button type="button" class="btn ghost" id="payNextPage" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
          </div>
        </div>
      </div>`;
  }

  function collectFiltersFromDom() {
    state.search = document.getElementById('paySearchInput')?.value?.trim() || '';
    state.provider = document.getElementById('payProviderSelect')?.value || 'all';
    state.status = document.getElementById('payStatusSelect')?.value || 'all';
    state.callbackStatus = document.getElementById('payCallbackSelect')?.value || 'all';
    state.plan = document.getElementById('payPlanSelect')?.value || 'all';
    const country = document.getElementById('payCountryInput')?.value?.trim().toUpperCase() || '';
    state.country = country ? country : 'all';
    state.failedOnly = Boolean(document.getElementById('payFailedOnly')?.checked);
    state.retriesOnly = Boolean(document.getElementById('payRetriesOnly')?.checked);
    state.highValueOnly = Boolean(document.getElementById('payHighOnly')?.checked);
    state.sandboxOnly = Boolean(document.getElementById('paySandboxOnly')?.checked);
    state.liveOnly = Boolean(document.getElementById('payLiveOnly')?.checked);
    state.minAmount = document.getElementById('payMinInput')?.value || '';
    state.maxAmount = document.getElementById('payMaxInput')?.value || '';
    state.startDate = document.getElementById('payStartInput')?.value || '';
    state.endDate = document.getElementById('payEndInput')?.value || '';
  }

  async function fetchData() {
    return apiGet('payments', {
      preset: state.preset,
      startDate: state.startDate,
      endDate: state.endDate,
      provider: state.provider,
      status: state.status,
      callbackStatus: state.callbackStatus,
      plan: state.plan,
      country: state.country,
      search: state.search,
      page: state.page,
      pageSize: state.pageSize,
      failedOnly: state.failedOnly ? '1' : '',
      retriesOnly: state.retriesOnly ? '1' : '',
      highValueOnly: state.highValueOnly ? '1' : '',
      sandboxOnly: state.sandboxOnly ? '1' : '',
      liveOnly: state.liveOnly ? '1' : '',
      minAmount: state.minAmount,
      maxAmount: state.maxAmount
    });
  }

  async function fetchDetail(id) {
    const key = String(id);
    if (state.detailCache.has(key)) return state.detailCache.get(key);
    const data = await apiGet('payment', { id: key });
    const detail = data.detail || data;
    state.detailCache.set(key, detail);
    return detail;
  }

  function buildDrawerHtml(detail) {
    const p = detail.payment || detail;
    const attempts = detail.attempts || [];
    const invoices = detail.invoices || [];
    const sub = detail.subscription;
    const timeline = detail.timeline || [];
    const fx = detail.fx || {};

    return `
      <div class="pay-drawer-section">
        <h4>${fmt().eur(p.amountEur)} · ${esc(fmt().planLabel(p.plan))}</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
          ${providerBadge(p.provider)}
          ${statusPill(p.status)}
          ${callbackPill(p.callbackStatus)}
        </div>
      </div>
      <div class="pay-infra-grid" style="margin:16px 0">
        <div class="pay-infra-item"><span class="lbl">User</span><span>${esc(p.email)}</span></div>
        <div class="pay-infra-item"><span class="lbl">Payment ID</span><span>${esc(p.id)}</span></div>
        <div class="pay-infra-item"><span class="lbl">Created</span><span>${fmt().date(p.createdAt)}</span></div>
        <div class="pay-infra-item"><span class="lbl">Paid</span><span>${p.paidAt ? fmt().date(p.paidAt) : '—'}</span></div>
        <div class="pay-infra-item"><span class="lbl">Country</span><span>${esc(p.country)}</span></div>
        <div class="pay-infra-item"><span class="lbl">Attempts</span><span>${esc(String(p.attemptCount || attempts.length))}</span></div>
        ${p.authority ? `<div class="pay-infra-item"><span class="lbl">Authority</span><span>${esc(p.authority)}</span></div>` : ''}
        ${p.refId ? `<div class="pay-infra-item"><span class="lbl">Ref ID</span><span>${esc(p.refId)}</span></div>` : ''}
      </div>
      ${fx.amountIrr != null ? `<p class="muted">FX: ${fmt().eur(fx.amountEur)} · ${fmt().num(fx.amountIrr)} IRR${fx.rate ? ` @ ${esc(String(fx.rate))}` : ''}</p>` : ''}
      ${
        sub
          ? `<details open><summary>Subscription</summary><p>${esc(sub.plan)} · ${esc(sub.status)}${sub.expiresAt ? ` · ends ${fmt().date(sub.expiresAt)}` : ''}</p></details>`
          : ''
      }
      <details><summary>Payment attempts (${attempts.length})</summary>
        <ul class="pay-timeline">${attempts.length ? attempts.map((a) => `<li>#${esc(String(a.attemptNumber))} ${esc(a.status)} · ${fmt().date(a.createdAt)}${a.errorMessage ? ` — ${esc(a.errorMessage)}` : ''}</li>`).join('') : '<li class="muted">No attempt rows</li>'}</ul>
      </details>
      <details><summary>Invoices (${invoices.length})</summary>
        <ul class="pay-timeline">${invoices.length ? invoices.map((i) => `<li>${esc(i.invoiceNumber || i.id)} · ${esc(i.status)} · ${fmt().eur(i.amount)}</li>`).join('') : '<li class="muted">No invoices</li>'}</ul>
      </details>
      <details open><summary>Timeline</summary>
        <ul class="pay-timeline">${timeline.length ? timeline.map((t) => `<li><strong>${esc(t.label)}</strong><br><span class="muted">${fmt().date(t.at)}</span>${t.detail ? `<br>${esc(t.detail)}` : ''}</li>`).join('') : '<li class="muted">No events</li>'}</ul>
      </details>
      <div class="pay-filter-bar" style="margin-top:16px">
        <button type="button" class="btn ghost" data-pay-action="mark_success">Mark success</button>
        <button type="button" class="btn ghost" data-pay-action="mark_resolved">Mark resolved (fail pending)</button>
      </div>`;
  }

  function openDrawer(row) {
    const drawer = document.getElementById('paymentsDetailDrawer');
    const body = document.getElementById('paymentsDrawerBody');
    if (!drawer || !body) return;
    drawer.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    body.innerHTML = '<p class="muted">Loading payment…</p>';
    body.dataset.paymentId = String(row.id);
    fetchDetail(row.id)
      .then((detail) => {
        if (!detail) throw new Error('Not found');
        body.innerHTML = buildDrawerHtml(detail);
        bindDrawerActions(body, row.id);
      })
      .catch((e) => {
        body.innerHTML = `<p class="pay-empty">Could not load payment: ${esc(e.message)}</p>`;
      });
  }

  function bindDrawerActions(body, paymentId) {
    body.querySelectorAll('[data-pay-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const op = btn.getAttribute('data-pay-action');
        if (!op || !window.confirm(`Run "${op}" on this payment?`)) return;
        try {
          await apiPost('paymentAction', { operation: op, paymentId: String(paymentId) });
          state.detailCache.delete(String(paymentId));
          if (typeof showBanner === 'function') showBanner('Payment updated');
          await load({ fullRender: false });
          openDrawer({ id: paymentId });
        } catch (e) {
          if (typeof showBanner === 'function') showBanner(e.message);
        }
      });
    });
  }

  function closeDrawer() {
    const drawer = document.getElementById('paymentsDetailDrawer');
    if (!drawer) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }

  function exportCsv(ids) {
    const rows = (state.data?.payments || []).filter((r) => ids.includes(String(r.id)));
    if (!rows.length) return;
    const header = [
      'id',
      'email',
      'plan',
      'provider',
      'status',
      'callback_status',
      'amount_eur',
      'country',
      'authority',
      'ref_id',
      'created_at'
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.id,
          r.email,
          r.plan,
          r.provider,
          r.status,
          r.callbackStatus,
          r.amountEur,
          r.country,
          r.authority,
          r.refId,
          r.createdAt
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cutup-payments-${Date.now()}.csv`;
    a.click();
  }

  async function runBulk(op) {
    const ids = [...state.selected];
    if (!ids.length) return;
    if (op === 'lookup') {
      const row = (state.data?.payments || []).find((r) => state.selected.has(String(r.id)));
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
    if (op === 'clear') {
      state.selected.clear();
      await load({ fullRender: false });
    }
  }

  function bindBulkEvents() {
    document.getElementById('payBulkBar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bulk]');
      if (!btn) return;
      const op = btn.getAttribute('data-bulk');
      runBulk(op).catch((err) => {
        if (typeof showBanner === 'function') showBanner(err.message);
      });
    });
  }

  function bindWorkspaceEvents() {
    document.querySelectorAll('[data-pay-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.preset = btn.getAttribute('data-pay-preset') || '30d';
        state.page = 1;
        const custom = document.getElementById('payCustomDates');
        if (custom) custom.classList.toggle('is-visible', state.preset === 'custom');
        document.querySelectorAll('[data-pay-preset]').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.preset !== 'custom') load();
      });
    });

    document.querySelectorAll('[data-pay-quick-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.status = btn.getAttribute('data-pay-quick-status') || 'all';
        state.page = 1;
        state.failedOnly = false;
        document.querySelectorAll('[data-pay-quick-status]').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
        const statusSelect = document.getElementById('payStatusSelect');
        if (statusSelect) statusSelect.value = state.status;
        load({ fullRender: false });
      });
    });

    const searchInput = document.getElementById('paySearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (state.searchTimer) clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(() => {
          collectFiltersFromDom();
          state.page = 1;
          load({ fullRender: false });
        }, SEARCH_DEBOUNCE_MS);
      });
    }

    document.getElementById('payApplyBtn')?.addEventListener('click', () => {
      collectFiltersFromDom();
      state.page = 1;
      load();
    });

    document.getElementById('payResetBtn')?.addEventListener('click', () => {
      Object.assign(state, persistableState(), {
        preset: '30d',
        startDate: '',
        endDate: '',
        provider: 'all',
        status: 'all',
        callbackStatus: 'all',
        plan: 'all',
        country: 'all',
        search: '',
        page: 1,
        failedOnly: false,
        retriesOnly: false,
        highValueOnly: false,
        sandboxOnly: false,
        liveOnly: false,
        minAmount: '',
        maxAmount: ''
      });
      state.selected.clear();
      load();
    });

    document.getElementById('payPrevPage')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page -= 1;
        load({ fullRender: false });
      }
    });
    document.getElementById('payNextPage')?.addEventListener('click', () => {
      if (state.page < (state.data?.totalPages || 1)) {
        state.page += 1;
        load({ fullRender: false });
      }
    });

    document.getElementById('paySelectAll')?.addEventListener('change', (e) => {
      const on = e.target.checked;
      (state.data?.payments || []).forEach((r) => {
        if (on) state.selected.add(String(r.id));
        else state.selected.delete(String(r.id));
      });
      load({ fullRender: false });
    });

    document.querySelectorAll('.pay-row-select').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-id');
        if (cb.checked) state.selected.add(id);
        else state.selected.delete(id);
        load({ fullRender: false });
      });
    });

    document.querySelectorAll('.pay-tx[data-id]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;
        const id = card.getAttribute('data-id');
        const row = (state.data?.payments || []).find((r) => String(r.id) === String(id));
        if (row) openDrawer(row);
      });
    });

    document.getElementById('paymentsDrawerClose')?.addEventListener('click', closeDrawer);
    document.getElementById('paymentsDrawerBackdrop')?.addEventListener('click', closeDrawer);
    bindBulkEvents();
  }

  function buildWorkspaceHtml(data, payments, total, page, totalPages) {
    const parts = [];
    if (data.infrastructure) parts.push(renderInfrastructure(data.infrastructure));
    parts.push(renderFilters());
    if (data.insights?.length) parts.push(renderInsightsBlock(data.insights));
    if (data.analytics?.kpis) parts.push(renderKpis(data.analytics.kpis));
    if (data.analytics) parts.push(renderCharts(data.analytics));
    parts.push(renderList(payments, total, page, totalPages));
    return parts.join('');
  }

  function paintWorkspace(root, data, payments, total, page, totalPages) {
    root.classList.remove('pay-skeleton');
    root.classList.add('pay-root');
    root.innerHTML = buildWorkspaceHtml(data, payments, total, page, totalPages);
    bindWorkspaceEvents();
    if (data.analytics && typeof Chart !== 'undefined') {
      requestAnimationFrame(() => window.CutupPayCharts?.renderAll?.(data.analytics));
    }
  }

  async function load(opts = {}) {
    const options = typeof opts === 'boolean' ? { fullRender: opts } : opts;
    const { fullRender = true, silent = false } = options;
    const root = document.getElementById('paymentsWorkspace');
    if (!root) return;

    if (silent && !state.hasRendered) {
      return load({ fullRender: true, silent: false });
    }
    if (state.refreshInFlight && silent) return;

    if (fullRender && !silent) {
      root.classList.add('pay-skeleton');
      root.innerHTML = '<div class="pay-kpi-grid"></div>';
      updateLiveStatus('syncing');
    } else if (silent) {
      updateLiveStatus('syncing');
    }

    writeUrlState();
    state.refreshInFlight = true;

    try {
      const data = await fetchData();
      state.data = data;
      const payments = data.payments || [];
      state.hasRendered = true;
      state.lastUpdatedAt = Date.now();
      state.lastRefreshError = null;
      paintWorkspace(root, data, payments, data.total || 0, data.page || 1, data.totalPages || 1);
      updateLiveStatus('ok');
    } catch (e) {
      state.lastRefreshError = e;
      if (silent && state.hasRendered) {
        console.warn('[Cutup Payments] refresh failed', e);
        updateLiveStatus('error');
        return;
      }
      root.classList.remove('pay-skeleton');
      if (state.hasRendered && state.data) {
        updateLiveStatus('error');
        return;
      }
      try {
        const legacy = await apiGet('payments', {
          legacy: '1',
          startDate: state.startDate,
          endDate: state.endDate,
          plan: state.plan,
          status: state.status
        });
        const payments = (legacy.payments || []).map((p) => ({
          id: p.id,
          email: p.email,
          plan: p.plan || 'free',
          provider: 'yekpay',
          status: p.status,
          callbackStatus: p.status,
          amountEur: Number(p.amount_eur || 0),
          country: '—',
          authority: '',
          refId: '',
          createdAt: p.created_at
        }));
        state.data = { payments, total: payments.length, page: 1, totalPages: 1, insights: [], analytics: null };
        state.hasRendered = true;
        state.lastUpdatedAt = Date.now();
        root.classList.add('pay-root');
        root.innerHTML = `${renderFilters()}<p class="pay-partial-note">Dashboard API unavailable — showing simplified legacy list.</p>${renderList(payments, payments.length, 1, 1)}`;
        bindWorkspaceEvents();
        updateLiveStatus('error');
      } catch (e2) {
        root.innerHTML = `<div class="pay-empty"><h3>Failed to load payments</h3><p>${esc(e.message || e2.message)}</p></div>`;
        updateLiveStatus('error');
      }
    } finally {
      state.refreshInFlight = false;
    }
  }

  function isPaymentsSectionActive() {
    return document.getElementById('section-payments')?.classList.contains('active');
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(() => {
      if (!isPaymentsSectionActive()) return;
      load({ fullRender: false, silent: true });
    }, REFRESH_MS);
    if (!state.statusTickTimer) {
      state.statusTickTimer = setInterval(() => {
        if (!isPaymentsSectionActive() || !state.lastUpdatedAt) return;
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
    document.getElementById('paymentsExportCsvBtn')?.addEventListener('click', () => {
      const ids = state.selected.size
        ? [...state.selected]
        : (state.data?.payments || []).map((r) => String(r.id));
      exportCsv(ids);
    });
    if (isPaymentsSectionActive()) startAutoRefresh();
  }

  initGlobal();

  return { load, readUrlState, startAutoRefresh, stopAutoRefresh, getState: () => ({ ...state }) };
})();
