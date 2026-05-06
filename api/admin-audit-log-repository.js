/**
 * Admin Audit Log — security intelligence, KPIs, anomalies, journey (real DB only).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';
import {
  listAuditEventsDb,
  countAuditEventsDb,
  getAuditSummaryDb,
  getAuditEventTimeseriesDb,
  getAuditErrorTimeseriesDb,
  getAuditDauTimeseriesDb,
  getUserAuditTimelineDb,
  isUuid,
  ensureAuditEventsTable
} from './audit-repository.js';
import { tableExists } from './admin-db-safe.js';
import { ensureAuditEventNotesSchema } from './audit-event-notes-bootstrap.js';

const CACHE_MS = 45_000;
const dashboardCache = new Map();

function parseDateParam(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveAuditLogRange({ preset = '24h', dateFrom = null, dateTo = null } = {}) {
  const to = parseDateParam(dateTo) || new Date();
  const p = String(preset || '24h').toLowerCase();
  let from;
  if (dateFrom) from = parseDateParam(dateFrom);
  else if (p === '30d') from = new Date(to.getTime() - 30 * 86400000);
  else if (p === '7d') from = new Date(to.getTime() - 7 * 86400000);
  else if (p === '1h') from = new Date(to.getTime() - 3600000);
  else from = new Date(to.getTime() - 24 * 86400000);
  return {
    from,
    to,
    preset: p,
    dateFrom: from.toISOString(),
    dateTo: to.toISOString()
  };
}

function kpi(value, { instrumented = true, hint = null } = {}) {
  if (!instrumented) {
    return { value: null, display: '—', instrumented: false, hint: hint || 'Not instrumented yet' };
  }
  return { value: value ?? 0, display: String(value ?? 0), instrumented: true, hint };
}

async function safeCount(pool, sql, params, instrumented = true) {
  try {
    const r = await pool.query(sql, params);
    return kpi(Number(r.rows[0]?.c ?? r.rows[0]?.count ?? 0), { instrumented });
  } catch {
    return kpi(null, { instrumented: false });
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ dateFrom: string, dateTo: string }} range
 */
async function querySecurityKpis(pool, range) {
  const [from, to] = [range.dateFrom, range.dateTo];
  const failedLogins = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND (
         event_name IN ('login_failed', 'auth_failed', 'signin_failed')
         OR (event_name LIKE '%login%' AND event_type = 'error')
       )`,
    [from, to]
  );
  const adminLogins = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('admin_login', 'admin_session_start')`,
    [from, to]
  );
  const suspiciousIps = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM (
       SELECT ip FROM audit_events
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
         AND ip IS NOT NULL
         AND (event_type = 'error' OR event_name LIKE '%failed%')
       GROUP BY ip HAVING COUNT(*) >= 8
     ) x`,
    [from, to]
  );
  const blockedAttempts = kpi(null, {
    instrumented: false,
    hint: 'Blocked-attempt counter requires WAF integration'
  });
  const passwordResets = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('password_reset_requested', 'password_reset', 'forgot_password')`,
    [from, to]
  );
  const authProvider = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('oauth_login', 'google_login', 'signup', 'login_success')`,
    [from, to]
  );

  let activeAdminSessions = kpi(null, { instrumented: false });
  if (await tableExists(pool, 'admin_sessions')) {
    activeAdminSessions = await safeCount(
      pool,
      `SELECT COUNT(*)::int AS c FROM admin_sessions WHERE expires_at > NOW()`,
      []
    );
  }

  return {
    failedLogins,
    adminLogins,
    suspiciousIpCount: suspiciousIps,
    blockedAttempts,
    passwordResetRequests: passwordResets,
    authProviderUsage: authProvider,
    activeAdminSessions
  };
}

async function queryOperationsKpis(pool, range) {
  const [from, to] = [range.dateFrom, range.dateTo];
  const uploadsStarted = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('upload_started', 'file_upload', 'youtube_download_started')`,
    [from, to],
    true
  );

  let uploadsCompleted = kpi(null, { instrumented: false });
  if (await tableExists(pool, 'usage_history')) {
    uploadsCompleted = await safeCount(
      pool,
      `SELECT COUNT(*)::int AS c FROM usage_history
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
         AND type = 'transcription'`,
      [from, to]
    );
  }

  const failedAiJobs = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND (
         event_name IN ('transcribe_failed', 'summarize_failed', 'translate_failed', 'openai_error', 'export_failed')
         OR (event_type = 'error' AND event_name LIKE '%transcribe%')
       )`,
    [from, to]
  );

  const paymentVerifyFailures = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('payment_verify_failed', 'yekpay_verify_failed', 'payment_failed')`,
    [from, to]
  );

  const callbackFailures = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('callback_failed', 'payment_callback_failed')`,
    [from, to]
  );

  const exportFailures = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('export_failed', 'ffmpeg_failed', 'ytdlp_failed')`,
    [from, to]
  );

  return {
    uploadsStarted,
    uploadsCompleted,
    failedAiJobs,
    paymentVerificationFailures: paymentVerifyFailures,
    callbackFailures,
    exportGenerationFailures: exportFailures
  };
}

