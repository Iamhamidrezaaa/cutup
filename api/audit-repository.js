import { getPool, isBillingDbConfigured } from './db/pool.js';

const MAX_META_JSON_BYTES = 14000;
const EVENT_NAME_RE = /^[a-zA-Z0-9_.:+-]{1,128}$/;
const EVENT_TYPE_RE = /^[a-zA-Z0-9_.-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export function clampEventName(raw) {
  const s = String(raw || '').trim().slice(0, 128);
  return EVENT_NAME_RE.test(s) ? s : '';
}

export function clampEventType(raw) {
  const s = String(raw || 'ui').trim().slice(0, 64);
  return EVENT_TYPE_RE.test(s) ? s : 'ui';
}

/**
 * Strip prototype pollution keys; limit depth/size for safe JSONB storage.
 */
export function sanitizeAuditMetadata(input, depth = 0) {
  if (depth > 8) return '[max_depth]';
  if (input == null) return {};
  if (typeof input === 'string') return String(input).slice(0, 4000);
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 80).map((x) => sanitizeAuditMetadata(x, depth + 1));
  }
  if (typeof input !== 'object') return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n >= 48) break;
    const key = String(k).slice(0, 96);
    if (key.startsWith('__') || key === 'constructor' || key === 'prototype') continue;
    out[key] = sanitizeAuditMetadata(v, depth + 1);
    n += 1;
  }
  try {
    const s = JSON.stringify(out);
    if (s.length > MAX_META_JSON_BYTES) {
      return { _truncated: true, bytes: s.length };
    }
  } catch {
    return { _invalid: true };
  }
  return out;
}

export function getRequestAuditContext(req) {
  if (!req) {
    return { ip: null, userAgent: null, path: null, referrer: null };
  }
  const xf = req.headers['x-forwarded-for'];
  const ip = xf ? String(xf).split(',')[0].trim().slice(0, 128) : String(req.ip || '').slice(0, 128) || null;
  const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 512) : null;
  const path = req.originalUrl ? String(req.originalUrl).split('?')[0].slice(0, 2048) : null;
  const referrer =
    req.headers.referer || req.headers.referrer
      ? String(req.headers.referer || req.headers.referrer).slice(0, 2048)
      : null;
  return { ip: ip || null, userAgent, path, referrer };
}

export async function insertAuditEventRow({
  userId = null,
  sessionId = null,
  eventType,
  eventName,
  metadata = {},
  ip = null,
  userAgent = null,
  path = null,
  referrer = null
}) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const meta = sanitizeAuditMetadata(metadata);
  const sid = sessionId != null ? String(sessionId).slice(0, 128) : null;
  const r = await pool.query(
    `INSERT INTO audit_events
      (user_id, session_id, event_type, event_name, metadata, ip, user_agent, path, referrer)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [
      userId && isUuid(String(userId)) ? String(userId) : null,
      sid,
      String(eventType || 'ui').slice(0, 64),
      String(eventName || 'unknown').slice(0, 128),
      JSON.stringify(meta),
      ip != null ? String(ip).slice(0, 128) : null,
      userAgent != null ? String(userAgent).slice(0, 512) : null,
      path != null ? String(path).slice(0, 2048) : null,
      referrer != null ? String(referrer).slice(0, 2048) : null
    ]
  );
  return r.rows[0] || null;
}

function parseDateParam(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listAuditEventsDb({
  userId = null,
  eventName = null,
  eventType = null,
  dateFrom = null,
  dateTo = null,
  limit = 50,
  offset = 0
}) {
  const pool = getPool();
  const conditions = ['1=1'];
  const params = [];
  let i = 1;

  if (userId && isUuid(userId)) {
    conditions.push(`e.user_id = $${i}::uuid`);
    params.push(userId);
    i += 1;
  }
  if (eventName && String(eventName).trim()) {
    conditions.push(`e.event_name = $${i}`);
    params.push(String(eventName).trim().slice(0, 128));
    i += 1;
  }
  if (eventType && String(eventType).trim()) {
    conditions.push(`e.event_type = $${i}`);
    params.push(String(eventType).trim().slice(0, 64));
    i += 1;
  }
  const d0 = parseDateParam(dateFrom);
  const d1 = parseDateParam(dateTo);
  if (d0) {
    conditions.push(`e.created_at >= $${i}`);
    params.push(d0.toISOString());
    i += 1;
  }
  if (d1) {
    conditions.push(`e.created_at <= $${i}`);
    params.push(d1.toISOString());
    i += 1;
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  params.push(lim, off);

  const q = `
    SELECT e.id, e.user_id, e.session_id, e.event_type, e.event_name, e.metadata, e.ip, e.user_agent,
           e.path, e.referrer, e.created_at, u.email AS user_email
    FROM audit_events e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;
  const r = await pool.query(q, params);
  return r.rows.map(mapAuditRow);
}

