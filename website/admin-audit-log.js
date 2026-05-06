/**
 * Cutup Admin — Audit Log (security intelligence & forensic explorer)
 */
window.CutupAdminAuditLog = (function () {
  const LIVE_MS = 10_000;
  const PAGE_SIZE = 40;
  const INITIAL_TIMELINE = 18;
  const LOAD_MORE_STEP = 15;
  const COLLAPSE_EVENTS = new Set(['admin_login', 'page_view', 'heartbeat', 'ui_click']);

  const state = {
    preset: '24h',
    filters: {},
    page: 1,
    liveMode: false,
    liveTimer: null,
    ws: null,
    dashboard: null,
    events: [],
    timelineGroups: [],
    timelineVisible: INITIAL_TIMELINE,
    density: 'comfortable',
    collapseGroups: true,
    total: 0,
    journey: null,
    knownEventIds: new Set(),
    debounceTimer: null
  };

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function apiBase() {
    const b = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.CUTUP_API_BASE || '';
    return String(b || window.location?.origin || '').replace(/\/$/, '');
  }

  async function fetchJson(path) {
    const r = await fetch(`${apiBase()}${path}`, { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '—';
    }
  }

  function relTime(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function initials(email) {
    const e = String(email || '?');
    return e.slice(0, 2).toUpperCase();
  }

  function severityBadge(sev) {
    const v = String(sev || 'info').toLowerCase();
    return `<span class="axl-badge axl-badge--${esc(v === 'critical' ? 'critical' : v)}">${esc(v)}</span>`;
  }

  function shouldCollapseEvent(name) {
    const n = String(name || '');
    if (COLLAPSE_EVENTS.has(n)) return true;
    if (n === 'payment_retry' || n.startsWith('admin_')) return true;
    return false;
  }

  function groupTimelineEvents(events) {
    if (!state.collapseGroups) return events.map((e) => ({ type: 'event', event: e }));
    const groups = [];
    let i = 0;
    while (i < events.length) {
      const e = events[i];
      if (shouldCollapseEvent(e.eventName)) {
        let j = i + 1;
        while (j < events.length && events[j].eventName === e.eventName) j += 1;
        if (j - i >= 3) {
          groups.push({ type: 'group', eventName: e.eventName, count: j - i, sample: e });
          i = j;
          continue;
        }
      }
      groups.push({ type: 'event', event: e });
      i += 1;
    }
    return groups;
  }

  function renderGroupCard(g) {
    const label = String(g.eventName || '').replace(/_/g, ' ');
    return `<div class="axl-event-group" data-group="${esc(g.eventName)}">
      <strong>${esc(String(g.count))} repeated ${esc(label)}</strong>
      <span> · last ${esc(relTime(g.sample?.createdAt))}</span>
    </div>`;
  }

  function kpiCard(label, kpi) {
    const na = kpi && kpi.instrumented === false;
    return `<article class="axl-kpi${na ? ' axl-kpi--na' : ''}">
      <div class="axl-kpi-lbl">${esc(label)}</div>
      <div class="axl-kpi-val">${esc(na ? '—' : kpi?.display ?? '0')}</div>
      ${na || kpi?.hint ? `<div class="axl-kpi-hint">${esc(na ? kpi.hint || 'Not instrumented yet' : kpi.hint || '')}</div>` : ''}
    </article>`;
  }

  function fixHtml(html) {
    return String(html)
      .replace(/<div(\s|>)/g, '<div$1')
      .replace(/<\/div>/g, '</div>')
      .replace(/<\/div>/g, '</div>');
  }

  function readUrlState() {
    const saved = window.CutupAdminFilterState?.loadAdminFilterState?.('audit');
    if (saved) {
      if (saved.preset != null) state.preset = saved.preset;
      if (saved.page != null) state.page = saved.page;
      if (saved.liveMode != null) state.liveMode = saved.liveMode;
      if (saved.filters) state.filters = { ...state.filters, ...saved.filters };
      return;
    }
    const p = new URLSearchParams(window.location.search);
    state.preset = p.get('axl_preset') || '24h';
    state.filters = {
      email: p.get('axl_email') || '',
      userId: p.get('axl_user') || '',
      eventName: p.get('axl_event') || '',
      eventType: p.get('axl_type') || '',
      severity: p.get('axl_sev') || '',
      category: p.get('axl_cat') || '',
      country: p.get('axl_country') || '',
      ip: p.get('axl_ip') || '',
      sessionId: p.get('axl_session') || '',
      plan: p.get('axl_plan') || 'all',
      provider: p.get('axl_provider') || '',
      requestId: p.get('axl_req') || '',
      paymentEvents: p.get('axl_pay') === '1',
      authEvents: p.get('axl_auth') === '1',
      aiEvents: p.get('axl_ai') === '1',
      adminOnly: p.get('axl_admin') === '1',
      customerOnly: p.get('axl_cust') === '1'
    };
    state.page = Math.max(1, Number(p.get('axl_page')) || 1);
    state.liveMode = p.get('axl_live') === '1';
    writeUrlState();
  }

  function writeUrlState() {
    window.CutupAdminFilterState?.saveAdminFilterState?.('audit', {
      preset: state.preset,
      page: state.page,
      liveMode: state.liveMode,
      filters: { ...state.filters }
    });
  }

  function queryParams(extra = {}) {
    const q = new URLSearchParams();
    q.set('preset', state.preset);
    q.set('page', String(state.page));
    q.set('limit', String(PAGE_SIZE));
    const f = state.filters;
    if (f.userId) q.set('user_id', f.userId);
    if (f.email) q.set('email', f.email);
    if (f.eventName) q.set('event_name', f.eventName);
    if (f.eventType) q.set('event_type', f.eventType);
    if (f.severity) q.set('severity', f.severity);
    if (f.category) q.set('category', f.category);
    if (f.country) q.set('country', f.country);
    if (f.ip) q.set('ip', f.ip);
    if (f.sessionId) q.set('session_id', f.sessionId);
    if (f.plan && f.plan !== 'all') q.set('plan', f.plan);
    if (f.provider) q.set('provider', f.provider);
    if (f.requestId) q.set('request_id', f.requestId);
    if (f.paymentEvents) q.set('payment_events', '1');
    if (f.authEvents) q.set('auth_events', '1');
    if (f.aiEvents) q.set('ai_events', '1');
    if (f.adminOnly) q.set('admin_only', '1');
    if (f.customerOnly) q.set('customer_only', '1');
    Object.entries(extra).forEach(([k, v]) => q.set(k, v));
    return q.toString();
  }

  function renderKpiSections(kpis) {
    if (!kpis) return '';
    const sec = (title, items) =>
      `<section class="axl-kpi-section"><h3>${esc(title)}</h3><div class="axl-kpi-grid">${items.join('')}</div></section>`;
    const s = kpis.security || {};
    const o = kpis.operations || {};
    const b = kpis.behavior || {};
    const p = kpis.payments || {};
    return (
      sec('Security', [
        kpiCard('Failed logins', s.failedLogins),
        kpiCard('Admin logins', s.adminLogins),
        kpiCard('Suspicious IPs', s.suspiciousIpCount),
        kpiCard('Blocked attempts', s.blockedAttempts),
        kpiCard('Password resets', s.passwordResetRequests),
        kpiCard('Auth events', s.authProviderUsage),
        kpiCard('Admin sessions', s.activeAdminSessions)
      ]) +
      sec('Operations', [
        kpiCard('Uploads started', o.uploadsStarted),
        kpiCard('Uploads completed', o.uploadsCompleted),
        kpiCard('Failed AI jobs', o.failedAiJobs),
        kpiCard('Pay verify failures', o.paymentVerificationFailures),
        kpiCard('Callback failures', o.callbackFailures),
        kpiCard('Export failures', o.exportGenerationFailures)
      ]) +
      sec('Behavior', [
        kpiCard('Active users today', b.activeUsersToday),
        kpiCard('Session depth', b.avgSessionDepth),
        kpiCard('Avg jobs / user', b.avgJobsPerUser),
        kpiCard('Returning users', b.returningUsers),
        kpiCard('Heavy users', b.heavyUsers),
        kpiCard('Churn-risk idle', b.churnRiskInactivity)
      ]) +
      sec('Payments', [
        kpiCard('Checkout started', p.checkoutStarted),
        kpiCard('Checkout abandoned', p.checkoutAbandoned),
        kpiCard('Success rate', p.paymentSuccessRate),
        kpiCard('Retry rate', p.retryRate)
      ])
    );
  }

  function renderAnomalies(list) {
    if (!list?.length) {
      return `<div class="axl-empty"><div class="axl-empty-title">No suspicious activity detected</div>
        <p>Your platform telemetry looks healthy in this window.</p></div>`;
    }
    return `<div class="axl-anomaly-list">${list
      .map(
        (a) =>
          `<article class="axl-anomaly axl-anomaly--${esc(a.severity === 'critical' ? 'critical' : 'warning')}">
            <strong>${esc(a.title)}</strong> ${severityBadge(a.severity)}
            <p style="margin:6px 0 0;font-size:13px">${esc(a.reason)}</p>
          </article>`
      )
      .join('')}</div>`;
  }

  function renderEventCard(e, expanded) {
    const meta = JSON.stringify(e.metadata || {}, null, 2);
    return `<article class="axl-event-card" data-event-id="${esc(e.id)}">
      <div class="axl-event-head">
        <div class="axl-avatar">${esc(initials(e.userEmail))}</div>
        <div class="axl-event-body">
          <div class="axl-event-title-row"><span class="axl-event-title">${esc(e.title || e.eventName)}</span>${severityBadge(e.severity)}</div>
          <div class="axl-event-summary">${esc(e.summary || '')}</div>
          <div class="axl-event-meta">
            <span>${esc(e.userEmail || e.userId || 'Anonymous')}</span>
            <span>${esc(relTime(e.createdAt))}</span>
            ${e.countryCode ? `<span>${esc(e.countryCode)}</span>` : ''}
            ${e.device ? `<span>${esc(e.device)}</span>` : ''}
            ${e.requestId ? `<span>req ${esc(e.requestId)}</span>` : ''}
            ${e.latencyMs != null ? `<span>${esc(String(e.latencyMs))}ms</span>` : ''}
          </div>
        </div>
      </div>
      <div class="axl-event-expand">
        <details${expanded ? ' open' : ''}>
          <summary>Forensic details</summary>
          <div class="axl-event-meta" style="margin-top:8px">
            <button type="button" class="btn ghost axl-copy-req" data-req="${esc(e.requestId || '')}">Copy request id</button>
            <button type="button" class="btn ghost axl-copy-payload" data-payload="${esc(meta)}">Copy payload</button>
            <button type="button" class="btn ghost axl-pin-event" data-id="${esc(e.id)}">Pin / note</button>
          </div>
          <pre class="axl-json">${esc(meta)}</pre>
          <div class="axl-note-form" hidden>
            <textarea class="axl-note-input" rows="2" placeholder="Internal admin note…"></textarea>
            <label><input type="checkbox" class="axl-note-resolved"> Resolved</label>
            <label><input type="checkbox" class="axl-note-pinned"> Pinned</label>
            <button type="button" class="btn axl-save-note" data-id="${esc(e.id)}">Save note</button>
          </div>
        </details>
      </div>
    </article>`;
  }

  function renderTimelineHtml() {
    const groups = state.timelineGroups.slice(0, state.timelineVisible);
    if (!groups.length) {
      return `<div class="axl-empty"><div class="axl-empty-title">No events in this view</div>
        <p>More operational insights will appear as usage grows.</p></div>`;
    }
    const dens = state.density === 'compact' ? ' axl-timeline--compact' : '';
    const inner = groups
      .map((g) => (g.type === 'group' ? renderGroupCard(g) : renderEventCard(g.event)))
      .join('');
    return `<div class="axl-timeline${dens}" id="axlTimeline">${inner}</div>`;
  }

  function paintTimeline() {
    const scroll = document.getElementById('axlTimelineScroll');
    if (!scroll) return;
    scroll.innerHTML = renderTimelineHtml();
    const moreBtn = document.getElementById('axlLoadMore');
    if (moreBtn) {
      const hasMore = state.timelineVisible < state.timelineGroups.length;
      moreBtn.hidden = !hasMore;
      moreBtn.textContent = hasMore
        ? `Load more (${state.timelineGroups.length - state.timelineVisible} remaining)`
        : 'All events loaded';
    }
  }

  function renderFilterBar() {
    const f = state.filters;
    return `<div class="axl-filter-shell">
      <div class="axl-filter-row axl-filter-row--1">
        <select id="axlPreset" aria-label="Range">
          <option value="1h"${state.preset === '1h' ? ' selected' : ''}>Last 1h</option>
          <option value="24h"${state.preset === '24h' ? ' selected' : ''}>Last 24h</option>
          <option value="7d"${state.preset === '7d' ? ' selected' : ''}>Last 7 days</option>
          <option value="30d"${state.preset === '30d' ? ' selected' : ''}>Last 30 days</option>
        </select>
        <select id="axlSeverity" aria-label="Severity">
          <option value="">All severity</option>
          <option value="critical"${f.severity === 'critical' ? ' selected' : ''}>Critical</option>
          <option value="warning"${f.severity === 'warning' ? ' selected' : ''}>Warning</option>
          <option value="success"${f.severity === 'success' ? ' selected' : ''}>Success</option>
        </select>
        <select id="axlCategory" aria-label="Category">
          <option value="">All categories</option>
          <option value="payment"${f.category === 'payment' ? ' selected' : ''}>Payment</option>
          <option value="auth"${f.category === 'auth' ? ' selected' : ''}>Auth</option>
          <option value="ai"${f.category === 'ai' ? ' selected' : ''}>AI</option>
          <option value="admin"${f.category === 'admin' ? ' selected' : ''}>Admin</option>
        </select>
        <input id="axlEventType" placeholder="Event type" value="${esc(f.eventType || '')}" />
        <input id="axlEvent" placeholder="Event name" value="${esc(f.eventName || '')}" />
      </div>
      <div class="axl-filter-row axl-filter-row--2">
        <input id="axlEmail" placeholder="Email" value="${esc(f.email || '')}" />
        <input id="axlUserId" placeholder="User UUID" value="${esc(f.userId || '')}" />
        <input id="axlIp" placeholder="IP address" value="${esc(f.ip || '')}" />
        <input id="axlCountry" placeholder="Country" maxlength="2" value="${esc(f.country || '')}" />
        <select id="axlPlan" aria-label="Plan">
          <option value="all">All plans</option>
          <option value="free"${f.plan === 'free' ? ' selected' : ''}>free</option>
          <option value="starter"${f.plan === 'starter' ? ' selected' : ''}>starter</option>
          <option value="pro"${f.plan === 'pro' ? ' selected' : ''}>pro</option>
          <option value="business"${f.plan === 'business' ? ' selected' : ''}>business</option>
        </select>
        <input id="axlProvider" placeholder="Provider" value="${esc(f.provider || '')}" />
      </div>
      <div class="axl-filter-row axl-filter-row--3">
        <input id="axlSession" placeholder="Session ID" value="${esc(f.sessionId || '')}" />
        <input id="axlReq" placeholder="Request ID" value="${esc(f.requestId || '')}" />
        <div class="axl-filter-toggles">
          <label><input type="checkbox" id="axlPay"${f.paymentEvents ? ' checked' : ''} /> Payments</label>
          <label><input type="checkbox" id="axlAuth"${f.authEvents ? ' checked' : ''} /> Auth</label>
          <label><input type="checkbox" id="axlAi"${f.aiEvents ? ' checked' : ''} /> AI</label>
          <label><input type="checkbox" id="axlCollapse"${state.collapseGroups ? ' checked' : ''} /> Group repeats</label>
        </div>
        <div class="axl-filter-actions">
          <button type="button" class="btn" id="axlApply">Apply</button>
          <button type="button" class="btn ghost" id="axlReset">Reset</button>
          <button type="button" class="btn ghost" id="axlExportCsv">CSV</button>
          <button type="button" class="btn ghost" id="axlExportJson">JSON</button>
        </div>
      </div>
      <div class="axl-chips" id="axlChips"></div>
    </div>`;
  }

  function buildShell() {
    return fixHtml(`<div class="axl-root">
      <header class="axl-hero">
        <div class="axl-hero-text">
          <h2>Security &amp; Operations Intelligence</h2>
          <p class="axl-subtitle">Forensic timeline, behavioral analytics, and threat heuristics from live PostgreSQL telemetry.</p>
        </div>
        <div class="axl-toolbar">
          <label class="axl-live-toggle${state.liveMode ? ' is-on' : ''}" id="axlLiveToggle">
            <span class="axl-live-dot"></span> Live mode
          </label>
          <span id="axlLiveStatus" class="admin-muted">—</span>
        </div>
      </header>
      ${renderFilterBar()}
      <section class="axl-section">
        <h3 class="axl-section-title">KPI overview</h3>
        <div id="axlKpis" class="axl-kpi-wrap">${renderKpiSections(state.dashboard?.kpis)}</div>
      </section>
      <section class="axl-section">
        <h3 class="axl-section-title axl-section-title--lg">Analytics</h3>
        <div class="axl-analytics-grid">
          <article class="axl-chart-card axl-chart-card--wide"><h4>Events over time</h4><div class="axl-chart-wrap"><canvas id="axlChartEvents"></canvas></div></article>
          <article class="axl-chart-card"><h4>Category distribution</h4><div class="axl-chart-wrap"><canvas id="axlChartCategory"></canvas></div></article>
          <article class="axl-chart-card"><h4>Top countries</h4><div class="axl-chart-wrap"><canvas id="axlChartCountries"></canvas></div></article>
          <article class="axl-chart-card"><h4>Top actions</h4><div class="axl-chart-wrap"><canvas id="axlChartActions"></canvas></div></article>
        </div>
      </section>
      <div class="axl-split-row">
        <section class="axl-section">
          <h3 class="axl-section-title">Threat &amp; anomaly signals</h3>
          <div id="axlAnomalies"></div>
        </section>
        <section class="axl-section">
          <h3 class="axl-section-title">Live stream</h3>
          <div class="axl-live-panel" id="axlLiveFeed" aria-live="polite"><p class="admin-muted">Waiting for events…</p></div>
        </section>
      </div>
      <section class="axl-section axl-journey-card" id="axlJourneySection">
        <h3 class="axl-section-title axl-section-title--lg">User journey explorer</h3>
        <div class="axl-journey-search">
          <input id="axlJourneyQ" placeholder="Email, user UUID, or session ID" />
          <button type="button" class="btn" id="axlJourneyLoad">Investigate</button>
        </div>
        <div id="axlJourneyOut"></div>
      </section>
      <section class="axl-section">
        <div class="axl-timeline-toolbar">
          <h3 class="axl-section-title axl-section-title--lg" style="margin:0">Forensic timeline</h3>
          <div class="axl-timeline-tools">
            <div class="axl-density-toggle" role="group" aria-label="Timeline density">
              <button type="button" data-density="comfortable" class="${state.density === 'comfortable' ? 'is-active' : ''}">Comfortable</button>
              <button type="button" data-density="compact" class="${state.density === 'compact' ? 'is-active' : ''}">Compact</button>
            </div>
            <span id="axlPageLabel" class="admin-muted" style="font-size:12px"></span>
            <button type="button" class="btn ghost" id="axlPrev">Prev page</button>
            <button type="button" class="btn ghost" id="axlNext">Next page</button>
          </div>
        </div>
        <div class="axl-timeline-scroll" id="axlTimelineScroll"></div>
        <div class="axl-load-more">
          <button type="button" class="btn ghost" id="axlLoadMore" hidden>Load more</button>
        </div>
      </section>
      <p class="axl-footer-meta" id="axlCheckedAt"></p>
    </div>`);
  }

  function collectFiltersFromDom() {
    return {
      email: document.getElementById('axlEmail')?.value?.trim() || '',
      userId: document.getElementById('axlUserId')?.value?.trim() || '',
      sessionId: document.getElementById('axlSession')?.value?.trim() || '',
      eventName: document.getElementById('axlEvent')?.value?.trim() || '',
      eventType: document.getElementById('axlEventType')?.value?.trim() || '',
      severity: document.getElementById('axlSeverity')?.value || '',
      category: document.getElementById('axlCategory')?.value || '',
      country: document.getElementById('axlCountry')?.value?.trim() || '',
      ip: document.getElementById('axlIp')?.value?.trim() || '',
      requestId: document.getElementById('axlReq')?.value?.trim() || '',
      plan: document.getElementById('axlPlan')?.value || 'all',
      provider: document.getElementById('axlProvider')?.value?.trim() || '',
      paymentEvents: document.getElementById('axlPay')?.checked,
      authEvents: document.getElementById('axlAuth')?.checked,
      aiEvents: document.getElementById('axlAi')?.checked,
      collapseGroups: document.getElementById('axlCollapse')?.checked !== false,
      adminOnly: false,
      customerOnly: false
    };
  }

  async function loadDashboard() {
    const q = new URLSearchParams();
    q.set('preset', state.preset);
    const data = await fetchJson(`/api/admin/audit/dashboard?${q.toString()}`);
    state.dashboard = data;
    const kpiEl = document.getElementById('axlKpis');
    if (kpiEl) kpiEl.innerHTML = renderKpiSections(data.kpis);
    const anEl = document.getElementById('axlAnomalies');
    if (anEl) anEl.innerHTML = renderAnomalies(data.anomalies);
    const chk = document.getElementById('axlCheckedAt');
    if (chk) chk.textContent = `Last refreshed ${fmtDate(data.checkedAt)}`;
    requestAnimationFrame(() => window.CutupAuditLogCharts?.render?.(data.charts));
  }

  async function loadEvents(silent) {
    const data = await fetchJson(`/api/admin/audit?${queryParams()}`);
    state.events = data.events || [];
    state.total = data.total || 0;
    state.events.forEach((e) => state.knownEventIds.add(e.id));
    state.timelineGroups = groupTimelineEvents(state.events);
    if (!silent) state.timelineVisible = INITIAL_TIMELINE;

    const lbl = document.getElementById('axlPageLabel');
    if (lbl) lbl.textContent = `Page ${state.page} · ${state.total} events`;

    if (!silent) paintTimeline();
    else {
      const scroll = document.getElementById('axlTimelineScroll');
      const first = state.events[0];
      if (first && scroll && !scroll.querySelector(`[data-event-id="${first.id}"]`)) {
        state.timelineGroups = groupTimelineEvents(state.events);
        state.timelineVisible = Math.min(state.timelineVisible + 1, state.timelineGroups.length);
        paintTimeline();
      }
    }
  }

  async function loadLiveFeedOnly() {
    const data = await fetchJson(`/api/admin/audit?${queryParams({ page: '1', limit: '20' })}`);
    const feed = document.getElementById('axlLiveFeed');
    if (!feed) return;
    const rows = (data.events || [])
      .map(
        (e) =>
          `<div class="axl-live-row axl-live-row--new" data-id="${esc(e.id)}"><strong>${esc(e.eventName)}</strong>
          <div style="font-size:12px;color:var(--muted)">${esc(relTime(e.createdAt))} · ${esc(e.userEmail || '—')}</div>`
      )
      .join('');
    feed.innerHTML = rows || '<p class="admin-muted">Waiting for events…</p>';
  }

  function prependLiveEvent(payload) {
    const feed = document.getElementById('axlLiveFeed');
    if (!feed || !payload?.id) return;
    if (state.knownEventIds.has(payload.id)) return;
    state.knownEventIds.add(payload.id);
    const row = document.createElement('div');
    row.className = 'axl-live-row axl-live-row--new';
    row.innerHTML = `<strong>${esc(payload.eventName || '')}</strong>
      <div style="font-size:12px;color:var(--muted)">just now</div>`;
    feed.insertBefore(row, feed.firstChild);
    while (feed.children.length > 30) feed.removeChild(feed.lastChild);
  }

  function connectWs() {
    if (typeof WebSocket === 'undefined') return;
    const base = apiBase();
    if (!base) return;
    const url = base.startsWith('https')
      ? `${base.replace(/^https/, 'wss')}/api/admin/audit/live`
      : `${base.replace(/^http/, 'ws')}/api/admin/audit/live`;
    try {
      state.ws = new WebSocket(url);
      state.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === 'audit' && msg.payload) prependLiveEvent(msg.payload);
        } catch (_e) {}
      };
    } catch (_e) {}
  }

  function startLive() {
    stopLive();
    if (!state.liveMode) return;
    state.liveTimer = setInterval(() => {
      loadLiveFeedOnly().catch(() => {});
      loadDashboard().catch(() => {});
    }, LIVE_MS);
    const st = document.getElementById('axlLiveStatus');
    if (st) st.textContent = 'Live · 10s refresh';
  }

  function stopLive() {
    if (state.liveTimer) clearInterval(state.liveTimer);
    state.liveTimer = null;
    if (state.ws) {
      try {
        state.ws.close();
      } catch (_e) {}
      state.ws = null;
    }
  }

  async function loadJourney() {
    const q = document.getElementById('axlJourneyQ')?.value?.trim();
    const out = document.getElementById('axlJourneyOut');
    if (!q || !out) return;
    out.innerHTML = '<p class="admin-muted">Loading journey…</p>';
    const data = await fetchJson(`/api/admin/audit/journey?q=${encodeURIComponent(q)}`);
    const p = data.profile || {};
    const steps = (data.funnelSteps || [])
      .map((s) => `<span class="axl-journey-step">${esc(s.step)} · ${esc(String(s.count))}</span>`)
      .join('');
    const profileHtml = p.email
      ? `<div class="axl-journey-profile">
          <div><strong>User</strong><span>${esc(p.email)}</span></div>
          <div><strong>Plan</strong><span>${esc(p.plan || '—')}</span></div>
          <div><strong>First seen</strong><span>${esc(fmtDate(p.firstSeen))}</span></div>
          <div><strong>Sessions</strong><span>${esc(String(p.totalSessions ?? '—'))}</span></div>
          <div><strong>Payment events</strong><span>${esc(String(p.paymentAttempts ?? '—'))}</span></div>
          <div><strong>AI jobs</strong><span>${esc(String(p.aiJobs ?? '—'))}</span></div>
          <div><strong>Exports</strong><span>${esc(String(p.exports ?? '—'))}</span></div>
        </div>`
      : '';
    const tl = (data.timeline || []).slice(0, 40).map((e) => renderEventCard(e)).join('');
    out.innerHTML = fixHtml(`${profileHtml}
      <div class="axl-journey-steps">${steps || '<span class="admin-muted">No funnel steps matched</span>'}</div>
      <div class="axl-journey-timeline">${tl || '<p class="admin-muted">No events for this user.</p>'}</div>`);
  }

  function bindEvents() {
    document.getElementById('axlApply')?.addEventListener('click', async () => {
      state.filters = collectFiltersFromDom();
      state.collapseGroups = state.filters.collapseGroups !== false;
      state.preset = document.getElementById('axlPreset')?.value || '24h';
      state.page = 1;
      writeUrlState();
      await loadDashboard();
      await loadEvents(false);
    });
    document.getElementById('axlReset')?.addEventListener('click', async () => {
      state.filters = {};
      state.preset = '24h';
      state.page = 1;
      readUrlState();
      const root = document.getElementById('auditLogWorkspace');
      if (root) root.innerHTML = buildShell();
      bindEvents();
      await load();
    });
    document.getElementById('axlPreset')?.addEventListener('change', () => {
      state.preset = document.getElementById('axlPreset')?.value || '24h';
    });
    document.getElementById('axlLiveToggle')?.addEventListener('click', () => {
      state.liveMode = !state.liveMode;
      writeUrlState();
      const root = document.getElementById('auditLogWorkspace');
      if (root) root.innerHTML = buildShell();
      bindEvents();
      startLive();
      connectWs();
    });
    document.getElementById('axlPrev')?.addEventListener('click', async () => {
      if (state.page <= 1) return;
      state.page -= 1;
      writeUrlState();
      await loadEvents(false);
    });
    document.getElementById('axlNext')?.addEventListener('click', async () => {
      state.page += 1;
      writeUrlState();
      await loadEvents(false);
    });
    document.getElementById('axlJourneyLoad')?.addEventListener('click', () => loadJourney().catch((e) => alert(e.message)));
    document.getElementById('axlExportCsv')?.addEventListener('click', () => {
      window.open(`${apiBase()}/api/admin/audit/export?format=csv&${queryParams()}`, '_blank');
    });
    document.getElementById('axlExportJson')?.addEventListener('click', () => {
      window.open(`${apiBase()}/api/admin/audit/export?format=json&${queryParams()}`, '_blank');
    });

    document.getElementById('axlLoadMore')?.addEventListener('click', () => {
      state.timelineVisible = Math.min(state.timelineVisible + LOAD_MORE_STEP, state.timelineGroups.length);
      paintTimeline();
    });
    document.querySelectorAll('.axl-density-toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.density = btn.getAttribute('data-density') || 'comfortable';
        document.querySelectorAll('.axl-density-toggle button').forEach((b) => b.classList.toggle('is-active', b === btn));
        paintTimeline();
      });
    });
    document.getElementById('axlTimelineScroll')?.addEventListener('click', async (ev) => {
      const pin = ev.target.closest('.axl-pin-event');
      if (pin) {
        const card = pin.closest('.axl-event-card');
        const form = card?.querySelector('.axl-note-form');
        if (form) form.hidden = !form.hidden;
        return;
      }
      const save = ev.target.closest('.axl-save-note');
      if (save) {
        const id = save.getAttribute('data-id');
        const card = save.closest('.axl-event-card');
        const note = card?.querySelector('.axl-note-input')?.value || '';
        const resolved = card?.querySelector('.axl-note-resolved')?.checked;
        const pinned = card?.querySelector('.axl-note-pinned')?.checked;
        await fetch(`${apiBase()}/api/admin/audit/events/${id}/notes`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note, resolved, pinned })
        });
        return;
      }
      const copyReq = ev.target.closest('.axl-copy-req');
      if (copyReq?.dataset?.req) {
        navigator.clipboard?.writeText(copyReq.dataset.req);
        return;
      }
      const copyPay = ev.target.closest('.axl-copy-payload');
      if (copyPay?.dataset?.payload) {
        navigator.clipboard?.writeText(copyPay.dataset.payload);
      }
    });
  }

  async function load() {
    const root = document.getElementById('auditLogWorkspace');
    if (!root) return;
    readUrlState();
    root.classList.add('axl-skeleton');
    root.innerHTML = buildShell();
    root.classList.remove('axl-skeleton');
    bindEvents();
    try {
      await Promise.all([loadDashboard(), loadEvents(false), loadLiveFeedOnly()]);
      startLive();
      connectWs();
    } catch (e) {
      root.innerHTML = `<div class="axl-empty"><div class="axl-empty-title">Could not load audit intelligence</div>
        <p>${esc(e.message || 'Unknown error')}</p></div>`;
      root.innerHTML = fixHtml(root.innerHTML);
    }
  }

  function destroy() {
    stopLive();
    window.CutupAuditLogCharts?.destroyAll?.();
  }

  return { load, destroy };
})();