async function queryBehaviorKpis(pool, range) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const [from, to] = [range.dateFrom, range.dateTo];

  const activeUsersToday = await safeCount(
    pool,
    `SELECT COUNT(DISTINCT user_id)::int AS c FROM audit_events
     WHERE user_id IS NOT NULL AND created_at >= $1::timestamptz`,
    [todayStart.toISOString()]
  );

  const avgSessionDepth = kpi(null, {
    instrumented: false,
    hint: 'Session depth requires analytics_session rollup'
  });

  let avgJobsPerUser = kpi(null, { instrumented: false });
  if (await tableExists(pool, 'usage_history')) {
    try {
      const r = await pool.query(
        `SELECT COALESCE(AVG(jc), 0)::float AS avg FROM (
           SELECT user_id, COUNT(*)::int AS jc FROM usage_history
           WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz AND user_id IS NOT NULL
           GROUP BY user_id
         ) s`,
        [from, to]
      );
      const v = Math.round(Number(r.rows[0]?.avg || 0) * 10) / 10;
      avgJobsPerUser = kpi(v, { instrumented: true });
    } catch {
      avgJobsPerUser = kpi(null, { instrumented: false });
    }
  }

  const returningUsers = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM (
       SELECT user_id FROM audit_events
       WHERE user_id IS NOT NULL AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       GROUP BY user_id
       HAVING COUNT(DISTINCT date_trunc('day', created_at)) >= 2
     ) x`,
    [from, to]
  );

  let heavyUsers = kpi(null, { instrumented: false });
  if (await tableExists(pool, 'usage_history')) {
    heavyUsers = await safeCount(
      pool,
      `SELECT COUNT(*)::int AS c FROM (
         SELECT user_id FROM usage_history
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz AND user_id IS NOT NULL
         GROUP BY user_id HAVING COUNT(*) >= 15
       ) x`,
      [from, to]
    );
  }

  const churnRisk = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM users u
     WHERE u.created_at < NOW() - INTERVAL '14 days'
       AND NOT EXISTS (
         SELECT 1 FROM audit_events e
         WHERE e.user_id = u.id AND e.created_at >= NOW() - INTERVAL '14 days'
       )`,
    []
  );

  return {
    activeUsersToday,
    avgSessionDepth,
    avgJobsPerUser,
    returningUsers,
    heavyUsers,
    churnRiskInactivity: churnRisk
  };
}

