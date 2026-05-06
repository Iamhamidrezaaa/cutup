/**
 * Cutup Admin Overview — executive dashboard UI
 * Depends: admin.js (apiGet, escapeHtml), Chart.js, CutupDashFmt, CutupDashCharts
 */
window.CutupAdminOverview = (function () {
  let period = '30d';
  let healthCache = null;

  function fmt() {
    return window.CutupDashFmt;
  }

  function esc(s) {
    return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s ?? '');
  }

  function renderWarmupEmptyState() {
    return `<div class="dash-warmup" role="status">
      <div class="dash-warmup-card">
        <div class="dash-warmup-icon" aria-hidden="true">📈</div>
        <h3 class="dash-warmup-title">Analytics are still warming up</h3>
        <p class="dash-warmup-desc">More insights, trends, and business intelligence will appear as your platform usage grows.</p>
      </div>
    </div>`;
  }

  function kpiCard(label, value, hint, trendPct) {
    const f = fmt();
    return `<article class="dash-kpi-card">
      <p class="dash-kpi-label">${esc(label)}</p>
      <p class="dash-kpi-value">${esc(value)}</p>
      ${trendPct != null ? f.trendHtml(trendPct) : ''}
      ${hint ? `<p class="dash-kpi-hint">${esc(hint)}</p>` : ''}
    </article>`;
  }

  function renderInsights(insights) {
    const rows = insights || [];
    if (!rows.length) {
      return `<section><h3 class="dash-section-title">Insights</h3><p class="dash-empty">No insights for this period yet.</p></section>`;
    }
    return `<section><h3 class="dash-section-title">Insights</h3><div class="dash-insights">${rows
      .map((i) => `<div class="dash-insight ${esc(i.tone || 'neutral')}">${esc(i.text)}</div>`)
      .join('')}</div></section>`;
  }

  function renderLive(live) {
    const env = healthCache?.envReadiness || {};
    const dbOk = healthCache?.database?.ok;
    const pills = [
      { lbl: 'Online users', val: live?.onlineUsers ?? '—', cls: '' },
      { lbl: 'Queue (pending pay)', val: live?.activeJobsInQueue ?? '—', cls: '' },
      { lbl: 'Failed / errors 24h', val: live?.failedJobs ?? '—', cls: Number(live?.failedJobs) > 0 ? 'warn' : 'ok' },
      { lbl: 'Avg response', val: live?.avgResponseTimeMs != null ? `${live.avgResponseTimeMs}ms` : 'N/A', cls: '' },
      { lbl: 'Database', val: dbOk ? 'OK' : 'Check', cls: dbOk ? 'ok' : 'err' },
      { lbl: 'OpenAI API', val: env.OPENAI_API_KEY ? 'Configured' : 'Missing', cls: env.OPENAI_API_KEY ? 'ok' : 'warn' },
      { lbl: 'YekPay / DB', val: env.DATABASE_URL ? 'Ready' : 'Missing', cls: env.DATABASE_URL ? 'ok' : 'warn' },
      { lbl: 'Server API', val: healthCache?.api === 'ok' ? 'Healthy' : '—', cls: healthCache?.api === 'ok' ? 'ok' : 'warn' }
    ];
    return `<section><h3 class="dash-section-title">Live monitoring</h3>
      <div class="dash-live-grid">${pills
        .map(
          (p) =>
            `<div class="dash-live-pill ${esc(p.cls)}"><div class="val">${esc(String(p.val))}</div><div class="lbl">${esc(p.lbl)}</div></div>`
        )
        .join('')}</div></section>`;
  }

  function renderActivity(activity) {
    const rows = activity || [];
    if (!rows.length) return `<p class="dash-empty">No recent activity.</p>`;
    return `<ul class="dash-activity">${rows
      .map(
        (a) => `<li>
        <span class="dash-activity-dot" aria-hidden="true"></span>
        <span><strong>${esc(a.label)}</strong><br><span class="metric-subtle">${esc(a.detail || '')}</span></span>
        <span class="metric-subtle">${esc(fmt().date(a.at))}</span>
      </li>`
      )
      .join('')}</ul>`;
  }

  function renderTopCustomers(rows) {
    if (!rows?.length) return `<p class="dash-empty">No customer data yet.</p>`;
    const f = fmt();
    return `<div class="dash-table-wrap"><table><thead><tr>
      <th>Email</th><th>Plan</th><th>Usage</th><th>Revenue</th><th>Last active</th><th>Country</th>
    </tr></thead><tbody>${rows
      .map(
        (u) => `<tr>
        <td>${esc(u.email)}</td>
        <td>${esc(f.planLabel(u.plan))}</td>
        <td>${esc(f.num(u.totalUsage, 1))} min</td>
        <td>${esc(f.eur(u.revenue))}</td>
        <td>${esc(f.date(u.lastActive))}</td>
        <td>${esc(u.country || '—')}</td>
      </tr>`
      )
      .join('')}</tbody></table></div>`;
  }

  function renderDashboard(d) {
    const f = fmt();
    const rev = d.revenue || {};
    const sub = d.subscriptions || {};
    const users = d.users || {};
    const ai = d.ai || {};
    const storage = d.storage || {};
    const conv = d.conversion || {};

    return `
      ${renderInsights(d.insights)}
      <section><h3 class="dash-section-title">Revenue</h3><div class="dash-kpi-grid">${[
        kpiCard('Total revenue', f.eur(rev.total), 'Successful payments in period', rev.growthPct),
        kpiCard('MRR (estimate)', f.eur(rev.mrr), 'Active paid plans × list price'),
        kpiCard('Successful payments', f.num(rev.payments), 'In selected period'),
        kpiCard('Revenue growth', rev.growthPct != null ? `${rev.growthPct}%` : '—', 'Vs previous period')
      ].join('')}</div></section>
      <section><h3 class="dash-section-title">Subscriptions</h3><div class="dash-kpi-grid">${[
        kpiCard('Active subscriptions', f.num(sub.active), 'Paid plans, active status'),
        kpiCard('Trial users', f.num(sub.trial), 'Status trialing'),
        kpiCard('Expired / canceled', f.num(sub.expired), 'Non-active paid'),
        kpiCard('Churn rate', `${sub.churnRate ?? 0}%`, 'Last 30 days'),
        kpiCard('Upgrade / downgrade ratio', sub.upgradeDowngradeRatio != null ? String(sub.upgradeDowngradeRatio) : '—', '90d payment heuristic')
      ].join('')}</div></section>
      <section><h3 class="dash-section-title">Users</h3><div class="dash-kpi-grid">${[
        kpiCard('New users', f.num(users.newUsers), 'Registered in period'),
        kpiCard('DAU', f.num(users.dau), 'Distinct users, 24h'),
        kpiCard('WAU', f.num(users.wau), '7-day window'),
        kpiCard('MAU', f.num(users.mau), '30-day window'),
        kpiCard('Returning users', users.returningPct != null ? `${users.returningPct}%` : '—', '2+ active days in 30d')
      ].join('')}</div></section>
      <section><h3 class="dash-section-title">AI usage</h3><div class="dash-kpi-grid">${[
        kpiCard('Processed minutes', f.num(ai.totalMinutes, 1), 'Usage in period'),
        kpiCard('OpenAI est. cost', f.eur(ai.estimatedCostEur), '~€0.0055/min estimate'),
        kpiCard('Avg processing', `${f.num(ai.avgProcessingMinutes, 1)} min`, 'Per transcription'),
        kpiCard('Avg transcript length', f.num(ai.avgTranscriptLength, 0), 'Characters'),
        kpiCard('Translations', f.num(ai.translationUsage), 'translationOnly events'),
        kpiCard('Summaries', f.num(ai.summaryUsage), 'Summarization runs'),
        kpiCard('Cost per user', ai.costPerUser != null ? f.eur(ai.costPerUser) : '—', 'Active in period')
      ].join('')}</div></section>
      <section><h3 class="dash-section-title">Storage &amp; outputs</h3><div class="dash-kpi-grid">${[
        kpiCard('Saved transcripts', f.num(storage.savedTranscripts), 'Saved outputs'),
        kpiCard('Summaries saved', f.num(storage.summaries), 'Saved outputs'),
        kpiCard('SRT exports', f.num(storage.srtExports), 'Type srt'),
        kpiCard('DOCX exports', f.num(storage.docxExports), 'Type docx'),
        kpiCard('TXT exports', f.num(storage.txtExports), 'Type txt'),
        kpiCard('Storage estimate', f.bytes(storage.storageBytes), 'Content bytes in DB')
      ].join('')}</div></section>
      <section><h3 class="dash-section-title">Offers &amp; conversion</h3><div class="dash-kpi-grid">${[
        kpiCard('Conversion rate', `${conv.conversionRate ?? 0}%`, 'Success / pricing views (30d)'),
        kpiCard('Checkout completion', `${conv.checkoutCompletionPct ?? 0}%`, 'Success / started'),
        kpiCard('Abandoned checkouts', f.num(conv.abandonedCheckouts), 'Started − success'),
        kpiCard('Coupon usage', f.num(conv.couponUsage), `${conv.activeOffers ?? 0} active offers`)
      ].join('')}</div></section>
      <section>
        <h3 class="dash-section-title">Analytics charts</h3>
        <div class="dash-charts-grid">
          <div class="dash-chart-card wide"><h3>Revenue over time</h3><div class="dash-chart-wrap"><canvas id="dashChartRevenue"></canvas></div></div>
          <div class="dash-chart-card narrow"><h3>User growth</h3><div class="dash-chart-wrap"><canvas id="dashChartUserGrowth"></canvas></div></div>
          <div class="dash-chart-card wide"><h3>Usage by feature</h3><div class="dash-chart-wrap"><canvas id="dashChartFeatures"></canvas></div></div>
          <div class="dash-chart-card narrow"><h3>Plans distribution</h3><div class="dash-chart-wrap"><canvas id="dashChartPlans"></canvas></div></div>
          <div class="dash-chart-card narrow"><h3>Top countries</h3><div class="dash-chart-wrap"><canvas id="dashChartCountries"></canvas></div></div>
          <div class="dash-chart-card wide"><h3>AI cost vs revenue</h3><div class="dash-chart-wrap"><canvas id="dashChartCostRevenue"></canvas></div></div>
        </div>
      </section>
      ${renderLive(d.live)}
      <div class="dash-two-col">
        <section style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;">
          <h3 class="dash-section-title">Recent activity</h3>
          ${renderActivity(d.activity)}
        </section>
        <section style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;">
          <h3 class="dash-section-title">Top customers</h3>
          ${renderTopCustomers(d.topCustomers)}
        </section>
      </div>
    `;
  }

  function bindTimeframe() {
    document.querySelectorAll('.dash-tf-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-period') || '30d';
        if (p === period) return;
        period = p;
        document.querySelectorAll('.dash-tf-btn').forEach((b) => b.classList.toggle('active', b === btn));
        load();
      });
    });
  }

  async function fetchHealth() {
    try {
      healthCache = await apiGet('health');
    } catch (_e) {
      healthCache = null;
    }
  }

  async function load(selectedPeriod) {
    if (selectedPeriod) period = selectedPeriod;
    const root = document.getElementById('overviewDashboard');
    if (!root) return;

    root.classList.add('dash-skeleton');
    root.innerHTML = `
      <div class="dash-kpi-grid">${Array(8).fill('<div class="dash-kpi-card"></div>').join('')}</div>
      <div class="dash-charts-grid"><div class="dash-chart-card wide"></div><div class="dash-chart-card"></div></div>`;
    window.CutupDashCharts?.destroyAll?.();

    try {
      const [data] = await Promise.all([apiGet('overview', { period }), fetchHealth()]);
      root.classList.remove('dash-skeleton');

      const dash = data.dashboard;
      if (!dash) {
        root.innerHTML = renderWarmupEmptyState();
        if (typeof renderOverview === 'function') renderOverview(data);
        const legacy = document.getElementById('overviewCards');
        if (legacy) {
          legacy.hidden = false;
          legacy.removeAttribute('aria-hidden');
        }
        return;
      }

      const legacy = document.getElementById('overviewCards');
      if (legacy) {
        legacy.hidden = true;
        legacy.setAttribute('aria-hidden', 'true');
      }

      root.innerHTML = renderDashboard(dash);
      requestAnimationFrame(() => window.CutupDashCharts?.renderAll?.(dash));
    } catch (e) {
      root.classList.remove('dash-skeleton');
      root.innerHTML = `<p class="dash-empty">Failed to load overview: ${esc(e.message || 'error')}</p>`;
    }
  }

  function init() {
    bindTimeframe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { load, getPeriod: () => period };
})();
