/**
 * Operations health snapshot for admin panel (real DB/env/tooling only).
 */
import { accessSync, constants } from 'fs';
import { tmpdir } from 'os';
import { getPool, isBillingDbConfigured } from './db/pool.js';
import { getYekpayStartupState } from './yekpay.js';
import {
  checkFfmpegHealth,
  checkYtDlpHealth,
  mediaToolComponentStatus,
  mediaToolDetail
} from './media-tool-health.js';
import { ensureAuditEventsTable } from './audit-repository.js';
import { ensureAdminsSchema } from './admins-repository.js';

/** usage_history.type values written by credits-engine / billing-repository */
const USAGE_JOB_TYPES_SQL = `(
  'transcription', 'summarization', 'srt', 'download', 'mp4_export'
)`;

const CACHE_MS = 30_000;
let cache = { at: 0, data: null };

function boolConfigured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function tmpWritable() {
  try {
    accessSync(tmpdir(), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function deploymentMeta() {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    '';
  const ref = process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || '';
  return {
    environment: process.env.NODE_ENV || 'development',
    commit: sha ? sha.slice(0, 7) : null,
    branch: ref || null,
    host: process.env.VERCEL_URL || process.env.RAILWAY_PUBLIC_DOMAIN || null
  };
}

async function measureDbLatencyMs(pool) {
  const t0 = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - t0;
}

async function queryTableExists(pool, names) {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [names]
  );
  const set = new Set(r.rows.map((row) => row.table_name));
  return Object.fromEntries(names.map((n) => [n, set.has(n)]));
}

async function queryIncidents(pool) {
  try {
    await ensureAuditEventsTable();
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
             'payment_failed', 'payment_verify_failed', 'openai_error',
             'callback_failed', 'yekpay_verify_failed', 'transcribe_failed'
           )
         )
       ORDER BY created_at DESC
       LIMIT 40`
    );
    return r.rows.map((row) => ({
      severity: row.event_type === 'error' ? 'error' : 'warn',
      type: row.event_name,
      email: row.email || null,
      detail: String(row.detail || '').slice(0, 240) || null,
      at: row.created_at?.toISOString?.() || row.created_at
    }));
  } catch {
    return [];
  }
}

async function queryMetrics(pool) {
  const out = {
    activeAdminSessions: 0,
    pendingPayments: 0,
    failedPayments24h: 0,
    callbackFailures24h: 0,
    errors24h: 0,
    liveUsers15m: 0,
    aiJobs24h: 0
  };
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM admin_sessions WHERE expires_at > NOW()) AS admin_sessions,
        (SELECT COUNT(*)::int FROM payments WHERE status = 'pending') AS pending_payments,
        (SELECT COUNT(*)::int FROM payments
          WHERE status IN ('failed', 'canceled')
            AND updated_at >= NOW() - INTERVAL '24 hours') AS failed_payments_24h,
        (SELECT COUNT(*)::int FROM audit_events
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND event_name IN (
              'payment_failed', 'payment_verify_failed', 'callback_failed',
              'yekpay_verify_failed', 'payment_callback_failed'
            )) AS callback_failures_24h,
        (SELECT COUNT(*)::int FROM audit_events
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND (
              event_type = 'error'
              OR event_name LIKE '%failed%'
              OR event_name LIKE '%error%'
            )) AS errors_24h,
        (SELECT COUNT(*)::int FROM (
           SELECT user_id FROM usage_history
           WHERE created_at >= NOW() - INTERVAL '15 minutes' AND user_id IS NOT NULL
           UNION
           SELECT user_id FROM audit_events
           WHERE created_at >= NOW() - INTERVAL '15 minutes' AND user_id IS NOT NULL
         ) live) AS live_users_15m,
        (SELECT COUNT(*)::int FROM usage_history
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND type IN ${USAGE_JOB_TYPES_SQL}) AS ai_jobs_24h
    `);
    const row = r.rows[0] || {};
    out.activeAdminSessions = Number(row.admin_sessions || 0);
    out.pendingPayments = Number(row.pending_payments || 0);
    out.failedPayments24h = Number(row.failed_payments_24h || 0);
    out.callbackFailures24h = Number(row.callback_failures_24h || 0);
    out.errors24h = Number(row.errors_24h || 0);
    out.liveUsers15m = Number(row.live_users_15m || 0);
    out.aiJobs24h = Number(row.ai_jobs_24h || 0);
  } catch (e) {
    out.queryError = e?.message || 'metrics_unavailable';
  }
  return out;
}

