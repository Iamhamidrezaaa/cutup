from pathlib import Path

p = Path("website/admin-audit-log.js")
text = p.read_text(encoding="utf-8")

# Fix any motion typos
text = text.replace("</motion>", "</motion>").replace("<motion ", "<motion ")
text = text.replace("</motion>", "</div>")
text = text.replace("<motion class=", "<div class=")
text = text.replace("<motion id=", "<motion id=").replace("<motion id=", "<div id=")

old_block = text[text.index("  function renderTimeline(events)"): text.index("  function collectFiltersFromDom()")]

new_block = r'''  function renderTimelineHtml() {
    const groups = state.timelineGroups.slice(0, state.timelineVisible);
    if (!groups.length) {
      return `<motion class="axl-empty"><motion class="axl-empty-title">No events in this view</div>
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
      <motion class="axl-filter-row axl-filter-row--3">
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
          <article class="axl-chart-card axl-chart-card--wide"><h4>Events over time</h4><motion class="axl-chart-wrap"><canvas id="axlChartEvents"></canvas></motion></article>
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
        <div class="axl-timeline-scroll" id="axlTimelineScroll"></motion>
        <div class="axl-load-more">
          <button type="button" class="btn ghost" id="axlLoadMore" hidden>Load more</button>
        </div>
      </section>
      <p class="axl-footer-meta" id="axlCheckedAt"></p>
    </div>`);
  }

'''

new_block = new_block.replace("<motion ", "<div ").replace("</motion>", "</div>")
new_block = new_block.replace('<motion class="axl-empty"><motion class="axl-empty-title">', '<div class="axl-empty"><motion class="axl-empty-title">')
new_block = new_block.replace('<motion class="axl-empty-title">', '<div class="axl-empty-title">')

text = text[: text.index("  function renderTimeline(events)")] + new_block + text[text.index("  function collectFiltersFromDom()") :]

# collectFiltersFromDom
text = text.replace(
    "eventName: document.getElementById('axlEvent')?.value?.trim() || '',",
    "eventName: document.getElementById('axlEvent')?.value?.trim() || '',\n      eventType: document.getElementById('axlEventType')?.value?.trim() || '',",
    1,
)
text = text.replace("plan: 'all',", "plan: document.getElementById('axlPlan')?.value || 'all',", 1)
text = text.replace(
    "provider: '',",
    "provider: document.getElementById('axlProvider')?.value?.trim() || '',",
    1,
)
text = text.replace(
    "aiEvents: document.getElementById('axlAi')?.checked,\n      adminOnly: false,",
    "aiEvents: document.getElementById('axlAi')?.checked,\n      collapseGroups: document.getElementById('axlCollapse')?.checked !== false,\n      adminOnly: false,",
    1,
)

# loadEvents
old_load = """  async function loadEvents(silent) {
    const data = await fetchJson(`/api/admin/audit?${queryParams()}`);
    state.events = data.events || [];
    state.total = data.total || 0;
    state.events.forEach((e) => state.knownEventIds.add(e.id));

    const wrap = document.getElementById('axlTimelineWrap');
    if (wrap && !silent) wrap.innerHTML = renderTimeline(state.events);
    const lbl = document.getElementById('axlPageLabel');
    if (lbl) lbl.textContent = `Page ${state.page} · ${state.total} events`;

    if (silent && wrap) {
      const newOnes = state.events.filter((e) => !wrap.querySelector(`[data-event-id="${e.id}"]`));
      if (newOnes.length) {
        const html = newOnes.map((e) => renderEventCard(e)).join('');
        wrap.insertAdjacentHTML('afterbegin', html);
      }
    }
  }"""

new_load = """  async function loadEvents(silent) {
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
  }"""

if old_load in text:
    text = text.replace(old_load, new_load)

# loadJourney
old_j = """  async function loadJourney() {
    const q = document.getElementById('axlJourneyQ')?.value?.trim();
    const out = document.getElementById('axlJourneyOut');
    if (!q || !out) return;
    const data = await fetchJson(`/api/admin/audit/journey?q=${encodeURIComponent(q)}`);
    const steps = (data.funnelSteps || [])
      .map((s) => `<span class="axl-journey-step">${esc(s.step)} · ${esc(String(s.count))}</span>`)
      .join('');
    out.innerHTML = `<div class="axl-journey-steps">${steps || '<span class="admin-muted">No funnel steps matched</span>'}</motion>
      <div class="axl-timeline" style="margin-top:14px">${(data.timeline || []).map((e) => renderEventCard(e, false)).join('')}</div>`;
    out.innerHTML = fixHtml(out.innerHTML);
  }"""

new_j = """  async function loadJourney() {
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
          <motion><strong>First seen</strong><span>${esc(fmtDate(p.firstSeen))}</span></div>
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
  }"""

new_j = new_j.replace("<motion>", "<motion>").replace("<motion>", "<div>")
new_j = new_j.replace("</motion>", "</div>").replace("<motion ", "<div ")

if "async function loadJourney()" in text and old_j not in text:
    # find and replace loadJourney body manually
    pass
else:
    if old_j in text:
        text = text.replace(old_j, new_j)
    else:
        # replace loadJourney function entirely by marker
        start = text.index("  async function loadJourney()")
        end = text.index("  function bindEvents()", start)
        text = text[:start] + new_j + "\n\n" + text[end:]

# bindEvents additions - insert before closing of bindEvents
insert = """
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
    document.getElementById('axlTimelineScroll')?.addEventListener('click', async (ev) => {"""

if "axlLoadMore" not in text or "axlLoadMore')?.addEventListener" not in text:
    text = text.replace(
        "    document.getElementById('axlTimelineWrap')?.addEventListener('click', async (ev) => {",
        insert + "\n    document.getElementById('axlTimelineScroll')?.addEventListener('click', async (ev) => {",
    )

# queryParams eventType
if "eventType" not in text[text.index("function queryParams"): text.index("function renderKpiSections")]:
    text = text.replace(
        "if (f.eventName) q.set('event_name', f.eventName);",
        "if (f.eventName) q.set('event_name', f.eventName);\n    if (f.eventType) q.set('event_type', f.eventType);",
        1,
    )
    text = text.replace(
        "if (f.plan && f.plan !== 'all') q.set('plan', f.plan);",
        "if (f.plan && f.plan !== 'all') q.set('plan', f.plan);\n    if (f.provider) q.set('provider', f.provider);",
        1,
    )

# renderEventCard title row
text = text.replace(
    '<motion class="axl-event-title">${esc(e.title || e.eventName)} ${severityBadge(e.severity)}</div>',
    '<div class="axl-event-title-row"><span class="axl-event-title">${esc(e.title || e.eventName)}</span>${severityBadge(e.severity)}</div>',
    1,
)

# live feed class
text = text.replace('row.className = \'axl-live-row\';', "row.className = 'axl-live-row axl-live-row--new';")

# startLive - don't reload full timeline on interval, only live feed + dashboard KPIs
text = text.replace(
    """    state.liveTimer = setInterval(() => {
      loadLiveFeedOnly().catch(() => {});
      loadEvents(true).catch(() => {});
      loadDashboard().catch(() => {});
    }, LIVE_MS);""",
    """    state.liveTimer = setInterval(() => {
      loadLiveFeedOnly().catch(() => {});
      loadDashboard().catch(() => {});
    }, LIVE_MS);""",
)

p.write_text(text, encoding="utf-8")
print("patched ui")