async function queryPaymentsKpis(pool, range) {
  const [from, to] = [range.dateFrom, range.dateTo];
  const checkoutStarted = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('payment_started', 'payment_attempt', 'checkout_started')`,
    [from, to]
  );
  const checkoutAbandoned = await safeCount(
    pool,
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name IN ('payment_started', 'payment_attempt')
       AND user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM audit_events s
         WHERE s.user_id = audit_events.user_id
           AND s.event_name = 'payment_success'
           AND s.created_at >= audit_events.created_at
           AND s.created_at <= $2::timestamptz
       )`,
    [from, to]
  );

  let paymentSuccessRate = kpi(null, { instrumented: false });
  let retryRate = kpi(null, { instrumented: false });

  if (await tableExists(pool, 'payments')) {
    try {
      const r = await pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'success')::int AS ok
         FROM payments
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
        [from, to]
      );
      const total = Number(r.rows[0]?.total || 0);
      const ok = Number(r.rows[0]?.ok || 0);
      const pct = total > 0 ? Math.round((ok / total) * 1000) / 10 : null;
      paymentSuccessRate = {
        value: pct,
        display: pct != null ? `${pct}%` : '—',
        instrumented: true,
        hint: 'From payments table'
      };
    } catch {
      paymentSuccessRate = kpi(null, { instrumented: false });
    }
  }

  if (await tableExists(pool, 'payment_attempts')) {
    try {
      const r = await pool.query(
        `SELECT
           COUNT(*)::int AS attempts,
           COUNT(*) FILTER (WHERE attempt_number > 1)::int AS retries
         FROM payment_attempts
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
        [from, to]
      );
      const attempts = Number(r.rows[0]?.attempts || 0);
      const retries = Number(r.rows[0]?.retries || 0);
      const pct = attempts > 0 ? Math.round((retries / attempts) * 1000) / 10 : null;
      retryRate = {
        value: pct,
        display: pct != null ? `${pct}%` : '—',
        instrumented: true,
        hint: 'From payment_attempts'
      };
    } catch {
      retryRate = kpi(null, { instrumented: false });
    }
  }

  return { checkoutStarted, checkoutAbandoned, paymentSuccessRate, retryRate };
}

/**
 * Heuristic anomalies from real telemetry only.
 */
export async function detectAuditAnomalies(pool, range) {
  const [from, to] = [range.dateFrom, range.dateTo];
  const anomalies = [];

  const failedLogins = await pool.query(
    `SELECT ip, COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name LIKE '%login%' AND event_type = 'error'
       AND ip IS NOT NULL
     GROUP BY ip HAVING COUNT(*) >= 10
     ORDER BY c DESC LIMIT 5`,
    [from, to]
  ).catch(() => ({ rows: [] }));

  for (const row of failedLogins.rows || []) {
    anomalies.push({
      id: `failed_login_${row.ip}`,
      severity: 'critical',
      title: 'Repeated failed logins',
      reason: `${row.c} failed login events from IP ${row.ip}`,
      relatedCount: Number(row.c)
    });
  }

  const payFails = await pool.query(
    `SELECT user_id, COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name = 'payment_failed' AND user_id IS NOT NULL
     GROUP BY user_id HAVING COUNT(*) >= 3
     ORDER BY c DESC LIMIT 5`,
    [from, to]
  ).catch(() => ({ rows: [] }));

  for (const row of payFails.rows || []) {
    anomalies.push({
      id: `pay_fail_${row.user_id}`,
      severity: 'warning',
      title: 'Repeated payment failures',
      reason: `${row.c} payment_failed events for user ${row.user_id}`,
      userId: row.user_id,
      relatedCount: Number(row.c)
    });
  }

  if (await tableExists(pool, 'usage_history')) {
    const costSpike = await pool.query(
      `SELECT user_id, COALESCE(SUM(minutes), 0)::float AS minutes FROM usage_history
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz AND user_id IS NOT NULL
       GROUP BY user_id HAVING COALESCE(SUM(minutes), 0) >= 120
       ORDER BY minutes DESC LIMIT 3`,
      [from, to]
    ).catch(() => ({ rows: [] }));

    for (const row of costSpike.rows || []) {
      anomalies.push({
        id: `ai_spike_${row.user_id}`,
        severity: 'warning',
        title: 'High AI usage volume',
        reason: `${Math.round(Number(row.minutes))} processed minutes in window`,
        userId: row.user_id
      });
    }

    const exportBurst = await pool.query(
      `SELECT user_id, COUNT(*)::int AS c FROM usage_history
       WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
         AND type IN ('download', 'srt') AND user_id IS NOT NULL
       GROUP BY user_id HAVING COUNT(*) >= 25
       ORDER BY c DESC LIMIT 3`,
      [from, to]
    ).catch(() => ({ rows: [] }));

    for (const row of exportBurst.rows || []) {
      anomalies.push({
        id: `export_burst_${row.user_id}`,
        severity: 'attention',
        title: 'Excessive exports',
        reason: `${row.c} export jobs in selected range`,
        userId: row.user_id,
        relatedCount: Number(row.c)
      });
    }
  }

  const countrySwitch = await pool.query(
    `SELECT user_id, COUNT(DISTINCT country_code)::int AS countries
     FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND user_id IS NOT NULL AND country_code IS NOT NULL
     GROUP BY user_id HAVING COUNT(DISTINCT country_code) >= 4
     LIMIT 5`,
    [from, to]
  ).catch(() => ({ rows: [] }));

  for (const row of countrySwitch.rows || []) {
    anomalies.push({
      id: `geo_${row.user_id}`,
      severity: 'attention',
      title: 'Country switching',
      reason: `${row.countries} distinct countries in window`,
      userId: row.user_id
    });
  }

  const uploadBurst = await pool.query(
    `SELECT user_id, COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_name LIKE '%upload%' AND user_id IS NOT NULL
     GROUP BY user_id HAVING COUNT(*) >= 20
     ORDER BY c DESC LIMIT 3`,
    [from, to]
  ).catch(() => ({ rows: [] }));

  for (const row of uploadBurst.rows || []) {
    anomalies.push({
      id: `upload_burst_${row.user_id}`,
      severity: 'warning',
      title: 'Burst uploads',
      reason: `${row.c} upload-related events`,
      userId: row.user_id,
      relatedCount: Number(row.c)
    });
  }

  const callbackStorm = await pool.query(
    `SELECT COUNT(*)::int AS c FROM audit_events
     WHERE created_at >= NOW() - INTERVAL '1 hour'
       AND event_name IN ('callback_failed', 'payment_verify_failed', 'yekpay_verify_failed')`,
    []
  ).catch(() => ({ rows: [{ c: 0 }] }));

  if (Number(callbackStorm.rows[0]?.c || 0) >= 5) {
    anomalies.push({
      id: 'callback_storm',
      severity: 'critical',
      title: 'Callback retry storm',
      reason: `${callbackStorm.rows[0].c} callback/verify failures in the last hour`,
      relatedCount: Number(callbackStorm.rows[0].c)
    });
  }

  return anomalies.slice(0, 12);
}

export function enrichAuditEventForUi(row) {
  const name = String(row.eventName || '');
  const typ = String(row.eventType || 'ui');
  let severity = 'info';
  if (typ === 'error' || name.includes('failed') || name.includes('error')) severity = 'critical';
  else if (name.includes('warning') || name.includes('retry')) severity = 'warning';
  else if (name.includes('success') || name.includes('completed')) severity = 'success';

  const title = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const meta = row.metadata || {};
  const parts = [];
  if (row.userEmail) parts.push(row.userEmail);
  if (row.plan) parts.push(`plan ${row.plan}`);
  if (row.countryCode) parts.push(row.countryCode);
  if (row.device) parts.push(`${row.device}${row.browser ? ` / ${row.browser}` : ''}`);
  if (meta.requestId) parts.push(`req ${meta.requestId}`);
  if (meta.latencyMs != null) parts.push(`${meta.latencyMs}ms`);

  return {
    ...row,
    severity,
    title,
    summary: parts.join(' · ') || typ,
    requestId: meta.requestId || meta.request_id || null,
    latencyMs: meta.latencyMs ?? meta.latency_ms ?? null,
    provider: meta.provider || meta.gateway || null
  };
}

async function queryChartBreakdowns(pool, range) {
  const [from, to] = [range.dateFrom, range.dateTo];
  const [byCategory, byCountry, byEventName] = await Promise.all([
    pool
      .query(
        `SELECT COALESCE(event_type, 'unknown') AS label, COUNT(*)::int AS count
         FROM audit_events
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
         GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        [from, to]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT COALESCE(country_code, '—') AS label, COUNT(*)::int AS count
         FROM audit_events
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
           AND country_code IS NOT NULL
         GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        [from, to]
      )
      .catch(() => ({ rows: [] })),
    pool
      .query(
        `SELECT event_name AS label, COUNT(*)::int AS count
         FROM audit_events
         WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
         GROUP BY 1 ORDER BY count DESC LIMIT 10`,
        [from, to]
      )
      .catch(() => ({ rows: [] }))
  ]);
  return {
    byCategory: (byCategory.rows || []).map((r) => ({ label: r.label, count: Number(r.count || 0) })),
    byCountry: (byCountry.rows || []).map((r) => ({ label: r.label, count: Number(r.count || 0) })),
    byEventName: (byEventName.rows || []).map((r) => ({ label: r.label, count: Number(r.count || 0) }))
  };
}

