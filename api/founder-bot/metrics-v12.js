/**
 * Founder Bot V1.2 — exports, errors, providers, queue metrics.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { tableExists } from '../admin-db-safe.js';
import { getProviderHealthSnapshot } from '../transcription/provider-health.js';
import { getFounderBotQueueSnapshot } from '../video-render/render-queue.js';

const LANGUAGE_LABELS = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  fa: 'Persian',
  ar: 'Arabic',
  ru: 'Russian',
  tr: 'Turkish',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  hi: 'Hindi',
  it: 'Italian',
  original: 'Original',
  translated: 'Translated'
};

function languageLabel(code) {
  const k = String(code || '').toLowerCase();
  return LANGUAGE_LABELS[k] || (k ? k.toUpperCase() : '—');
}

function formatDurationSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

function categorizeError(message, source = '') {
  const text = `${source} ${message}`.toLowerCase();
  if (/ffmpeg|mux|render|export|ass|burn|video-render|gpu/.test(text)) return 'FFmpeg';
  if (/transcrib|whisper|asr|deepgram|groq|audio|speech/.test(text)) return 'Transcription';
  if (/translat|subtitle text|srt/.test(text)) return 'Translation';
  if (/payment|stripe|billing|invoice|yekpay|subscription/.test(text)) return 'Billing';
  if (/auth|oauth|session|login|token|password/.test(text)) return 'Auth';
  return 'Other';
}

async function probeFetchMs(url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - start;
    return { ok: res.ok, ms, status: res.status };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err?.message || String(err) };
  }
}

function formatLastFailure(snapshot) {
  if (!snapshot) return '—';
  if (snapshot.disabledNow) return 'In cooldown';
  const fails = Number(snapshot.failuresInWindow || 0);
  if (fails > 0) return `${fails} failure(s) in 5m window`;
  if (snapshot.lastSuccessAt) {
    const ago = Math.round((Date.now() - Number(snapshot.lastSuccessAt)) / 60000);
    return ago < 1 ? 'No recent failures' : `OK · last success ${ago}m ago`;
  }
  return 'No recent failures';
}

export async function getExportsMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  if (!(await tableExists(pool, 'project_exports'))) {
    return { ok: false, error: 'exports_table_missing' };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE e.status = 'completed' AND COALESCE(e.completed_at, e.created_at) >= $1::timestamptz
       )::int AS today,
       COUNT(*) FILTER (
         WHERE e.status = 'completed' AND COALESCE(e.completed_at, e.created_at) >= $2::timestamptz
       )::int AS week,
       COUNT(*) FILTER (
         WHERE e.status = 'completed' AND COALESCE(e.completed_at, e.created_at) >= $2::timestamptz
       )::int AS completed_week,
       COUNT(*) FILTER (
         WHERE e.status = 'failed' AND e.updated_at >= $2::timestamptz
       )::int AS failed_week,
       AVG(e.render_duration_sec) FILTER (
         WHERE e.status = 'completed'
           AND e.render_duration_sec IS NOT NULL
           AND COALESCE(e.completed_at, e.created_at) >= $2::timestamptz
       )::float AS avg_render_sec
     FROM project_exports e`,
    [today.toISOString(), weekAgo.toISOString()]
  );

  const row = r.rows[0] || {};
  const completedWeek = Number(row.completed_week || 0);
  const failedWeek = Number(row.failed_week || 0);
  const denom = completedWeek + failedWeek;

  const styleRes = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(e.preset_name), ''), NULLIF(TRIM(e.preset_id), ''), '—') AS style,
            COUNT(*)::int AS c
     FROM project_exports e
     WHERE e.status = 'completed' AND COALESCE(e.completed_at, e.created_at) >= $1::timestamptz
     GROUP BY 1
     ORDER BY c DESC
     LIMIT 1`,
    [weekAgo.toISOString()]
  );

  const langRes = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(p.language), ''), NULLIF(TRIM(e.metadata->>'language'), ''), '—') AS lang,
            COUNT(*)::int AS c
     FROM project_exports e
     LEFT JOIN projects p ON p.id = e.project_id
     WHERE e.status = 'completed' AND COALESCE(e.completed_at, e.created_at) >= $1::timestamptz
     GROUP BY 1
     ORDER BY c DESC
     LIMIT 1`,
    [weekAgo.toISOString()]
  );

  return {
    ok: true,
    today: Number(row.today || 0),
    week: Number(row.week || 0),
    successRate: denom > 0 ? Math.round((completedWeek / denom) * 1000) / 10 : 100,
    avgProcessingSec: Number(row.avg_render_sec || 0),
    topStyle: styleRes.rows[0]?.style || '—',
    topLanguage: languageLabel(langRes.rows[0]?.lang || '—')
  };
}

export async function getErrorsMetrics() {
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }
  const pool = getPool();
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const buckets = {
    FFmpeg: [],
    Transcription: [],
    Translation: [],
    Billing: [],
    Auth: [],
    Other: []
  };
  const merged = new Map();

  function ingest(message, count, source) {
    const msg = String(message || '').trim();
    if (!msg) return;
    const key = msg.slice(0, 200);
    const cat = categorizeError(msg, source);
    const prev = merged.get(key) || { message: key, count: 0, category: cat };
    prev.count += Number(count) || 1;
    merged.set(key, prev);
  }

  if (await tableExists(pool, 'project_exports')) {
    const r = await pool.query(
      `SELECT error_message, COUNT(*)::int AS c
       FROM project_exports
       WHERE status = 'failed' AND updated_at >= $1::timestamptz AND error_message IS NOT NULL
       GROUP BY 1`,
      [since]
    );
    for (const row of r.rows) ingest(row.error_message, row.c, 'export');
  }

  if (await tableExists(pool, 'audit_events')) {
    const r = await pool.query(
      `SELECT
         COALESCE(NULLIF(TRIM(metadata->>'message'), ''), NULLIF(TRIM(metadata->>'error'), ''), event_name) AS msg,
         COUNT(*)::int AS c,
         event_name
       FROM audit_events
       WHERE created_at >= $1::timestamptz
         AND (
           event_type = 'error'
           OR event_name ILIKE '%error%'
           OR event_name ILIKE '%fail%'
         )
       GROUP BY 1, 3`,
      [since]
    );
    for (const row of r.rows) ingest(row.msg, row.c, row.event_name);
  }

  if (await tableExists(pool, 'payment_attempts')) {
    const r = await pool.query(
      `SELECT error_message, COUNT(*)::int AS c
       FROM payment_attempts
       WHERE created_at >= $1::timestamptz AND error_message IS NOT NULL
       GROUP BY 1`,
      [since]
    );
    for (const row of r.rows) ingest(row.error_message, row.c, 'payment');
  }

  const top = [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  for (const item of top) {
    const list = buckets[item.category] || buckets.Other;
    list.push(item);
  }

  return { ok: true, top, buckets };
}

export async function getProvidersMetrics() {
  const health = getProviderHealthSnapshot();
  const openaiSnap = health.transcription?.openai || health.transcription?.['openai-whisper'] || null;
  const groqSnap = health.transcription?.groq || null;

  const providers = [];

  const openaiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (openaiKey) {
    const probe = await probeFetchMs('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${openaiKey}` }
    });
    providers.push({
      name: 'OpenAI',
      status: probe.ok ? 'Operational' : 'Degraded',
      responseMs: probe.ms,
      lastFailure: formatLastFailure(openaiSnap)
    });
  } else {
    providers.push({ name: 'OpenAI', status: 'Not configured', responseMs: null, lastFailure: '—' });
  }

  const groqKey = String(process.env.GROQ_API_KEY || '').trim();
  if (groqKey) {
    const probe = await probeFetchMs('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` }
    });
    providers.push({
      name: 'Groq',
      status: probe.ok ? 'Operational' : 'Degraded',
      responseMs: probe.ms,
      lastFailure: formatLastFailure(groqSnap)
    });
  } else {
    providers.push({ name: 'Groq', status: 'Not configured', responseMs: null, lastFailure: '—' });
  }

  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    const probe = await probeFetchMs('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${resendKey}` }
    });
    providers.push({
      name: 'Resend',
      status: probe.ok ? 'Operational' : 'Degraded',
      responseMs: probe.ms,
      lastFailure: probe.ok ? 'No recent failures' : probe.error || `HTTP ${probe.status}`
    });
  } else {
    providers.push({ name: 'Resend', status: 'Not configured', responseMs: null, lastFailure: '—' });
  }

  const stripeKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (stripeKey) {
    const start = Date.now();
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);
      await stripe.balance.retrieve();
      providers.push({
        name: 'Stripe',
        status: 'Operational',
        responseMs: Date.now() - start,
        lastFailure: 'No recent failures'
      });
    } catch (err) {
      providers.push({
        name: 'Stripe',
        status: 'Degraded',
        responseMs: Date.now() - start,
        lastFailure: err?.message || String(err)
      });
    }
  } else {
    providers.push({ name: 'Stripe', status: 'Not configured', responseMs: null, lastFailure: '—' });
  }

  return { ok: true, providers };
}

export async function getQueueMetrics() {
  const snap = getFounderBotQueueSnapshot();
  return {
    ok: true,
    pending: snap.pending,
    running: snap.running,
    failed: snap.failed,
    avgQueueSec: snap.avgQueueSec
  };
}

export { formatDurationSec, languageLabel };
