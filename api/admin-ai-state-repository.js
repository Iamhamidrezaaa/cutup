/**
 * Admin AI Operations Center — real DB telemetry (usage_history, audit_events, payments).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import {
  friendlyDbError,
  safeQuery,
  safeQueryScalar,
  tableExists,
  whenTableExists
} from './admin-db-safe.js';
import { ensurePaymentAttemptsSchema } from './payment-attempts-bootstrap.js';

const CACHE_TTL_MS = 30_000;
const OPENAI_EUR_PER_MINUTE = 0.0055;
const aiStateCache = new Map();

const TRANSLATION_ONLY_SQL = `(
  LOWER(COALESCE(h.metadata->>'translationOnly', '')) IN ('true', '1', 'yes')
  OR (h.metadata->'translationOnly')::text = 'true'
)`;

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function resolveAiStateRange({ preset = '24h' } = {}) {
  const to = new Date();
  const p = String(preset || '24h').toLowerCase();
  let from;
  if (p === '7d') from = new Date(to.getTime() - 7 * 86400000);
  else if (p === '30d') from = new Date(to.getTime() - 30 * 86400000);
  else from = new Date(to.getTime() - 24 * 86400000);
  const span = to.getTime() - from.getTime();
  return {
    from,
    to,
    preset: p,
    prevFrom: new Date(from.getTime() - span),
    prevTo: new Date(from.getTime() - 1)
  };
}

function pipelineStatus({ successPct, failures24h, active5m, lastActivityAt }) {
  if (failures24h >= 10 && successPct < 90) return 'critical';
  if (failures24h >= 3 || successPct < 95) return 'degraded';
  if (active5m > 0 || (lastActivityAt && Date.now() - Date.parse(lastActivityAt) < 3600000)) return 'healthy';
  if (lastActivityAt) return 'idle';
  return 'attention';
}

async function queryUsagePipeline(pool, conditionSql, label) {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE h.created_at >= NOW() - INTERVAL '24 hours')::int AS throughput_24h,
         COUNT(*) FILTER (WHERE h.created_at >= NOW() - INTERVAL '5 minutes')::int AS active_5m,
         COALESCE(AVG(CASE WHEN h.minutes > 0 AND h.created_at >= NOW() - INTERVAL '24 hours'
           THEN h.minutes END), 0)::float AS avg_latency_min,
         MAX(h.created_at) AS last_activity
       FROM usage_history h
       WHERE ${conditionSql}`
    );
    const row = r.rows[0] || {};
    const throughput = Number(row.throughput_24h || 0);
    return {
      id: label,
      label,
      throughput24h: throughput,
      activeJobs: Number(row.active_5m || 0),
      queuedJobs: null,
      avgLatencyMin: Math.round(Number(row.avg_latency_min || 0) * 10) / 10,
      failures24h: 0,
      successPct: throughput > 0 ? 100 : null,
      lastActivityAt: row.last_activity?.toISOString?.() || row.last_activity || null,
      status: 'healthy'
    };
  } catch (e) {
    return {
      id: label,
      label,
      unavailable: true,
      userMessage: friendlyDbError(label, e),
      status: 'attention'
    };
  }
}

async function queryPaymentPipeline(pool) {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS throughput_24h,
        COUNT(*) FILTER (WHERE status IN ('failed','canceled') AND created_at >= NOW() - INTERVAL '24 hours')::int AS failed_24h,
        COUNT(*) FILTER (WHERE status = 'success' AND created_at >= NOW() - INTERVAL '24 hours')::int AS success_24h,
        MAX(updated_at) AS last_activity
      FROM payments
      WHERE LOWER(COALESCE(provider, gateway, 'yekpay')) = 'yekpay'
    `);
    const row = r.rows[0] || {};
    const success = Number(row.success_24h || 0);
    const failed = Number(row.failed_24h || 0);
    const total = success + failed;
    const successPct = total > 0 ? Math.round((success / total) * 1000) / 10 : null;
    const p = {
      id: 'payment_verification',
      label: 'Payment verification',
      throughput24h: Number(row.throughput_24h || 0),
      activeJobs: Number(row.pending || 0),
      queuedJobs: Number(row.pending || 0),
      failures24h: failed,
      successPct,
      lastActivityAt: row.last_activity?.toISOString?.() || row.last_activity || null,
      avgLatencyMin: null
    };
    p.status = pipelineStatus({ ...p, active5m: p.activeJobs });
    return p;
  } catch (e) {
    return {
      id: 'payment_verification',
      label: 'Payment verification',
      status: 'attention',
      unavailable: true,
      userMessage: friendlyDbError('Payment verification', e)
    };
  }
}

async function queryPaymentAttemptsPending(pool) {
  const r = await whenTableExists(
    pool,
    'payment_attempts',
    async () => {
      const q = await safeQueryScalar(
        pool,
        `SELECT COUNT(*)::int AS c FROM payment_attempts WHERE status = 'pending'`,
        [],
        { context: 'Payment verification' }
      );
      return Number(q.value || 0);
    },
    { fallback: null, friendly: 'Payment verification telemetry is not available yet.' }
  );
  return r;
}

async function queryCallbackPipeline(pool) {
  try {
    const r = await pool.query(`
      SELECT COUNT(*)::int AS failures
      FROM audit_events
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND event_name IN ('payment_failed','payment_verify_failed','callback_failed','yekpay_verify_failed')
    `);
    const failures = Number(r.rows[0]?.failures || 0);
    return {
      id: 'callback_queue',
      label: 'Callback queue',
      throughput24h: failures,
      activeJobs: null,
      queuedJobs: null,
      failures24h: failures,
      successPct: failures === 0 ? 100 : null,
      lastActivityAt: null,
      status: failures >= 5 ? 'degraded' : failures > 0 ? 'attention' : 'healthy'
    };
  } catch (e) {
    return {
      id: 'callback_queue',
      label: 'Callback queue',
      status: 'attention',
      unavailable: true,
      userMessage: friendlyDbError('Callback queue', e)
    };
  }
}

async function queryKpis(pool, range, prevRange, warnings = []) {
  const todayStart = startOfUtcDay(new Date()).toISOString();
  const run = async (from, to) => {
    const params = [];
    const clauses = [];
    if (from) {
      params.push(from.toISOString());
      clauses.push(`h.created_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(to.toISOString());
      clauses.push(`h.created_at <= $${params.length}::timestamptz`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS jobs,
         COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes,
         COALESCE(AVG(CASE WHEN h.type = 'transcription' AND h.minutes > 0 THEN h.minutes END), 0)::float AS avg_transcribe_min
       FROM usage_history h ${where}`,
      params
    );
    const row = r.rows[0] || {};
    return {
      jobs: Number(row.jobs || 0),
      minutes: Number(row.minutes || 0),
      avgTranscribeMin: Number(row.avg_transcribe_min || 0)
    };
  };

  let cur;
  let prev;
  try {
    [cur, prev] = await Promise.all([run(range.from, range.to), run(prevRange.from, prevRange.to)]);
  } catch (e) {
    console.error('[admin aiState] KPI usage_history', e);
    throw e;
  }

  const todayQ = await safeQuery(
    pool,
    `SELECT COUNT(*)::int AS jobs,
            COALESCE(SUM(CASE WHEN minutes > 0 THEN minutes ELSE 0 END), 0)::float AS minutes
     FROM usage_history WHERE created_at >= $1::timestamptz`,
    [todayStart],
    { context: 'Usage today' }
  );
  const activeQ = await safeQueryScalar(
    pool,
    `SELECT COUNT(*)::int AS c FROM usage_history WHERE created_at >= NOW() - INTERVAL '5 minutes'`,
    [],
    { context: 'Active jobs' }
  );
  const errorsQ = await tableExists(pool, 'audit_events')
    ? await safeQueryScalar(
        pool,
        `SELECT COUNT(*)::int AS c FROM audit_events
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND (event_type = 'error' OR event_name LIKE '%failed%' OR event_name LIKE '%error%')`,
        [],
        { context: 'Error events' }
      )
    : { ok: false, value: 0, warning: 'Audit telemetry is not available yet.' };
  if (errorsQ.warning) warnings.push({ id: 'audit_events', message: errorsQ.warning });

  const pendingPayQ = await safeQueryScalar(
    pool,
    `SELECT COUNT(*)::int AS c FROM payments WHERE status = 'pending'`,
    [],
    { context: 'Pending payments' }
  );

  const attemptsR = await queryPaymentAttemptsPending(pool);
  if (attemptsR.warning) {
    warnings.push({ id: 'payment_attempts', message: attemptsR.warning });
  }

  const todayRow = todayQ.ok ? todayQ.rows[0] || {} : {};
  const jobsToday = Number(todayRow.jobs || 0);
  const minutesToday = Number(todayRow.minutes || 0);
  const errors = Number(errorsQ.value || 0);
  const totalJobs24h = cur.jobs;
  const failureRate = totalJobs24h + errors > 0 ? Math.round((errors / (totalJobs24h + errors)) * 1000) / 10 : 0;
  const successRate = totalJobs24h + errors > 0 ? Math.round((totalJobs24h / (totalJobs24h + errors)) * 1000) / 10 : null;

  const topFeatureQ = await safeQuery(
    pool,
    `SELECT h.type, COUNT(*)::int AS c FROM usage_history h
     WHERE h.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY 1 ORDER BY c DESC LIMIT 1`,
    [],
    { context: 'Top feature' }
  );

  let aiLoad = 'low';
  const active = Number(activeQ.value || 0);
  if (active >= 15) aiLoad = 'high';
  else if (active >= 5) aiLoad = 'medium';

  const pendingPay = Number(pendingPayQ.value || 0);
  const attemptsPending = attemptsR.ok ? Number(attemptsR.value || 0) : 0;

  return {
    activeAiJobs: active + pendingPay + (attemptsPending || 0),
    jobsProcessedToday: jobsToday,
    queueBacklog: pendingPay + (attemptsPending || 0),
    avgProcessingTimeMin: Math.round(cur.avgTranscribeMin * 10) / 10,
    successRate,
    failureRate,
    aiCostTodayEur: Math.round(minutesToday * OPENAI_EUR_PER_MINUTE * 100) / 100,
    openaiRequestCount: jobsToday,
    tokensProcessed: null,
    tokensNote: 'Token usage is not persisted yet.',
    avgQueueWaitMin: null,
    queueWaitNote: 'Queue wait telemetry not yet available.',
    peakConcurrency: active,
    liveWorkers: null,
    workersNote: 'Dedicated worker pool not instrumented.',
    retryRate: null,
    retryNote: 'Retry rate requires job queue instrumentation.',
    mostUsedFeature: topFeatureQ.ok ? topFeatureQ.rows[0]?.type || '—' : '—',
    aiLoadLevel: aiLoad,
    trends: {
      jobs: pctChange(cur.jobs, prev.jobs),
      cost: pctChange(cur.minutes * OPENAI_EUR_PER_MINUTE, prev.minutes * OPENAI_EUR_PER_MINUTE)
    },
    unavailable: {}
  };
}

async function queryCostIntelligence(pool, range, warnings = []) {
  const params = [range.from.toISOString(), range.to.toISOString()];
  const [timeline, byFeature, topUsers, exports] = await Promise.all([
    safeQuery(
      pool,
      `SELECT to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') AS day,
              COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes
       FROM usage_history h
       WHERE h.created_at >= $1::timestamptz AND h.created_at <= $2::timestamptz
       GROUP BY 1 ORDER BY 1`,
      params,
      { context: 'Cost timeline' }
    ).then((r) => (r.ok ? { rows: r.rows } : { rows: [] })),
    safeQuery(
      pool,
      `SELECT
         COUNT(*) FILTER (WHERE h.type = 'transcription' AND NOT (${TRANSLATION_ONLY_SQL}))::int AS transcript,
         COUNT(*) FILTER (WHERE ${TRANSLATION_ONLY_SQL})::int AS translate,
         COUNT(*) FILTER (WHERE h.type = 'summarization')::int AS summary,
         COUNT(*) FILTER (WHERE h.type = 'download')::int AS download,
         COUNT(*) FILTER (WHERE h.type = 'srt')::int AS srt
       FROM usage_history h
       WHERE h.created_at >= $1::timestamptz AND h.created_at <= $2::timestamptz`,
      params,
      { context: 'Cost by feature' }
    ).then((r) => (r.ok ? { rows: r.rows } : { rows: [] })),
    safeQuery(
      pool,
      `SELECT u.email,
              COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes
       FROM usage_history h
       JOIN users u ON u.id = h.user_id
       WHERE h.created_at >= $1::timestamptz AND h.created_at <= $2::timestamptz
       GROUP BY u.email
       ORDER BY minutes DESC
       LIMIT 8`,
      params,
      { context: 'Top users by cost' }
    ).then((r) => (r.ok ? { rows: r.rows } : { rows: [] })),
    safeQuery(
      pool,
      `SELECT COUNT(*)::int AS exports,
              COALESCE(SUM(CASE WHEN h.minutes > 0 THEN h.minutes ELSE 0 END), 0)::float AS minutes
       FROM usage_history h
       WHERE h.created_at >= $1::timestamptz AND h.created_at <= $2::timestamptz
         AND h.type IN ('download','srt')`,
      params,
      { context: 'Export cost' }
    ).then((r) => (r.ok ? { rows: r.rows } : { rows: [] }))
  ]);

  const feat = byFeature.rows?.[0] || byFeature[0] || {};
  const exportRow = exports.rows?.[0] || exports[0] || {};
  const timelineRows = timeline.rows || [];
  const totalMinutes = timelineRows.reduce((s, x) => s + Number(x.minutes || 0), 0);
  const exportCount = Number(exportRow.exports || 0);

  return {
    estimatedSpendEur: Math.round(totalMinutes * OPENAI_EUR_PER_MINUTE * 100) / 100,
    byFeature: {
      transcript: Number(feat.transcript || 0),
      translate: Number(feat.translate || 0),
      summary: Number(feat.summary || 0),
      download: Number(feat.download || 0),
      srt: Number(feat.srt || 0)
    },
    topUsers: (topUsers.rows || []).map((r) => ({
      email: r.email,
      minutes: Math.round(Number(r.minutes || 0) * 10) / 10,
      costEur: Math.round(Number(r.minutes || 0) * OPENAI_EUR_PER_MINUTE * 100) / 100
    })),
    timeline: (timeline.rows || []).map((r) => ({
      day: r.day,
      costEur: Math.round(Number(r.minutes || 0) * OPENAI_EUR_PER_MINUTE * 100) / 100
    })),
    costPerMinuteEur: OPENAI_EUR_PER_MINUTE,
    costPerExportEur:
      exportCount > 0
        ? Math.round(((Number(exportRow.minutes || 0) * OPENAI_EUR_PER_MINUTE) / exportCount) * 100) / 100
        : null
  };
}

async function queryIncidents(pool) {
  try {
    const r = await pool.query(
      `SELECT event_type, event_name,
              COALESCE(metadata->>'email', '') AS email,
              COALESCE(metadata->>'error', metadata->>'message', '') AS detail,
              created_at
       FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '72 hours'
         AND (
           event_type = 'error'
           OR event_name IN (
             'openai_error', 'transcribe_failed', 'summarize_failed', 'translate_failed',
             'payment_failed', 'payment_verify_failed', 'callback_failed', 'yekpay_verify_failed',
             'ffmpeg_failed', 'ytdlp_failed', 'export_failed'
           )
         )
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return r.rows.map((row) => {
      const name = String(row.event_name || '');
      let severity = row.event_type === 'error' ? 'critical' : 'warning';
      if (name.includes('failed') || name.includes('error')) severity = 'critical';
      return {
        severity,
        status: 'open',
        subsystem: name.split('_')[0] || 'platform',
        type: name,
        impact: row.detail ? String(row.detail).slice(0, 200) : 'Operational event recorded',
        email: row.email || null,
        at: row.created_at?.toISOString?.() || row.created_at
      };
    });
  } catch {
    return [];
  }
}

async function queryCronJobs(pool) {
  const jobs = [];
  try {
    const conv = await pool.query(
      `SELECT MAX(created_at) AS last_run, COUNT(*)::int AS runs_24h
       FROM conversion_email_log WHERE created_at >= NOW() - INTERVAL '24 hours'`
    );
    const row = conv.rows[0] || {};
    jobs.push({
      id: 'conversion_emails',
      label: 'Conversion emails',
      lastRunAt: row.last_run?.toISOString?.() || row.last_run || null,
      nextRunAt: null,
      runs24h: Number(row.runs_24h || 0),
      failures24h: 0,
      status: row.last_run ? 'healthy' : 'idle',
      note: 'Scheduled via /api/cron/conversion-emails'
    });
  } catch {
    jobs.push({ id: 'conversion_emails', label: 'Conversion emails', status: 'unavailable' });
  }

  jobs.push(
    {
      id: 'retention_cleanup',
      label: 'Retention cleanup',
      status: 'unknown',
      note: 'Runs inside retention API paths — no central schedule telemetry yet.'
    },
    {
      id: 'analytics_aggregation',
      label: 'Analytics aggregation',
      status: 'unknown',
      note: 'Event writes are realtime; batch rollup not instrumented.'
    },
    {
      id: 'payment_retry',
      label: 'Payment verification retries',
      status: 'unknown',
      note: 'Tracked via payment_attempts when customers retry checkout.'
    }
  );
  return jobs;
}

async function queryModels(pool) {
  const r = await safeQuery(
    pool,
    `SELECT h.type, COUNT(*)::int AS c
     FROM usage_history h
     WHERE h.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY 1 ORDER BY c DESC`,
    [],
    { context: 'Model distribution' }
  );
  if (!r.ok) return null;
  const errors = (await tableExists(pool, 'audit_events'))
    ? await safeQueryScalar(
        pool,
        `SELECT COUNT(*)::int AS c FROM audit_events
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND (event_name LIKE '%openai%' OR event_name LIKE '%transcribe%' OR event_name LIKE '%summarize%')
           AND event_type = 'error'`,
        [],
        { context: 'Model errors' }
      )
    : { value: 0 };
  const total = r.rows.reduce((s, x) => s + Number(x.c || 0), 0);
  const errN = Number(errors.value || 0);
  return {
    primary: [
      { id: 'whisper', label: 'OpenAI Whisper', role: 'transcription' },
      { id: 'gpt', label: 'OpenAI GPT', role: 'summarization & translation' }
    ],
    requestDistribution: r.rows.map((x) => ({
      type: x.type,
      count: Number(x.c || 0),
      pct: total > 0 ? Math.round((Number(x.c) / total) * 1000) /  10 : 0
    })),
    errorPct: total + errN > 0 ? Math.round((errN / (total + errN)) * 1000) / 10 : 0,
    rateLimitEvents24h: null,
    timeoutEvents24h: null,
    note: 'Model-level latency and rate-limit counters are not persisted yet.'
  };
}

function buildInsights(data) {
  const insights = [];
  const k = data.kpis || {};
  const c = data.cost || {};
  const t = k.trends || {};

  if (t.jobs != null && t.jobs > 15) {
    insights.push({ tone: 'ok', text: `AI job volume increased ${t.jobs}% vs the previous period.` });
  }
  if (t.jobs != null && t.jobs < -15) {
    insights.push({ tone: 'neutral', text: `AI job volume decreased ${Math.abs(t.jobs)}% vs the previous period.` });
  }
  const top = c.topUsers?.[0];
  const second = c.topUsers?.[1];
  const totalCost = c.estimatedSpendEur || 0;
  if (top && totalCost > 0 && top.costEur / totalCost >= 0.25) {
    const pct = Math.round((top.costEur / totalCost) * 100);
    insights.push({
      tone: 'warn',
      text: `One customer accounts for about ${pct}% of estimated AI spend in this window.`
    });
  }
  const translate = c.byFeature?.translate || 0;
  const transcript = c.byFeature?.transcript || 0;
  if (translate > 0 && transcript > 0 && translate / (transcript + translate) > 0.35) {
    const pct = Math.round((translate / (transcript + translate)) * 100);
    insights.push({ tone: 'ok', text: `Translation usage represents ~${pct}% of transcription+translation activity.` });
  }
  if (k.failureRate != null && k.failureRate > 5) {
    insights.push({ tone: 'warn', text: `Elevated operational failure signals in the last 24h (${k.failureRate}% error share).` });
  }
  const ig = (data.pipelines || []).find((p) => p.id === 'instagram');
  const yt = (data.pipelines || []).find((p) => p.id === 'youtube');
  if (ig && yt && ig.throughput24h > yt.throughput24h * 0.5) {
    insights.push({ tone: 'neutral', text: 'Instagram processing throughput is a growing share of platform activity.' });
  }
  if (!insights.length) {
    insights.push({
      tone: 'neutral',
      text: 'Operational telemetry is stable. Insights will sharpen as activity and error instrumentation grow.'
    });
  }
  return insights.slice(0, 6);
}

async function tryInstalogistSnapshot() {
  const remoteUrl = String(process.env.INSTALOGIST_OPERATIONAL_STATE_URL || '').trim();
  if (!remoteUrl) return null;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(remoteUrl, { signal: ac.signal, headers: { Accept: 'application/json' } });
    clearTimeout(tid);
    if (!r.ok) return { error: 'upstream', status: r.status };
    return { envelope: await r.json(), source: 'url' };
  } catch (e) {
    return { error: e?.message || 'fetch_failed' };
  }
}

/**
 * @param {{ preset?: string }} filters
 */
