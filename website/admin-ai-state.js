/**
 * Cutup Admin — AI Operations Center
 */
window.CutupAdminAiState = (function () {
  const LIVE_POLL_MS = 12_000;

  const state = {
    preset: '24h',
    liveMode: false,
    liveTimer: null,
    data: null,
    hasRendered: false
  };

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function fmt() {
    return window.CutupDashFmt || {};
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '—';
    }
  }

  function statusClass(s) {
    const v = String(s || 'attention').toLowerCase();
    return `aist-status aist-status--${esc(v)}`;
  }

  function statusLabel(s) {
    const v = String(s || 'attention').toLowerCase();
    if (v === 'healthy') return 'Operational';
    if (v === 'degraded') return 'Degraded';
    if (v === 'critical') return 'Critical';
    if (v === 'idle') return 'Idle';
    return 'Monitoring';
  }

  function renderHeader() {
    return `
      <header class="aist-header">
        <div>
          <h2>AI Operations Center</h2>
          <p class="aist-subtitle">Monitor AI pipelines, processing health, automation systems, queue pressure, and operational intelligence across the platform.</p>
        </div>
        <div class="aist-toolbar">
          <label class="aist-live ${state.liveMode ? 'is-on' : ''}" id="aistLiveToggle">
            <span class="aist-live-dot" aria-hidden="true"></span>
            Live mode
          </label>
          <select id="aistPresetSelect" class="pay-select" aria-label="Time range">
            <option value="24h"${state.preset === '24h' ? ' selected' : ''}>Last 24h</option>
            <option value="7d"${state.preset === '7d' ? ' selected' : ''}>Last 7 days</option>
            <option value="30d"${state.preset === '30d' ? ' selected' : ''}>Last 30 days</option>
          </select>
          <button type="button" class="btn ghost" id="aistExportCsvBtn">Export CSV</button>
          <button type="button" class="btn ghost" id="aistRefreshBtn">Refresh</button>
        </div>
      </header>`;
  }

  function renderKpi(kpis) {
    if (!kpis) {
      return '<p class="aist-empty">Operational telemetry is still warming up.</p>';
    }
    const f = fmt();
    const cards = [
      ['Active AI jobs', kpis.activeAiJobs, null],
      ['Processed today', kpis.jobsProcessedToday, null],
      ['Queue backlog', kpis.queueBacklog, null],
      ['Avg processing', kpis.avgProcessingTimeMin != null ? `${kpis.avgProcessingTimeMin} min` : '—', null],
      ['Success rate', kpis.successRate != null ? `${f.num(kpis.successRate, 1)}%` : '—', null],
      ['Failure rate', kpis.failureRate != null ? `${f.num(kpis.failureRate, 1)}%` : '—', null],
      ['AI cost today', kpis.aiCostTodayEur != null ? f.eur(kpis.aiCostTodayEur) : '—', null],
      ['OpenAI requests', kpis.openaiRequestCount, null],
      ['Tokens', '—', kpis.tokensNote],
      ['Queue wait', '—', kpis.queueWaitNote],
      ['Peak concurrency', kpis.peakConcurrency, null],
      ['Workers', '—', kpis.workersNote],
      ['Retry rate', '—', kpis.retryNote],
      ['Top feature', kpis.mostUsedFeature, null],
      ['AI load', kpis.aiLoadLevel, null]
    ];
    return `<div class="aist-kpi-grid">${cards
      .map(
        ([lbl, val, note]) =>
          `<article class="aist-kpi">
            <div class="aist-kpi-lbl">${esc(lbl)}</div>
            <div class="aist-kpi-val">${esc(String(val ?? '—'))}</div>
            ${note ? `<div class="aist-kpi-meta">${esc(note)}</div>` : ''}
          </article>`
      )
      .join('')}</div>`;
  }

  function renderTelemetryWarnings(warnings) {
    const list = Array.isArray(warnings) ? warnings.filter((w) => w?.message) : [];
    if (!list.length) return '';
    const items = list
      .map((w) => `<li>${esc(w.message)}</li>`)
      .join('');
    return `<details class="aist-warnings" open>
      <summary>Telemetry notice (${list.length})</summary>
      <ul class="aist-warnings-list">${items}</ul>
    </details>`;
  }

  function renderPipelineCard(p) {
    if (p.unavailable) {
      const msg = p.userMessage || 'Telemetry unavailable for this pipeline.';
      return `<article class="aist-pipe-card"><h4>${esc(p.label)}</h4><p class="muted">${esc(msg)}</p></article>`;
    }
    return `<article class="aist-pipe-card">
      <div class="aist-pipe-head">
        <h4>${esc(p.label)}</h4>
        <span class="${statusClass(p.status)}"><span class="aist-status-dot"></span>${esc(statusLabel(p.status))}</span>
      </div>
      <div class="aist-pipe-metrics">
        <div><span>24h throughput</span><strong>${esc(String(p.throughput24h ?? '—'))}</strong></div>
        <div><span>Active</span><strong>${esc(p.activeJobs != null ? String(p.activeJobs) : '—')}</strong></div>
        <div><span>Queued</span><strong>${esc(p.queuedJobs != null ? String(p.queuedJobs) : '—')}</strong></div>
        <div><span>Success</span><strong>${p.successPct != null ? `${esc(String(p.successPct))}%` : '—'}</strong></div>
        <div><span>Failures 24h</span><strong>${esc(String(p.failures24h ?? 0))}</strong></div>
        <div><span>Latency</span><strong>${p.avgLatencyMin != null ? `${esc(String(p.avgLatencyMin))} min` : '—'}</strong></div>
      </div>
      <p class="muted" style="font-size:11px;margin:10px 0 0">Last activity: ${esc(fmtDate(p.lastActivityAt))}</p>
    </article>`;
  }

  function renderPipelines(pipelines) {
    if (!pipelines?.length) {
      return '<section><h3 class="aist-section-title">Live AI pipelines</h3><p class="aist-empty">AI observability will expand as platform activity increases.</p></section>';
    }
    return `<section>
      <h3 class="aist-section-title">Live AI pipelines</h3>
      <div class="aist-pipeline-grid">${pipelines.map(renderPipelineCard).join('')}</div>
    </section>`;
  }

  function renderCost(cost) {
    if (!cost) {
      return '<section><h3 class="aist-section-title">AI cost intelligence</h3><p class="aist-empty">Cost analytics require database activity.</p></section>';
    }
    const f = fmt();
    return `<section>
      <h3 class="aist-section-title">AI cost intelligence</h3>
      <p class="admin-muted" style="margin:-6px 0 14px">Estimated from processed minutes · ${f.eur(cost.costPerMinuteEur)}/min heuristic</p>
      <div class="aist-kpi-grid" style="margin-bottom:16px">
        <article class="aist-kpi"><div class="aist-kpi-lbl">Period spend (est.)</div><div class="aist-kpi-val">${f.eur(cost.estimatedSpendEur)}</div></article>
        <article class="aist-kpi"><div class="aist-kpi-lbl">Cost / export</div><div class="aist-kpi-val">${cost.costPerExportEur != null ? f.eur(cost.costPerExportEur) : '—'}</div></article>
      </div>
      <div class="aist-charts-row">
        <article class="aist-chart-card"><h4>Spend trend</h4><div class="aist-chart-wrap"><canvas id="aiChartCostArea"></canvas></div></article>
        <article class="aist-chart-card"><h4>Jobs by feature</h4><div class="aist-chart-wrap"><canvas id="aiChartCostFeature"></canvas></div></article>
        <article class="aist-chart-card"><h4>Top users by cost</h4><div class="aist-chart-wrap"><canvas id="aiChartTopUsers"></canvas></div></article>
      </div>
    </section>`;
  }

  function renderQueue(queue) {
    const q = queue || {};
    return `<section>
      <h3 class="aist-section-title">Queue & worker observability</h3>
      <div class="aist-queue-card">
        <p>${esc(q.message || 'Queue telemetry not yet available.')}</p>
        ${q.pendingPayments != null ? `<p style="margin-top:8px">Pending payments: <strong>${esc(String(q.pendingPayments))}</strong>${q.oldestPendingAt ? ` · oldest ${esc(fmtDate(q.oldestPendingAt))}` : ''}</p>` : ''}
      </div>
    </section>`;
  }

  function renderIncidents(incidents) {
    const list = incidents || [];
    return `<section>
      <h3 class="aist-section-title">AI incidents & anomalies</h3>
      ${
        list.length
          ? `<div class="aist-incident-list">${list
              .map(
                (i) =>
                  `<article class="aist-incident aist-incident--${esc(i.severity === 'critical' ? 'critical' : 'warning')}">
                    <strong>${esc(i.type)}</strong> · ${esc(i.subsystem)}
                    <p style="margin:6px 0 0">${esc(i.impact)}</p>
                    <time class="muted" style="font-size:11px">${esc(fmtDate(i.at))}</time>
                  </article>`
              )
              .join('')}</div>`
          : '<p class="aist-empty">No critical incidents in the last 72 hours.</p>'
      }
    </section>`;
  }

  function renderCron(cronJobs) {
    const list = cronJobs || [];
    return `<section>
      <h3 class="aist-section-title">Automation & cron intelligence</h3>
      <div class="aist-cron-grid">${list
        .map(
          (j) =>
            `<div class="aist-cron-item">
              <strong>${esc(j.label)}</strong>
              <div class="muted">${esc(statusLabel(j.status))}${j.lastRunAt ? ` · last ${esc(fmtDate(j.lastRunAt))}` : ''}</div>
              ${j.runs24h != null ? `<div>Runs 24h: ${esc(String(j.runs24h))}</div>` : ''}
              ${j.note ? `<p style="margin:6px 0 0;font-size:12px">${esc(j.note)}</p>` : ''}
            </div>`
        )
        .join('')}</div>
    </section>`;
  }

  function renderModels(models) {
    if (!models) return '';
    return `<section>
      <h3 class="aist-section-title">Model observability</h3>
      <div class="aist-pipeline-grid">
        ${(models.primary || [])
          .map(
            (m) =>
              `<article class="aist-pipe-card"><h4>${esc(m.label)}</h4><p class="muted">${esc(m.role)}</p></article>`
          )
          .join('')}
      </div>
      <p class="admin-muted" style="margin-top:10px">Error share (24h): ${esc(String(models.errorPct ?? '—'))}% · ${esc(models.note || '')}</p>
    </section>`;
  }

  function renderInsights(insights) {
    if (!insights?.length) return '';
    return `<section><h3 class="aist-section-title">Operational insights</h3>
      <div class="aist-insights">${insights
        .map((i) => `<div class="aist-insight aist-insight--${esc(i.tone || 'neutral')}">${esc(i.text)}</div>`)
        .join('')}</div></section>`;
  }

  function renderLegacy(instalogist) {
    if (!instalogist?.envelope) return '';
    const env = instalogist.envelope;
    return `<details class="aist-legacy-wrap">
      <summary>Instalogist snapshot (optional)</summary>
      <p class="admin-muted">Source: ${esc(instalogist.source || 'remote')} · status ${esc(env.snapshot_status || '—')}</p>
    </details>`;
  }

  function fixHtml(html) {
    return String(html).replace(/<motion(\s|>)/g, '<div$1').replace(/<\/motion>/g, '</div>');
  }

  function buildHtml(data) {
    return fixHtml(`
      <motion class="aist-root">
        ${renderTelemetryWarnings(data.telemetryWarnings)}
        ${renderHeader()}
        ${renderInsights(data.insights)}
        ${renderKpi(data.kpis)}
        ${renderPipelines(data.pipelines)}
        ${renderCost(data.cost)}
        ${renderQueue(data.queue)}
        ${renderIncidents(data.incidents)}
        ${renderCron(data.cronJobs)}
        ${renderModels(data.models)}
        ${renderLegacy(data.instalogist)}
        <p class="muted" style="font-size:12px">Checked ${esc(fmtDate(data.checkedAt))}</p>
      </div>`);
  }

  function exportCsv() {
    const Csv = window.CutupAdminCsv;
    const data = state.data;
    if (!Csv || !data) {
      if (typeof showBanner === 'function') showBanner('Load AI operations data before exporting.');
      return;
    }
    const FIELDS = ['key', 'value', 'value2', 'value3', 'value4', 'value5', 'value6', 'value7'];
    const blocks = [];
    const preset = data.preset || state.preset || '24h';

    blocks.push({
      section: 'meta',
      rows: [['checked_at', data.checkedAt, preset, data.partial ? 'partial' : 'full', '', '', '', '']]
    });

    const k = data.kpis || {};
    const kpiRows = [
      ['active_ai_jobs', k.activeAiJobs, '', '', '', '', '', ''],
      ['jobs_processed_today', k.jobsProcessedToday, '', '', '', '', '', ''],
      ['queue_backlog', k.queueBacklog, '', '', '', '', '', ''],
      ['avg_processing_min', k.avgProcessingTimeMin, '', '', '', '', '', ''],
      ['success_rate_pct', k.successRate, '', '', '', '', '', ''],
      ['failure_rate_pct', k.failureRate, '', '', '', '', '', ''],
      ['ai_cost_today_eur', k.aiCostTodayEur, '', '', '', '', '', ''],
      ['openai_request_count', k.openaiRequestCount, '', '', '', '', '', ''],
      ['peak_concurrency', k.peakConcurrency, '', '', '', '', '', ''],
      ['most_used_feature', k.mostUsedFeature, '', '', '', '', '', ''],
      ['ai_load_level', k.aiLoadLevel, '', '', '', '', '', ''],
      ['tokens_note', k.tokensNote, '', '', '', '', '', ''],
      ['queue_wait_note', k.queueWaitNote, '', '', '', '', '', ''],
      ['workers_note', k.workersNote, '', '', '', '', '', ''],
      ['retry_note', k.retryNote, '', '', '', '', '', '']
    ];
    blocks.push({ section: 'kpis', rows: kpiRows });

    const pipeRows = (data.pipelines || []).map((p) => [
      p.id,
      p.label,
      p.status,
      p.throughput24h,
      p.successPct,
      p.failures24h,
      p.avgLatencyMin,
      p.unavailable ? p.userMessage : p.lastActivityAt
    ]);
    if (pipeRows.length) blocks.push({ section: 'pipelines', rows: pipeRows });

    const cost = data.cost || {};
    const costRows = [
      ['estimated_spend_eur', cost.estimatedSpendEur, '', '', '', '', '', ''],
      ['cost_per_export_eur', cost.costPerExportEur, '', '', '', '', '', ''],
      ['cost_per_minute_eur', cost.costPerMinuteEur, '', '', '', '', '', '']
    ];
    for (const pt of cost.timeline || []) {
      costRows.push(['timeline_day', pt.day, pt.spendEur, pt.minutes, '', '', '', '']);
    }
    for (const f of cost.byFeature || []) {
      costRows.push(['feature', f.feature, f.jobs, f.minutes, f.spendEur, '', '', '']);
    }
    for (const u of cost.topUsers || []) {
      costRows.push(['top_user', u.email, u.minutes, u.spendEur, '', '', '', '']);
    }
    if (costRows.length) blocks.push({ section: 'cost', rows: costRows });

    const q = data.queue || {};
    blocks.push({
      section: 'queue',
      rows: [
        ['available', q.available, q.message, q.pendingPayments, q.oldestPendingAt, '', '', '']
      ]
    });

    const incRows = (data.incidents || []).map((i) => [
      i.type,
      i.subsystem,
      i.severity,
      i.impact,
      i.at,
      '',
      '',
      ''
    ]);
    if (incRows.length) blocks.push({ section: 'incidents', rows: incRows });

    const cronRows = (data.cronJobs || []).map((j) => [
      j.label,
      j.status,
      j.lastRunAt,
      j.runs24h,
      j.note,
      '',
      '',
      ''
    ]);
    if (cronRows.length) blocks.push({ section: 'cron_jobs', rows: cronRows });

    const insightRows = (data.insights || []).map((i) => [i.tone, i.text, '', '', '', '', '', '']);
    if (insightRows.length) blocks.push({ section: 'insights', rows: insightRows });

    const warnRows = (data.telemetryWarnings || []).map((w) => [w.id, w.message, '', '', '', '', '', '']);
    if (warnRows.length) blocks.push({ section: 'telemetry_warnings', rows: warnRows });

    const models = data.models || {};
    const modelRows = (models.primary || []).map((m) => [m.label, m.role, '', '', '', '', '', '']);
    if (models.errorPct != null) {
      modelRows.push(['error_share_pct_24h', models.errorPct, models.note || '', '', '', '', '', '']);
    }
    if (modelRows.length) blocks.push({ section: 'models', rows: modelRows });

    Csv.downloadSections(`cutup-ai-ops-${preset}-${Date.now()}.csv`, FIELDS, blocks);
  }

  function bindEvents() {
    document.getElementById('aistExportCsvBtn')?.addEventListener('click', exportCsv);
    document.getElementById('aistLiveToggle')?.addEventListener('click', () => {
      state.liveMode = !state.liveMode;
      if (state.liveMode) startLivePoll();
      else stopLivePoll();
      const root = document.getElementById('aiStateWorkspace');
      if (root && state.data) root.innerHTML = buildHtml(state.data);
      bindEvents();
    });
    document.getElementById('aistRefreshBtn')?.addEventListener('click', () => load({ silent: false }));
    document.getElementById('aistPresetSelect')?.addEventListener('change', (e) => {
      state.preset = e.target.value || '24h';
      load({ silent: false });
    });
  }

  function startLivePoll() {
    stopLivePoll();
    state.liveTimer = setInterval(() => load({ silent: true }), LIVE_POLL_MS);
  }

  function stopLivePoll() {
    if (state.liveTimer) clearInterval(state.liveTimer);
    state.liveTimer = null;
  }

  async function fetchData() {
    return apiGet('aiState', { preset: state.preset });
  }

  async function load(opts = {}) {
    const { silent = false, fullRender = true } = opts;
    const root = document.getElementById('aiStateWorkspace');
    if (!root) return;

    if (fullRender && !silent) {
      root.classList.add('aist-skeleton');
      root.innerHTML = '<div class="aist-kpi-grid"><div class="aist-kpi"></div><div class="aist-kpi"></div><div class="aist-kpi"></div></div>';
      root.innerHTML = fixHtml(root.innerHTML);
    }

    try {
      const data = await fetchData();
      if (data?.fatal && !data?.kpis) {
        const legacy = document.getElementById('opsLegacyWrap');
        if (legacy && typeof adminOpsFetch === 'function' && typeof renderOpsCommandCenter === 'function') {
          legacy.hidden = false;
          legacy.removeAttribute('aria-hidden');
          root.classList.remove('aist-skeleton');
          root.innerHTML =
            '<p class="aist-partial-note">Core AI telemetry is unavailable — showing legacy Instalogist snapshot below.</p>';
          try {
            renderOpsCommandCenter(await adminOpsFetch());
            return;
          } catch (_e2) {
            /* fall through */
          }
        }
      }
      state.data = data;
      state.hasRendered = true;
      root.classList.remove('aist-skeleton');
      root.innerHTML = buildHtml(data);
      bindEvents();
      if (data.cost && typeof Chart !== 'undefined') {
        requestAnimationFrame(() => window.CutupAiStateCharts?.renderAll?.(data.cost));
      }
    } catch (e) {
      if (silent && state.hasRendered) return;
      root.classList.remove('aist-skeleton');
      const legacy = document.getElementById('opsLegacyWrap');
      if (legacy && typeof adminOpsFetch === 'function' && typeof renderOpsCommandCenter === 'function') {
        legacy.hidden = false;
        legacy.removeAttribute('aria-hidden');
        root.innerHTML =
          '<p class="aist-partial-note">Could not reach AI Operations — showing legacy Instalogist snapshot below.</p>';
        try {
          renderOpsCommandCenter(await adminOpsFetch());
          return;
        } catch (_e2) {
          /* fall through */
        }
      }
      root.innerHTML = '<p class="aist-empty">Could not load AI operations. Please refresh or try again later.</p>';
    }
  }

  function destroy() {
    stopLivePoll();
    window.CutupAiStateCharts?.destroyAll?.();
  }

  return { load, destroy, exportCsv, getState: () => ({ ...state }) };
})();