export async function getUserJourneyProfile(userId) {
  if (!isUuid(String(userId))) return null;
  const pool = getPool();
  let email = null;
  let plan = null;
  let userCreated = null;
  try {
    const u = await pool.query(
      `SELECT email, created_at,
              (SELECT plan FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1) AS plan
       FROM users u WHERE u.id = $1::uuid`,
      [userId]
    );
    email = u.rows[0]?.email || null;
    plan = u.rows[0]?.plan || null;
    userCreated = u.rows[0]?.created_at;
  } catch {
    /* noop */
  }

  const audit = await pool
    .query(
      `SELECT
         MIN(created_at) AS first_seen,
         COUNT(DISTINCT COALESCE(session_id, analytics_session_id))::int AS sessions,
         COUNT(*) FILTER (WHERE event_name LIKE '%payment%')::int AS payment_events
       FROM audit_events WHERE user_id = $1::uuid`,
      [userId]
    )
    .catch(() => ({ rows: [{}] }));

  let aiJobs = 0;
  let exports = 0;
  if (await tableExists(pool, 'usage_history')) {
    const uh = await pool
      .query(
        `SELECT
           COUNT(*) FILTER (WHERE type = 'transcription')::int AS transcribe,
           COUNT(*) FILTER (WHERE type IN ('download','srt'))::int AS exports
         FROM usage_history WHERE user_id = $1::uuid`,
        [userId]
      )
      .catch(() => ({ rows: [{}] }));
    aiJobs = Number(uh.rows[0]?.transcribe || 0);
    exports = Number(uh.rows[0]?.exports || 0);
  }

  const row = audit.rows[0] || {};
  return {
    email,
    plan: plan || '—',
    firstSeen: row.first_seen?.toISOString?.() || row.first_seen || userCreated?.toISOString?.() || null,
    totalSessions: Number(row.sessions || 0),
    paymentAttempts: Number(row.payment_events || 0),
    aiJobs,
    exports
  };
}