function emptyAiStateShell(extra = {}) {
  return {
    partial: true,
    fatal: false,
    checkedAt: new Date().toISOString(),
    telemetryWarnings: [],
    queueTelemetryAvailable: false,
    kpis: null,
    pipelines: [],
    cost: null,
    queue: { available: false, message: 'Queue telemetry not yet available.' },
    incidents: [],
    cronJobs: [],
    models: null,
    insights: [],
    instalogist: null,
    ...extra
  };
}

export async function getAdminAiStateDashboardDb(filters = {}) {
  const cacheKey = JSON.stringify(filters);
  const hit = aiStateCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  if (!isBillingDbConfigured()) {
    const data = emptyAiStateShell({
      insights: [
        { tone: 'warn', text: 'Database is not configured — AI operations metrics require DATABASE_URL.' }
      ]
    });
    aiStateCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  const pool = getPool();
  const telemetryWarnings = [];

  try {
    const boot = await ensurePaymentAttemptsSchema();
    if (boot?.ok === false && boot.reason !== 'db_not_configured') {
      telemetryWarnings.push({
        id: 'payment_attempts_bootstrap',
        message: 'Payment verification telemetry could not be initialized yet.'
      });
    }
  } catch (e) {
    console.warn('[admin aiState] payment_attempts bootstrap', e?.message || e);
    telemetryWarnings.push({
      id: 'payment_attempts_bootstrap',
      message: 'Payment verification telemetry could not be initialized yet.'
    });
  }

  const range = resolveAiStateRange(filters);
  const prevRange = { from: range.prevFrom, to: range.prevTo };

  const pipelineDefs = [
    { id: 'transcription', label: 'Transcription', sql: `h.type = 'transcription' AND NOT (${TRANSLATION_ONLY_SQL})` },
    { id: 'summarization', label: 'Summarization', sql: `h.type = 'summarization'` },
    { id: 'translation', label: 'Translation', sql: TRANSLATION_ONLY_SQL },
    {
      id: 'youtube',
      label: 'YouTube download',
      sql: `LOWER(COALESCE(h.metadata->>'platform', h.metadata->>'source', '')) = 'youtube'`
    },
    {
      id: 'instagram',
      label: 'Instagram processing',
      sql: `LOWER(COALESCE(h.metadata->>'platform', h.metadata->>'source', '')) = 'instagram'`
    },
    {
      id: 'export',
      label: 'Export generation',
      sql: `h.type IN ('srt', 'download')`
    }
  ];

  const usageHistoryOk = await tableExists(pool, 'usage_history');
  if (!usageHistoryOk) {
    const data = emptyAiStateShell({
      fatal: true,
      preset: range.preset,
      telemetryWarnings: [
        ...telemetryWarnings,
        { id: 'usage_history', message: 'Usage telemetry is not available yet.' }
      ],
      insights: [
        { tone: 'warn', text: 'Core usage telemetry is missing — AI Operations Center cannot load metrics.' }
      ]
    });
    aiStateCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  let kpis = null;
  try {
    kpis = await queryKpis(pool, range, prevRange, telemetryWarnings);
  } catch (e) {
    console.error('[admin aiState] KPIs', e);
    telemetryWarnings.push({
      id: 'kpis',
      message: friendlyDbError('Operational KPIs', e)
    });
  }

  const [costR, incidentsR, cronR, modelsR, paymentR, callbackR, ...usagePipeResults] =
    await Promise.allSettled([
      queryCostIntelligence(pool, range, telemetryWarnings),
      queryIncidents(pool),
      queryCronJobs(pool),
      queryModels(pool),
      queryPaymentPipeline(pool),
      queryCallbackPipeline(pool),
      ...pipelineDefs.map((d) =>
        queryUsagePipeline(pool, d.sql, d.label).then((p) => ({ ...p, id: d.id }))
      )
    ]);

  const pick = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  const warnFailed = (id, r) => {
    if (r.status === 'rejected') {
      console.error(`[admin aiState] ${id}`, r.reason);
      telemetryWarnings.push({ id, message: friendlyDbError(id, r.reason) });
    }
  };

  warnFailed('cost', costR);
  warnFailed('incidents', incidentsR);
  warnFailed('cronJobs', cronR);
  warnFailed('models', modelsR);
  warnFailed('payment_pipeline', paymentR);
  warnFailed('callback_pipeline', callbackR);

  const cost = pick(costR, null);
  const incidents = pick(incidentsR, []);
  let cronJobs = pick(cronR, []);
  const models = pick(modelsR, null);
  const paymentPipe = pick(paymentR, {
    id: 'payment_verification',
    label: 'Payment verification',
    status: 'attention',
    unavailable: true,
    userMessage: 'Payment verification telemetry is temporarily unavailable.'
  });
  const callbackPipe = pick(callbackR, {
    id: 'callback_queue',
    label: 'Callback queue',
    status: 'attention',
    unavailable: true
  });

  const usagePipes = usagePipeResults.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    warnFailed(pipelineDefs[i]?.id || 'pipeline', r);
    return {
      id: pipelineDefs[i]?.id || 'pipeline',
      label: pipelineDefs[i]?.label || 'Pipeline',
      unavailable: true,
      userMessage: friendlyDbError(pipelineDefs[i]?.label || 'Pipeline', r.reason),
      status: 'attention'
    };
  });

  const auditOk = await tableExists(pool, 'audit_events');
  for (const p of usagePipes) {
    if (p.unavailable || !auditOk) continue;
    const pattern = `%${p.id === 'transcription' ? 'transcribe' : p.id}%`;
    const failR = await safeQueryScalar(
      pool,
      `SELECT COUNT(*)::int AS c FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '24 hours' AND event_name LIKE $1`,
      [pattern],
      { context: `${p.label} failures` }
    );
    p.failures24h = Number(failR.value || 0);
    if (p.throughput24h > 0 && p.successPct === 100 && p.failures24h > 0) {
      p.successPct = Math.round(((p.throughput24h - p.failures24h) / p.throughput24h) * 1000) / 10;
    }
    p.status = pipelineStatus({
      successPct: p.successPct || 100,
      failures24h: p.failures24h,
      active5m: p.activeJobs,
      lastActivityAt: p.lastActivityAt
    });
  }

  const payAttemptsOk = await tableExists(pool, 'payment_attempts');
  cronJobs = cronJobs.map((j) =>
    j.id === 'payment_retry' && payAttemptsOk
      ? { ...j, status: 'healthy', note: 'Tracked via payment_attempts when customers retry checkout.' }
      : j
  );

  const pipelines = [...usagePipes, paymentPipe, callbackPipe, {
    id: 'cron',
    label: 'Cron & scheduled tasks',
    throughput24h: cronJobs.reduce((s, j) => s + (j.runs24h || 0), 0),
    status: cronJobs.some((j) => j.status === 'healthy') ? 'healthy' : 'attention',
    lastActivityAt: cronJobs.find((j) => j.lastRunAt)?.lastRunAt || null
  }];

  let oldestPending = null;
  const oldestQ = await safeQuery(
    pool,
    `SELECT MIN(created_at) AS oldest FROM payments WHERE status = 'pending'`,
    [],
    { context: 'Oldest pending payment' }
  );
  if (oldestQ.ok && oldestQ.rows[0]) {
    const o = oldestQ.rows[0].oldest;
    oldestPending = o?.toISOString?.() || o || null;
  }

  const partial = telemetryWarnings.length > 0 || !kpis;
  const data = {
    partial,
    fatal: false,
    checkedAt: new Date().toISOString(),
    preset: range.preset,
    telemetryWarnings,
    queueTelemetryAvailable: false,
    kpis,
    pipelines,
    cost,
    queue: {
      available: false,
      message: 'Queue telemetry not yet available.',
      pendingPayments: kpis?.queueBacklog ?? null,
      oldestPendingAt: oldestPending,
      stuckJobs: null,
      deadLetter: null
    },
    incidents,
    cronJobs,
    models,
    insights: [],
    instalogist: await tryInstalogistSnapshot()
  };

  data.insights = buildInsights(data);
  if (partial && !data.insights.some((i) => i.tone === 'warn')) {
    data.insights.unshift({
      tone: 'neutral',
      text: 'Some telemetry sources are still warming up — metrics below may be incomplete.'
    });
  }

  aiStateCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
