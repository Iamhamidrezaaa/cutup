/**
 * Cutup Admin — System Health ops command center
 */
window.CutupAdminHealth = (function () {
  let lastData = null;
  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '—';
    }
  }

  function statusLabel(s) {
    const v = String(s || 'attention').toLowerCase();
    if (v === 'healthy' || v === 'ok') return 'Operational';
    if (v === 'degraded') return 'Degraded';
    if (v === 'critical') return 'Critical';
    return 'Attention';
  }

  function badge(status) {
    const v = String(status || 'attention').toLowerCase();
    return `<span class="health-badge health-badge--${esc(v)}">${esc(statusLabel(v))}</span>`;
  }

  function renderHero(data) {
    const overall = data.overall || 'attention';
    const deploy = data.deployment || {};
    const depLine = [deploy.commit && `build ${deploy.commit}`, deploy.branch, deploy.environment]
      .filter(Boolean)
      .join(' · ');
    return `
      <header class="health-hero">
        <div>
          <h3>Operations command center</h3>
          <p>Infrastructure pulse · ${esc(fmtDate(data.checkedAt))}${depLine ? ` · ${esc(depLine)}` : ''}</p>
        </div>
        <div class="health-overall" role="status">
          <span class="health-pulse health-pulse--${esc(overall)}" aria-hidden="true"></span>
          ${esc(statusLabel(overall))}
        </div>
      </header>`;
  }

  function renderMetrics(metrics) {
    const m = metrics || {};
    const items = [
      ['Live users (15m)', m.liveUsers],
      ['Admin sessions', m.activeAdminSessions],
      ['Errors (24h)', m.errors24h],
      ['AI jobs (24h)', m.aiJobs24h],
      ['Pending payments', m.pendingPayments],
      ['Failed pay (24h)', m.failedPayments24h]
    ];
    return `<div class="health-metrics-row">${items
      .map(
        ([lbl, val]) =>
          `<article class="health-metric"><div class="lbl">${esc(lbl)}</div><div class="val">${esc(val != null ? String(val) : '—')}</div></article>`
      )
      .join('')}</div>`;
  }

  function renderComponents(components) {
    const list = components || [];
    if (!list.length) {
      return '<p class="health-empty">Live infrastructure analytics are still initializing.</p>';
    }
    return `<div class="health-grid">${list
      .map((c) => {
        const sub =
          c.metrics && c.metrics.length
            ? `<div class="health-card-metrics">${c.metrics
                .map((x) => `<span>${esc(x.label)}: <strong>${esc(x.value)}</strong></span>`)
                .join('')}</div>`
            : '';
        return `<article class="health-card" data-status="${esc(c.status)}">
          <div class="health-card-head"><h4>${esc(c.label)}</h4>${badge(c.status)}</div>
          <p class="health-card-detail">${esc(String(c.detail || '').replace(/\\n/g, '\n'))}</p>
          ${sub}
        </article>`;
      })
      .join('')}</div>`;
  }

  function renderInfra(primary, optional) {
    const prim = primary || [];
    const opt = optional || [];
  const primHtml = prim
      .map(
        (i) =>
          `<div class="health-infra-item">
            <div class="key">${esc(i.label)}</div>
            <div>${i.configured ? 'Configured' : 'Missing'}${i.meta ? ` · ${esc(i.meta)}` : ''}</div>
          </div>`
      )
      .join('');
    const optHtml = opt.length
      ? `<details class="health-optional"><summary>Optional integrations (${opt.length})</summary>
          <div class="health-infra-grid" style="margin-top:10px">${opt
            .map(
              (g) =>
                `<div class="health-infra-item"><div class="key">${esc(g.label)}</div>
                <div>${g.configured ? 'Configured' : 'Not set'}${g.webhookConfigured != null ? ` · Webhook ${g.webhookConfigured ? 'OK' : 'missing'}` : ''}</div>
                ${g.note ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(g.note)}</div>` : ''}</div>`
            )
            .join('')}</div></details>`
      : '';
    return `<section class="health-infra-section"><h3>Primary infrastructure</h3>
      <div class="health-infra-grid">${primHtml}</div>${optHtml}</section>`;
  }

  function renderWarnings(warnings) {
    if (!warnings?.length) return '';
    return `<div class="health-warnings">${warnings
      .map(
        (w) =>
          `<div class="health-warning health-warning--${esc(w.tone || 'warn')}">${esc(w.text)}</div>`
      )
      .join('')}</div>`;
  }

  function renderIncidents(incidents) {
    const list = incidents || [];
    return `<section class="health-incidents"><h3>Recent incidents & failures</h3>
      ${
        list.length
          ? `<div class="health-incident-list">${list
              .map(
                (i) =>
                  `<article class="health-incident health-warning--${esc(i.severity === 'error' ? 'error' : 'warn')}">
                    <strong>${esc(i.type)}</strong>
                    ${i.detail ? `<div>${esc(i.detail)}</div>` : ''}
                    ${i.email ? `<div class="muted">${esc(i.email)}</div>` : ''}
                    <time>${esc(fmtDate(i.at))}</time>
                  </article>`
              )
              .join('')}</div>`
          : '<p class="health-empty">No critical incidents in the last 72 hours.</p>'
      }
    </section>`;
  }

  function render(data) {
    const root = document.getElementById('healthWorkspace');
    if (!root) return;
    if (!data) {
      root.innerHTML = '<p class="health-empty">Could not load system health.</p>';
      return;
    }
    if (data.partial) {
      root.innerHTML = `
        <div class="health-root">
          ${renderHero(data)}
          <p class="health-empty">Database is not configured. Environment checks only.</p>
          ${renderInfra(data.primaryInfrastructure, data.optionalIntegrations)}
        </div>`;
      return;
    }
    root.innerHTML = `
      <div class="health-root">
        ${renderHero(data)}
        ${renderWarnings(data.warnings)}
        ${renderMetrics(data.metrics)}
        ${renderComponents(data.components)}
        ${renderInfra(data.primaryInfrastructure, data.optionalIntegrations)}
        ${renderIncidents(data.incidents)}
        <p class="muted" style="font-size:12px">${esc(data.uptimeNote || '')}</p>
      </div>`;
  }

  function renderSkeleton() {
    const root = document.getElementById('healthWorkspace');
    if (!root) return;
    root.classList.add('health-skeleton');
    root.innerHTML = '<div class="health-grid"><div class="health-card"></div><div class="health-card"></div><div class="health-card"></div></div>';
  }

  function exportCsv() {
    const Csv = window.CutupAdminCsv;
    const data = lastData;
    if (!Csv || !data) {
      if (typeof showBanner === 'function') showBanner('Load system health before exporting.');
      return;
    }
    const FIELDS = ['key', 'label', 'status', 'detail', 'extra'];
    const blocks = [];

    const summaryRows = [
      ['overall_status', data.overall, '', '', ''],
      ['checked_at', data.checkedAt, '', '', ''],
      ['deployment_commit', data.deployment?.commit, data.deployment?.branch, data.deployment?.environment, ''],
      ['database_ok', data.database?.ok, data.database?.latencyMs, '', ''],
      ['database_error', data.database?.error, '', '', '']
    ];
    blocks.push({ section: 'summary', rows: summaryRows });

    const metricRows = Object.entries(data.metrics || {}).map(([k, v]) => [k, v, '', '', '']);
    if (metricRows.length) blocks.push({ section: 'metrics', rows: metricRows });

    const componentRows = (data.components || []).map((c) => [
      c.id,
      c.label,
      c.status,
      String(c.detail || '').replace(/\n/g, ' · '),
      (c.metrics || []).map((m) => `${m.label}=${m.value}`).join('; ')
    ]);
    if (componentRows.length) blocks.push({ section: 'components', rows: componentRows });

    const infraRows = (data.primaryInfrastructure || []).map((i) => [
      i.key,
      i.label,
      i.configured ? 'configured' : 'missing',
      i.meta || '',
      i.critical ? 'critical' : 'optional'
    ]);
    if (infraRows.length) blocks.push({ section: 'primary_infrastructure', rows: infraRows });

    const optRows = (data.optionalIntegrations || []).map((i) => [
      i.provider,
      i.label,
      i.configured ? 'configured' : 'not_set',
      i.webhookConfigured == null ? '' : i.webhookConfigured ? 'webhook_ok' : 'webhook_missing',
      i.note || ''
    ]);
    if (optRows.length) blocks.push({ section: 'optional_integrations', rows: optRows });

    const incidentRows = (data.incidents || []).map((i) => [
      i.type,
      i.severity,
      i.detail,
      i.email,
      i.at
    ]);
    if (incidentRows.length) blocks.push({ section: 'incidents', rows: incidentRows });

    const warnRows = (data.warnings || []).map((w) => [w.tone, w.text, '', '', '']);
    if (warnRows.length) blocks.push({ section: 'warnings', rows: warnRows });

    Csv.downloadSections(`cutup-system-health-${Date.now()}.csv`, FIELDS, blocks);
  }

  async function load() {
    const root = document.getElementById('healthWorkspace');
    if (!root) return;
    renderSkeleton();
    try {
      const data = await apiGet('health');
      lastData = data;
      root.classList.remove('health-skeleton');
      render(data);
    } catch (e) {
      lastData = null;
      root.classList.remove('health-skeleton');
      root.innerHTML = `<p class="health-empty">System health unavailable: ${esc(e.message || e)}</p>`;
    }
  }

  return { load, render, exportCsv };
})();
