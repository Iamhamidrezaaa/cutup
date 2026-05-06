/**
 * Cutup Admin Payments fintech workspace
 */
window.CutupAdminPayments = (function () {
  const SEARCH_DEBOUNCE_MS = 320;

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
    searchTimer: null
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

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('payments');
    if (saved) {
      Object.assign(state, saved);
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
    window.CutupAdminFilterState?.saveAdminFilterState?.('payments', { ...state });
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
      s === 'success' ? 'pay-status--success' : s === 'pending' ? 'pay-status--pending' : 'pay-status--failed';
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
    return `
      <div class="pay-filters-sticky">
        <div class="pay-filter-bar">
          <input type="search" id="paySearchInput" class="pay-search" placeholder="Email, authority, ref ID, payment ID…" value="${esc(state.search)}" autocomplete="off" />
          <div class="pay-segment" role="group" aria-label="Date preset">
            ${['all', 'today', '7d', '30d', '90d', 'custom']
              .map((p) => {
                const label =
                  p === 'all'
                    ? 'All'
                    : p === 'today'
                      ? 'Today'
                      : p === '7d'
                        ? '7d'
                        : p === '30d'
                          ? '30d'
                          : p === '90d'
                            ? '90d'
                            : 'Custom';
                return `<button type="button" data-pay-preset="${p}" class="${state.preset === p ? 'active' : ''}">${label}</button>`;
              })
              .join('')}
          </div>
          <select id="payProviderSelect" class="pay-select" aria-label="Provider">
            <option value="all">All gateways</option>
            <option value="yekpay"${state.provider === 'yekpay' ? ' selected' : ''}>YekPay</option>
            <option value="stripe"${state.provider === 'stripe' ? ' selected' : ''}>Stripe</option>
          </select>
          <select id="payStatusSelect" class="pay-select" aria-label="Status">
            <option value="all">All statuses</option>
            <option value="success"${state.status === 'success' ? ' selected' : ''}>Success</option>
            <option value="failed"${state.status === 'failed' ? ' selected' : ''}>Failed</option>
            <option value="pending"${state.status === 'pending' ? ' selected' : ''}>Pending</option>
            <option value="canceled"${state.status === 'canceled' ? ' selected' : ''}>Canceled</option>
          </select>
          <select id="payCallbackSelect" class="pay-select" aria-label="Callback">
            <option value="all">All callbacks</option>
            <option value="success"${state.callbackStatus === 'success' ? ' selected' : ''}>Verified</option>
            <option value="pending"${state.callbackStatus === 'pending' ? ' selected' : ''}>Pending</option>
            <option value="failed"${state.callbackStatus === 'failed' ? ' selected' : ''}>Failed</option>
          </select>
          <select id="payPlanSelect" class="pay-select" aria-label="Plan">
            <option value="all">All plans</option>
            <option value="free"${state.plan === 'free' ? ' selected' : ''}>Free</option>
            <option value="starter"${state.plan === 'starter' ? ' selected' : ''}>Starter</option>
            <option value="pro"${state.plan === 'pro' ? ' selected' : ''}>Pro</option>
            <option value="business"${state.plan === 'business' ? ' selected' : ''}>Business</option>
          </select>
          <input type="text" id="payCountryInput" class="pay-select" placeholder="Country (ISO)" value="${state.country !== 'all' ? esc(state.country) : ''}" maxlength="2" />
          <input type="number" id="payMinInput" class="pay-select" placeholder="Min €" value="${esc(state.minAmount)}" min="0" step="0.01" style="width:90px" />
          <input type="number" id="payMaxInput" class="pay-select" placeholder="Max €" value="${esc(state.maxAmount)}" min="0" step="0.01" style="width:90px" />
          <label class="pay-check"><input type="checkbox" id="payFailedOnly"${state.failedOnly ? ' checked' : ''} /> Failed</label>
          <label class="pay-check"><input type="checkbox" id="payRetriesOnly"${state.retriesOnly ? ' checked' : ''} /> Retries</label>
          <label class="pay-check"><input type="checkbox" id="payHighOnly"${state.highValueOnly ? ' checked' : ''} /> High value</label>
          <label class="pay-check"><input type="checkbox" id="paySandboxOnly"${state.sandboxOnly ? ' checked' : ''} /> Sandbox</label>
          <label class="pay-check"><input type="checkbox" id="payLiveOnly"${state.liveOnly ? ' checked' : ''} /> Live</label>
          <span id="payCustomDates" style="${state.preset === 'custom' ? '' : 'display:none'}">
            <input type="date" id="payStartInput" value="${esc(state.startDate)}" />
            <input type="date" id="payEndInput" value="${esc(state.endDate)}" />
          </span>
          <button type="button" class="btn" id="payApplyBtn">Apply</button>
          <button type="button" class="btn ghost" id="payResetBtn">Reset</button>
        </div>
        ${chips.length ? `<div class="pay-chips">${chips.map((c) => `<span class="pay-chip">${esc(c)}</span>`).join('')}</div>` : ''}
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

  function renderList(payments, total, page, totalPages) {
    const q = state.search;
    if (!payments.length) {
      return `
        <div class="pay-empty">
          <div style="font-size:40px;margin-bottom:12px" aria-hidden="true">💳</div>
          <h3>No transactions in this view</h3>
          <p>Successful checkouts, pending authorizations, and failed attempts appear here with gateway and callback context.</p>
          ${q ? '<p class="muted">Try clearing search or widening the date range.</p>' : '<p class="muted">Revenue charts and YekPay health update as volume grows.</p>'}
        </div>`;
    }
    return `
      <div id="payBulkBar" class="pay-filter-bar" style="margin-bottom:8px${state.selected.size ? '' : ';display:none'}">
        ${state.selected.size ? `<span><strong>${state.selected.size}</strong> selected</span>
        <button type="button" class="btn ghost" data-bulk="export">Export CSV</button>
        <button type="button" class="btn ghost" data-bulk="lookup">User lookup</button>
        <button type="button" class="btn ghost" data-bulk="clear">Clear</button>` : ''}
      </div>
      <div class="pay-filter-bar" style="margin-bottom:8px">
        <label class="pay-check"><input type="checkbox" id="paySelectAll" /> Select page</label>
        <span class="muted">${fmt().num(total)} payments · page ${page} / ${totalPages}</span>
      </div>
      <div class="pay-tx-list">${payments.map(renderTxCard).join('')}</div>
      <div class="pay-pagination">
        <button type="button" class="btn ghost" id="payPrevPage" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="btn ghost" id="payNextPage" ${page >= totalPages ? 'disabled' : ''}>Next</button>
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
        if (custom) custom.style.display = state.preset === 'custom' ? '' : 'none';
        document.querySelectorAll('[data-pay-preset]').forEach((b) => b.classList.toggle('active', b === btn));
        if (state.preset !== 'custom') load();
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
      Object.assign(state, {
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

    if (fullRender && !silent) {
      root.classList.add('pay-skeleton');
      root.innerHTML = '<div class="pay-kpi-grid"></div>';
    }

    writeUrlState();

    try {
      const data = await fetchData();
      state.data = data;
      const payments = data.payments || [];
      state.hasRendered = true;
      paintWorkspace(root, data, payments, data.total || 0, data.page || 1, data.totalPages || 1);
    } catch (e) {
      if (silent && state.hasRendered) {
        console.warn('[Cutup Payments] refresh failed', e);
        return;
      }
      root.classList.remove('pay-skeleton');
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
        root.classList.add('pay-root');
        root.innerHTML = `${renderFilters()}<p class="pay-partial-note">Dashboard API unavailable — showing simplified legacy list.</p>${renderList(payments, payments.length, 1, 1)}`;
        bindWorkspaceEvents();
      } catch (e2) {
        root.innerHTML = `<p class="pay-empty">Failed to load payments: ${esc(e.message || e2.message)}</p>`;
      }
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
  }

  initGlobal();

  return { load, readUrlState, getState: () => ({ ...state }) };
})();