function buildPrimaryInfrastructure() {
  const yek = getYekpayStartupState();
  return [
    {
      key: 'DATABASE_URL',
      label: 'Database',
      configured: boolConfigured('DATABASE_URL'),
      critical: true
    },
    {
      key: 'OPENAI_API_KEY',
      label: 'OpenAI',
      configured: boolConfigured('OPENAI_API_KEY'),
      critical: true
    },
    {
      key: 'SESSION_SECRET',
      label: 'Session secret',
      configured: boolConfigured('SESSION_SECRET') || boolConfigured('JWT_SECRET'),
      critical: true
    },
    {
      key: 'YEKPAY_MERCHANT',
      label: 'YekPay merchant',
      configured: yek.merchantConfigured,
      critical: true,
      meta: yek.sandboxMode ? 'sandbox' : 'production'
    },
    {
      key: 'YEKPAY_CALLBACK_URL',
      label: 'YekPay callback',
      configured: Boolean(yek.callbackUrl),
      critical: true
    },
    {
      key: 'YEKPAY_ENVIRONMENT',
      label: 'YekPay environment',
      configured: yek.merchantConfigured && !yek.configError,
      critical: true,
      meta: yek.sandboxMode ? 'sandbox' : 'live'
    },
    {
      key: 'SMTP',
      label: 'Mail (SMTP)',
      configured:
        boolConfigured('SMTP_HOST') ||
        boolConfigured('RESEND_API_KEY') ||
        boolConfigured('SENDGRID_API_KEY'),
      critical: false
    },
    {
      key: 'STORAGE',
      label: 'Object storage',
      configured:
        boolConfigured('AWS_S3_BUCKET') ||
        boolConfigured('BLOB_READ_WRITE_TOKEN') ||
        boolConfigured('R2_ACCOUNT_ID'),
      critical: false,
      meta: 'optional'
    }
  ];
}

function buildOptionalIntegrations() {
  return [
    {
      provider: 'stripe',
      label: 'Stripe',
      configured: boolConfigured('STRIPE_SECRET_KEY'),
      webhookConfigured: boolConfigured('STRIPE_WEBHOOK_SECRET'),
      note: 'Optional legacy gateway'
    }
  ];
}

function statusFromParts(parts) {
  if (parts.some((p) => p === 'critical')) return 'critical';
  if (parts.some((p) => p === 'degraded')) return 'degraded';
  if (parts.every((p) => p === 'healthy' || p === 'unknown')) return 'healthy';
  return 'attention';
}

/**
 * @returns {Promise<object>}
 */