export async function getAdminAuditLogDashboard(filters = {}) {
  const cacheKey = JSON.stringify(filters);
  const hit = dashboardCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const range = resolveAuditLogRange(filters);
  if (!isBillingDbConfigured()) {
    const empty = {
      checkedAt: new Date().toISOString(),
      range,
      instrumented: false,
      kpis: {},
      anomalies: [],
      charts: { events: [], errors: [], dau: [] },
      summary: null
    };
    dashboardCache.set(cacheKey, { at: Date.now(), data: empty });
    return empty;
  }

  await ensureAuditEventsTable();
  await ensureAuditEventNotesSchema();
  const pool = getPool();

  const [security, operations, behavior, payments, anomalies, summary, events, errors, dau, breakdowns] =
    await Promise.all([
      querySecurityKpis(pool, range),
      queryOperationsKpis(pool, range),
      queryBehaviorKpis(pool, range),
      queryPaymentsKpis(pool, range),
      detectAuditAnomalies(pool, range),
      getAuditSummaryDb({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
      getAuditEventTimeseriesDb({ dateFrom: range.dateFrom, dateTo: range.dateTo, bucket: 'hour' }),
      getAuditErrorTimeseriesDb({ dateFrom: range.dateFrom, dateTo: range.dateTo, bucket: 'hour' }),
      getAuditDauTimeseriesDb({ dateFrom: range.dateFrom, dateTo: range.dateTo }),
      queryChartBreakdowns(pool, range)
    ]);

  const data = {
    checkedAt: new Date().toISOString(),
    range,
    instrumented: true,
    kpis: { security, operations, behavior, payments },
    anomalies,
    charts: { events, errors, dau, ...breakdowns },
    summary
  };

  dashboardCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

export async function listAuditEventsEnriched(filters) {
  const [events, total] = await Promise.all([
    listAuditEventsDb(filters),
    countAuditEventsDb(filters)
  ]);
  return {
    events: events.map(enrichAuditEventForUi),
    total,
    page: filters.page || 1,
    limit: filters.limit || 50,
    totalPages: Math.ceil(total / (filters.limit || 50)) || 1
  };
}

export async function resolveUserIdFromJourneyQuery(q) {
  const raw = String(q || '').trim();
  if (!raw) return { error: 'query_required' };
  if (isUuid(raw)) return { userId: raw };

  const pool = getPool();
  if (raw.includes('@')) {
    const r = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [raw]);
    if (!r.rows[0]) return { error: 'user_not_found' };
    return { userId: r.rows[0].id, email: raw };
  }

  const bySession = await pool.query(
    `SELECT user_id FROM audit_events
     WHERE (session_id = $1 OR analytics_session_id = $1) AND user_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [raw]
  );
  if (bySession.rows[0]?.user_id) {
    return { userId: bySession.rows[0].user_id, sessionId: raw };
  }

  return { error: 'user_not_found' };
}

export async function getUserJourneyExplorer(userId, limit = 300) {
  const profile = await getUserJourneyProfile(userId);
  const timeline = (await getUserAuditTimelineDb(userId, limit)).map(enrichAuditEventForUi);
  const steps = [];
  const order = [
    ['login', ['login_success', 'oauth_login', 'google_login', 'signup']],
    ['upload', ['upload_started', 'file_upload', 'youtube_download_started']],
    ['ai', ['transcribe_failed', 'summarize_failed', 'translate_failed']],
    ['export', ['export_failed']],
    ['payment', ['payment_started', 'payment_success', 'payment_failed', 'payment_retry']]
  ];
  for (const [label, names] of order) {
    const hits = timeline.filter((e) => names.some((n) => e.eventName === n || e.eventName?.includes(n.split('_')[0])));
    if (hits.length) steps.push({ step: label, count: hits.length, lastAt: hits[hits.length - 1].createdAt });
  }
  return { userId, profile, timeline, funnelSteps: steps };
}

export async function listEventNotesDb(eventId) {
  await ensureAuditEventNotesSchema();
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, event_id, session_key, admin_email, note, resolved, pinned, created_at, updated_at
     FROM audit_event_notes
     WHERE event_id = $1::uuid
     ORDER BY created_at DESC`,
    [eventId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    sessionKey: row.session_key,
    adminEmail: row.admin_email,
    note: row.note,
    resolved: row.resolved,
    pinned: row.pinned,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  }));
}

export async function upsertEventNoteDb({ eventId, adminEmail, note, resolved, pinned, sessionKey = null }) {
  await ensureAuditEventNotesSchema();
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO audit_event_notes (event_id, session_key, admin_email, note, resolved, pinned)
     VALUES ($1::uuid, $2, $3, $4, COALESCE($5, false), COALESCE($6, false))
     RETURNING *`,
    [
      eventId,
      sessionKey,
      String(adminEmail).slice(0, 255),
      String(note || '').slice(0, 4000),
      resolved,
      pinned
    ]
  );
  return r.rows[0];
}

export async function listPinnedNotesDb(limit = 30) {
  await ensureAuditEventNotesSchema();
  const pool = getPool();
  const r = await pool.query(
    `SELECT n.*, e.event_name, e.event_type, e.created_at AS event_at
     FROM audit_event_notes n
     LEFT JOIN audit_events e ON e.id = n.event_id
     WHERE n.pinned = true OR n.resolved = false
     ORDER BY n.pinned DESC, n.updated_at DESC
     LIMIT $1`,
    [Math.min(limit, 100)]
  );
  return r.rows;
}
