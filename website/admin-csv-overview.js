/**
 * Overview dashboard CSV export
 */
window.CutupAdminOverviewCsv = (function () {
  const FIELDS = ['metric', 'value', 'value2', 'value3', 'value4', 'value5', 'period_scope'];

  function pushSummary(rows, scope, metrics) {
    for (const [metric, value] of metrics) {
      rows.push({ section: 'summary', fields: [metric, value, scope, '', '', '', ''] });
    }
  }

  function buildSections(dash, health) {
    const rows = [];
    const period = dash.period || '30d';
    const scope = dash.range?.from
      ? `${dash.range.from} → ${dash.range.to}`
      : String(period);

    const rev = dash.revenue || {};
    const sub = dash.subscriptions || {};
    const users = dash.users || {};
    const ai = dash.ai || {};
    const storage = dash.storage || {};
    const conv = dash.conversion || {};
    const live = dash.live || {};

    pushSummary(rows, scope, [
      ['revenue_period_eur', rev.total],
      ['revenue_lifetime_eur', rev.lifetime],
      ['mrr_estimate_eur', rev.mrr],
      ['payments_success_count', rev.payments],
      ['revenue_growth_pct', rev.growthPct],
      ['subscriptions_active', sub.active],
      ['subscriptions_trial', sub.trial],
      ['subscriptions_expired', sub.expired],
      ['churn_rate_pct', sub.churnRate],
      ['upgrade_downgrade_ratio', sub.upgradeDowngradeRatio],
      ['users_new', users.newUsers],
      ['users_active_in_period', users.activeInPeriod],
      ['users_dau', users.dau],
      ['users_wau', users.wau],
      ['users_mau', users.mau],
      ['users_returning_pct', users.returningPct],
      ['ai_processed_minutes', ai.totalMinutes],
      ['ai_estimated_cost_eur', ai.estimatedCostEur],
      ['ai_avg_processing_min', ai.avgProcessingMinutes],
      ['ai_avg_transcript_chars', ai.avgTranscriptLength],
      ['ai_translations', ai.translationUsage],
      ['ai_summaries', ai.summaryUsage],
      ['ai_cost_per_user_eur', ai.costPerUser],
      ['storage_saved_transcripts', storage.savedTranscripts],
      ['storage_summaries', storage.summaries],
      ['storage_srt_exports', storage.srtExports],
      ['storage_mp4_exports', storage.mp4Exports],
      ['storage_docx_exports', storage.docxExports],
      ['storage_txt_exports', storage.txtExports],
      ['storage_bytes_estimate', storage.storageBytes],
      ['conversion_rate_pct', conv.conversionRate],
      ['checkout_completion_pct', conv.checkoutCompletionPct],
      ['abandoned_checkouts', conv.abandonedCheckouts],
      ['coupon_usage', conv.couponUsage],
      ['live_online_users', live.onlineUsers],
      ['live_pending_payments', live.pendingPayments ?? live.activeJobsInQueue],
      ['live_errors_24h', live.errors24h ?? live.failedJobs],
      ['health_database_ok', health?.database?.ok],
      ['health_api_ok', health?.api === 'ok' || health?.overall === 'healthy']
    ]);

    for (const pt of rev.timeline || []) {
      rows.push({
        section: 'revenue_timeline',
        fields: [pt.day, pt.revenue, '', '', '', '', '']
      });
    }

    const feat = dash.charts?.featureUsage || {};
    for (const [feature, count] of Object.entries({
      transcript: feat.transcript,
      translate: feat.translate,
      summary: feat.summary,
      download_video: feat.downloadVideo,
      download_audio: feat.downloadAudio
    })) {
      rows.push({ section: 'feature_usage', fields: [feature, count, scope, '', '', '', ''] });
    }

    for (const p of rev.byPlan || []) {
      rows.push({
        section: 'revenue_by_plan',
        fields: [p.plan, p.revenue, p.count, scope, '', '', '']
      });
    }

    for (const c of users.countries || []) {
      rows.push({
        section: 'countries',
        fields: [c.country, c.count, scope, '', '', '', '']
      });
    }

    for (const pt of dash.charts?.costVsRevenue || []) {
      rows.push({
        section: 'cost_vs_revenue',
        fields: [pt.day, pt.revenue, pt.costEur, scope, '', '', '']
      });
    }

    for (const u of dash.topCustomers || []) {
      rows.push({
        section: 'top_customers',
        fields: [u.email, u.plan, u.totalUsage, u.revenue, u.country, u.lastActive, scope]
      });
    }

    for (const a of dash.activity || []) {
      rows.push({
        section: 'activity',
        fields: [a.type, a.label, a.detail, a.at, scope, '', '']
      });
    }

    for (const i of dash.insights || []) {
      rows.push({
        section: 'insights',
        fields: [i.tone, i.text, scope, '', '', '', '']
      });
    }

    return rows;
  }

  function exportCsv(dash, health, period) {
    const Csv = window.CutupAdminCsv;
    if (!Csv || !dash) return false;
    const flat = buildSections(dash, health || null);
    if (!flat.length) return false;
    const grouped = new Map();
    for (const row of flat) {
      if (!grouped.has(row.section)) grouped.set(row.section, []);
      grouped.get(row.section).push(row.fields);
    }
    const blocks = [...grouped.entries()].map(([section, rows]) => ({ section, rows }));
    Csv.downloadSections(
      `cutup-overview-${period || dash.period || 'export'}-${Date.now()}.csv`,
      FIELDS,
      blocks
    );
    return true;
  }

  return { exportCsv, buildSections };
})();