export async function getAdminOpsHealthDb() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const yek = getYekpayStartupState();
  const [ff, yt] = await Promise.all([checkFfmpegHealth(), checkYtDlpHealth()]);
  const deploy = deploymentMeta();

  const components = [];
  const warnings = [];

  let database = {
    ok: false,
    latencyMs: null,
    pool: null,
    tables: {}
  };
  let metrics = {};
  let incidents = [];

  if (!isBillingDbConfigured()) {
    warnings.push({ tone: 'warn', text: 'DATABASE_URL is not configured — live metrics are unavailable.' });
    components.push({
      id: 'database',
      label: 'PostgreSQL',
      status: 'critical',
      detail: 'Not configured',
      category: 'core'
    });
  } else {
    try {
      await Promise.all([ensureAdminsSchema(), ensureAuditEventsTable()]);
      const pool = getPool();
      const latencyMs = await measureDbLatencyMs(pool);
      database = {
        ok: true,
        latencyMs,
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount
        },
        tables: await queryTableExists(pool, [
          'users',
          'subscriptions',
          'payments',
          'payment_attempts',
          'audit_events',
          'admins',
          'admin_sessions'
        ])
      };
      metrics = await queryMetrics(pool);
      incidents = await queryIncidents(pool);

      const dbStatus =
        latencyMs > 400 ? 'degraded' : database.tables.users && database.tables.payments ? 'healthy' : 'degraded';
      components.push({
        id: 'database',
        label: 'PostgreSQL',
        status: dbStatus,
        detail: `${latencyMs} ms latency`,
        category: 'core',
        metrics: [
          { label: 'Pool total', value: String(database.pool?.total ?? '—') },
          { label: 'Pool idle', value: String(database.pool?.idle ?? '—') },
          { label: 'Waiting', value: String(database.pool?.waiting ?? '—') }
        ]
      });
    } catch (e) {
      database = { ok: false, error: e?.message || 'connection_failed', tables: {} };
      components.push({
        id: 'database',
        label: 'PostgreSQL',
        status: 'critical',
        detail: 'Connection failed',
        category: 'core'
      });
    }
  }

  components.push({
    id: 'api',
    label: 'Admin API',
    status: 'healthy',
    detail: 'Responding',
    category: 'core'
  });

  const yekStatus =
    !yek.merchantConfigured || yek.configError
      ? 'critical'
      : metrics.pendingPayments > 10
        ? 'degraded'
        : 'healthy';
  components.push({
    id: 'yekpay',
    label: 'YekPay gateway',
    status: yekStatus,
    detail: yek.merchantConfigured
      ? `${yek.sandboxMode ? 'Sandbox' : 'Live'} · ${metrics.pendingPayments ?? 0} pending`
      : 'Merchant not configured',
    category: 'payments',
    metrics: [
      { label: '24h failed', value: String(metrics.failedPayments24h ?? '—') },
      { label: 'Callback issues (24h)', value: String(metrics.callbackFailures24h ?? '—') }
    ]
  });

  components.push({
    id: 'openai',
    label: 'OpenAI',
    status: boolConfigured('OPENAI_API_KEY') ? 'healthy' : 'critical',
    detail: boolConfigured('OPENAI_API_KEY') ? 'API key configured' : 'OPENAI_API_KEY missing',
    category: 'ai',
    metrics: [{ label: 'AI jobs (24h)', value: String(metrics.aiJobs24h ?? '—') }]
  });

  components.push({
    id: 'ffmpeg',
    label: 'ffmpeg',
    status: mediaToolComponentStatus(ff),
    detail: mediaToolDetail(ff, {
      operational: `FFmpeg ${ff.version || '—'}\nMedia processing pipeline operational`,
      degraded: 'ffmpeg installed but could not verify execution',
      missing: 'Not installed on host'
    }),
    category: 'media',
    telemetry: {
      installed: ff.installed,
      version: ff.version,
      status: ff.status,
      path: ff.path || null
    }
  });

  components.push({
    id: 'ytdlp',
    label: 'yt-dlp',
    status: mediaToolComponentStatus(yt),
    detail: mediaToolDetail(yt, {
      operational: yt.version ? `yt-dlp ${yt.version}` : 'yt-dlp operational',
      degraded: 'yt-dlp installed but could not verify execution',
      missing: 'Not available on host'
    }),
    category: 'media',
    telemetry: {
      installed: yt.installed,
      version: yt.version,
      status: yt.status,
      path: yt.path || null
    }
  });

  components.push({
    id: 'storage',
    label: 'Temp / storage',
    status: tmpWritable() ? 'healthy' : 'degraded',
    detail: tmpWritable() ? `Writable: ${tmpdir()}` : 'Temp directory not writable',
    category: 'media'
  });

  if ((metrics.errors24h || 0) > 25) {
    warnings.push({
      tone: 'warn',
      text: `Elevated error volume in the last 24 hours (${metrics.errors24h} events).`
    });
  }
  if ((metrics.callbackFailures24h || 0) > 5) {
    warnings.push({
      tone: 'error',
      text: `Payment callback / verification failures spiking (${metrics.callbackFailures24h} in 24h).`
    });
  }

  const primaryInfra = buildPrimaryInfrastructure();
  const missingCritical = primaryInfra.filter((i) => i.critical && !i.configured);
  if (missingCritical.length) {
    warnings.push({
      tone: 'warn',
      text: `Missing critical configuration: ${missingCritical.map((m) => m.label).join(', ')}.`
    });
  }

  const overall = statusFromParts([
    ...components.map((c) => c.status),
    missingCritical.length ? 'degraded' : 'healthy'
  ]);

  const data = {
    ok: overall === 'healthy',
    overall,
    checkedAt: new Date().toISOString(),
    deployment: deploy,
    uptimeNote: 'Instance uptime varies on serverless hosts; use external monitoring for SLA.',
    database,
    metrics: {
      ...metrics,
      errorRate24h: metrics.errors24h,
      liveUsers: metrics.liveUsers15m,
      activeAdminSessions: metrics.activeAdminSessions
    },
    components,
    primaryInfrastructure: primaryInfra,
    optionalIntegrations: buildOptionalIntegrations(),
    yekpay: {
      merchantConfigured: yek.merchantConfigured,
      sandboxMode: yek.sandboxMode,
      callbackUrl: yek.callbackUrl,
      fxConfigured: yek.eurToIrrConfigured,
      configError: yek.configError
    },
    incidents,
    warnings,
    partial: !isBillingDbConfigured()
  };

  cache = { at: Date.now(), data };
  return data;
}