export async function countAuditEventsDb(filters) {
  const pool = getPool();
  const conditions = ['1=1'];
  const params = [];
  let i = 1;
  const { userId, eventName, eventType, dateFrom, dateTo } = filters;

  if (userId && isUuid(userId)) {
    conditions.push(`user_id = $${i}::uuid`);
    params.push(userId);
    i += 1;
  }
  if (eventName && String(eventName).trim()) {
    conditions.push(`event_name = $${i}`);
    params.push(String(eventName).trim().slice(0, 128));
    i += 1;
  }
  if (eventType && String(eventType).trim()) {
    conditions.push(`event_type = $${i}`);
    params.push(String(eventType).trim().slice(0, 64));
    i += 1;
  }
  const d0 = parseDateParam(dateFrom);
  const d1 = parseDateParam(dateTo);
  if (d0) {
    conditions.push(`created_at >= $${i}`);
    params.push(d0.toISOString());
    i += 1;
  }
  if (d1) {
    conditions.push(`created_at <= $${i}`);
    params.push(d1.toISOString());
    i += 1;
  }

  const r = await pool.query(
    `SELECT COUNT(*)::bigint AS c FROM audit_events WHERE ${conditions.join(' AND ')}`,
    params
  );
  return Number(r.rows[0]?.c || 0);
}

function mapAuditRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email || null,
    sessionId: row.session_id,
    eventType: row.event_type,
    eventName: row.event_name,
    metadata: row.metadata || {},
    ip: row.ip,
    userAgent: row.user_agent,
    path: row.path,
    referrer: row.referrer,
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at
  };
}

export async function getAuditSummaryDb({ dateFrom = null, dateTo = null } = {}) {
  const pool = getPool();
  const now = new Date();
  const d1 = parseDateParam(dateTo) || now;
  let d0 = parseDateParam(dateFrom);
  if (!d0) {
    d0 = new Date(d1.getTime() - 24 * 60 * 60 * 1000);
  }

  const range = [d0.toISOString(), d1.toISOString()];

  const totals = await pool.query(
    `SELECT
       COUNT(*)::int AS total_events,
       COUNT(*) FILTER (WHERE user_id IS NOT NULL)::int AS events_with_user,
       COUNT(DISTINCT user_id)::int AS active_users,
       COUNT(*) FILTER (WHERE event_type = 'error')::int AS error_events
     FROM audit_events
     WHERE created_at >= $1 AND created_at <= $2`,
    range
  );

  const topEvents = await pool.query(
    `SELECT event_name, event_type, COUNT(*)::int AS count
     FROM audit_events
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY event_name, event_type
     ORDER BY count DESC
     LIMIT 25`,
    range
  );

  const payment = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_name IN ('payment_attempt', 'payment_started'))::int AS attempts,
       COUNT(*) FILTER (WHERE event_name = 'payment_success')::int AS successes,
       COUNT(*) FILTER (WHERE event_name = 'payment_failed')::int AS failures
     FROM audit_events
     WHERE created_at >= $1 AND created_at <= $2`,
    range
  );

  const funnelNames = ['page_view', 'signup', 'onboarding_completed', 'payment_success'];
  const funnel = await pool.query(
    `SELECT event_name, COUNT(*)::int AS count
     FROM audit_events
     WHERE created_at >= $1 AND created_at <= $2
       AND event_name = ANY($3::text[])
     GROUP BY event_name`,
    [range[0], range[1], funnelNames]
  );

  const t = totals.rows[0] || {};
  const p = payment.rows[0] || {};
  const attempts = Number(p.attempts || 0);
  const successes = Number(p.successes || 0);
  const conversionRate = attempts > 0 ? Math.round((successes / attempts) * 10000) / 100 : null;

  return {
    range: { from: range[0], to: range[1] },
    totalEvents: Number(t.total_events || 0),
    eventsWithUser: Number(t.events_with_user || 0),
    activeUsers: Number(t.active_users || 0),
    errorEvents: Number(t.error_events || 0),
    topEvents: topEvents.rows,
    payment: {
      attempts,
      successes,
      failures: Number(p.failures || 0),
      conversionRate
    },
    funnel: funnel.rows
  };
}

export async function getUserAuditTimelineDb(userId, limit = 200) {
  if (!isUuid(String(userId))) return [];
  const pool = getPool();
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const r = await pool.query(
    `SELECT e.*, u.email AS user_email
     FROM audit_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.user_id = $1::uuid
     ORDER BY e.created_at ASC
     LIMIT $2`,
    [String(userId), lim]
  );
  return r.rows.map(mapAuditRow);
}
