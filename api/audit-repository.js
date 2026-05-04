import { getPool, isBillingDbConfigured } from './db/pool.js';
import { publishAuditEventMini } from './audit-broadcast.js';

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
  analyticsSessionId = null,
  countryCode = null,
  device = null,
  browser = null,
  plan = null,
  userSegment = null,
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
  const ax = analyticsSessionId != null ? String(analyticsSessionId).slice(0, 128) : null;
  const cc = countryCode != null ? String(countryCode).toUpperCase().slice(0, 2) : null;
  const dev = device != null ? String(device).slice(0, 32) : null;
  const br = browser != null ? String(browser).slice(0, 32) : null;
  const pl = plan != null ? String(plan).slice(0, 32) : null;
  const seg = userSegment != null ? String(userSegment).slice(0, 16) : null;

  const r = await pool.query(
    `INSERT INTO audit_events
      (user_id, session_id, analytics_session_id, country_code, device, browser, plan, user_segment,
       event_type, event_name, metadata, ip, user_agent, path, referrer)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
     RETURNING id, created_at`,
    [
      userId && isUuid(String(userId)) ? String(userId) : null,
      sid,
      ax,
      cc,
      dev,
      br,
      pl,
      seg,
      String(eventType || 'ui').slice(0, 64),
      String(eventName || 'unknown').slice(0, 128),
      JSON.stringify(meta),
      ip != null ? String(ip).slice(0, 128) : null,
      userAgent != null ? String(userAgent).slice(0, 512) : null,
      path != null ? String(path).slice(0, 2048) : null,
      referrer != null ? String(referrer).slice(0, 2048) : null
    ]
  );
  const row = r.rows[0] || null;
  if (row) {
    publishAuditEventMini({
      id: row.id,
      eventName: String(eventName || 'unknown').slice(0, 128),
      eventType: String(eventType || 'ui').slice(0, 64),
      createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
      userId: userId && isUuid(String(userId)) ? String(userId) : null,
      plan: pl,
      countryCode: cc,
      analyticsSessionId: ax,
      userSegment: seg
    });
  }
  return row;
}

function parseDateParam(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildAuditFilters(filters, tableAlias = '') {
  const conditions = ['1=1'];
  const params = [];
  let i = 1;
  const prefix = tableAlias ? `${tableAlias}.` : '';

  const {
    userId,
    eventName,
    eventType,
    dateFrom,
    dateTo,
    plan,
    countryCode,
    activityMin
  } = filters;

  if (userId && isUuid(userId)) {
    conditions.push(`${prefix}user_id = $${i}::uuid`);
    params.push(userId);
    i += 1;
  }
  if (eventName && String(eventName).trim()) {
    conditions.push(`${prefix}event_name = $${i}`);
    params.push(String(eventName).trim().slice(0, 128));
    i += 1;
  }
  if (eventType && String(eventType).trim()) {
    conditions.push(`${prefix}event_type = $${i}`);
    params.push(String(eventType).trim().slice(0, 64));
    i += 1;
  }
  const d0 = parseDateParam(dateFrom);
  const d1 = parseDateParam(dateTo);
  if (d0) {
    conditions.push(`${prefix}created_at >= $${i}`);
    params.push(d0.toISOString());
    i += 1;
  }
  if (d1) {
    conditions.push(`${prefix}created_at <= $${i}`);
    params.push(d1.toISOString());
    i += 1;
  }
  if (plan && String(plan).trim() && String(plan).trim() !== 'all') {
    conditions.push(`${prefix}plan = $${i}`);
    params.push(String(plan).trim().slice(0, 32));
    i += 1;
  }
  if (countryCode && String(countryCode).trim() && String(countryCode).trim() !== 'all') {
    conditions.push(`${prefix}country_code = $${i}`);
    params.push(String(countryCode).trim().toUpperCase().slice(0, 2));
    i += 1;
  }

  const act = Number(activityMin);
  if (Number.isFinite(act) && act > 0) {
    const rangeStart = d0 ? d0.toISOString() : new Date(Date.now() - 30 * 86400000).toISOString();
    const rangeEnd = d1 ? d1.toISOString() : new Date().toISOString();
    conditions.push(
      `${prefix}user_id IS NOT NULL AND ${prefix}user_id IN (
        SELECT user_id FROM audit_events
        WHERE user_id IS NOT NULL AND created_at >= $${i}::timestamptz AND created_at <= $${i + 1}::timestamptz
        GROUP BY user_id HAVING COUNT(*) >= $${i + 2}::int
      )`
    );
    params.push(rangeStart, rangeEnd, Math.min(Math.floor(act), 1000000));
    i += 3;
  }

  return { conditions, params, nextIndex: i };
}

export async function listAuditEventsDb({
  userId = null,
  eventName = null,
  eventType = null,
  dateFrom = null,
  dateTo = null,
  plan = null,
  countryCode = null,
  activityMin = null,
  limit = 50,
  offset = 0
}) {
  const pool = getPool();
  const { conditions, params, nextIndex } = buildAuditFilters(
    { userId, eventName, eventType, dateFrom, dateTo, plan, countryCode, activityMin },
    'e'
  );
  let i = nextIndex;

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  params.push(lim, off);

  const q = `
    SELECT e.id, e.user_id, e.session_id, e.analytics_session_id, e.country_code, e.device, e.browser,
           e.plan, e.user_segment, e.event_type, e.event_name, e.metadata, e.ip, e.user_agent,
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
  const { conditions, params } = buildAuditFilters(filters, '');
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
    analyticsSessionId: row.analytics_session_id ?? null,
    countryCode: row.country_code ?? null,
    device: row.device ?? null,
    browser: row.browser ?? null,
    plan: row.plan ?? null,
    userSegment: row.user_segment ?? null,
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

  const roll = await pool.query(`
    SELECT
      (SELECT COUNT(*)::bigint FROM audit_events) AS total_all,
      (SELECT COUNT(*)::int FROM audit_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS events_last_24h,
      (SELECT COUNT(DISTINCT user_id)::int FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '15 minutes' AND user_id IS NOT NULL) AS active_users_last_15m,
      (SELECT COUNT(*)::int FROM audit_events
       WHERE created_at >= NOW() - INTERVAL '24 hours' AND event_type = 'error') AS errors_last_24h,
      (SELECT COUNT(*)::int FROM audit_events WHERE created_at >= NOW() - INTERVAL '24 hours') AS total_last_24h
  `);
  const r0 = roll.rows[0] || {};
  const tot24 = Number(r0.total_last_24h || 0);
  const err24 = Number(r0.errors_last_24h || 0);
  const errorRateLast24h = tot24 > 0 ? Math.round((err24 / tot24) * 10000) / 100 : null;

  const pay24 = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_name IN ('payment_attempt', 'payment_started'))::int AS attempts,
       COUNT(*) FILTER (WHERE event_name = 'payment_success')::int AS successes
     FROM audit_events
     WHERE created_at >= NOW() - INTERVAL '24 hours'`
  );
  const p24 = pay24.rows[0] || {};
  const att24 = Number(p24.attempts || 0);
  const suc24 = Number(p24.successes || 0);
  const conversionRateLast24h = att24 > 0 ? Math.round((suc24 / att24) * 10000) / 100 : null;

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
    funnel: funnel.rows,
    liveMetrics: {
      totalEventsAllTime: Number(r0.total_all || 0),
      eventsLast24h: Number(r0.events_last_24h || 0),
      activeUsersLast15m: Number(r0.active_users_last_15m || 0),
      errorRate: errorRateLast24h,
      conversionRate: conversionRateLast24h
    }
  };
}

/** Dev-friendly sample rows (no user linkage). */
export async function seedTestAuditEventsDb() {
  if (!isBillingDbConfigured()) return 0;
  const pool = getPool();
  const rows = [
    ['product', 'page_view', { seed: true }],
    ['product', 'signup', { seed: true }],
    ['ui', 'click', { seed: true, target: 'cta' }],
    ['error', 'js_error', { seed: true, message: 'test_error' }],
    ['product', 'payment_started', { seed: true }],
    ['product', 'payment_success', { seed: true }],
    ['product', 'onboarding_completed', { seed: true }]
  ];
  let n = 0;
  for (const [eventType, eventName, meta] of rows) {
    await pool.query(
      `INSERT INTO audit_events (event_type, event_name, metadata)
       VALUES ($1, $2, $3::jsonb)`,
      [eventType, eventName, JSON.stringify(meta)]
    );
    n += 1;
  }
  return n;
}

/** Time buckets for charts: 'hour' | 'day' */
export async function getAuditEventTimeseriesDb({ dateFrom, dateTo, bucket = 'hour' } = {}) {
  const pool = getPool();
  const d1 = parseDateParam(dateTo) || new Date();
  let d0 = parseDateParam(dateFrom) || new Date(d1.getTime() - 7 * 86400000);
  const trunc = bucket === 'day' ? 'day' : 'hour';
  const r = await pool.query(
    `SELECT date_trunc($3::text, created_at) AS b, COUNT(*)::int AS c
     FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
     GROUP BY 1
     ORDER BY 1 ASC`,
    [d0.toISOString(), d1.toISOString(), trunc]
  );
  return r.rows.map((x) => ({
    t: x.b?.toISOString ? x.b.toISOString() : x.b,
    count: Number(x.c || 0)
  }));
}

export async function getAuditErrorTimeseriesDb({ dateFrom, dateTo, bucket = 'hour' } = {}) {
  const pool = getPool();
  const d1 = parseDateParam(dateTo) || new Date();
  let d0 = parseDateParam(dateFrom) || new Date(d1.getTime() - 7 * 86400000);
  const trunc = bucket === 'day' ? 'day' : 'hour';
  const r = await pool.query(
    `SELECT date_trunc($3::text, created_at) AS b, COUNT(*)::int AS c
     FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND event_type = 'error'
     GROUP BY 1
     ORDER BY 1 ASC`,
    [d0.toISOString(), d1.toISOString(), trunc]
  );
  return r.rows.map((x) => ({
    t: x.b?.toISOString ? x.b.toISOString() : x.b,
    count: Number(x.c || 0)
  }));
}

export async function getAuditDauTimeseriesDb({ dateFrom, dateTo } = {}) {
  const pool = getPool();
  const d1 = parseDateParam(dateTo) || new Date();
  let d0 = parseDateParam(dateFrom) || new Date(d1.getTime() - 30 * 86400000);
  const r = await pool.query(
    `SELECT date_trunc('day', created_at) AS b, COUNT(DISTINCT user_id)::int AS c
     FROM audit_events
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
       AND user_id IS NOT NULL
     GROUP BY 1
     ORDER BY 1 ASC`,
    [d0.toISOString(), d1.toISOString()]
  );
  return r.rows.map((x) => ({
    t: x.b?.toISOString ? x.b.toISOString() : x.b,
    activeUsers: Number(x.c || 0)
  }));
}

function buildOrderedFunnelCountSql(stepCount) {
  if (stepCount < 1) return null;
  if (stepCount === 1) {
    return `SELECT COUNT(DISTINCT user_id)::int AS c FROM audit_events
      WHERE user_id IS NOT NULL AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz
        AND event_name = $3`;
  }
  const last = stepCount - 1;
  const parts = [];
  for (let i = last - 1; i >= 0; i -= 1) {
    const cur = `e${i}`;
    const nxt = `e${i + 1}`;
    parts.push(
      `EXISTS (
        SELECT 1 FROM audit_events ${cur}
        WHERE ${cur}.user_id = ${nxt}.user_id
          AND ${cur}.event_name = $${3 + i}
          AND ${cur}.created_at >= $1::timestamptz AND ${cur}.created_at <= $2::timestamptz
          AND ${cur}.created_at <= ${nxt}.created_at
      )`
    );
  }
  const existsChain = parts.join(' AND ');
  return `SELECT COUNT(DISTINCT e${last}.user_id)::int AS c
    FROM audit_events e${last}
    WHERE e${last}.user_id IS NOT NULL
      AND e${last}.event_name = $${3 + last}
      AND e${last}.created_at >= $1::timestamptz AND e${last}.created_at <= $2::timestamptz
      AND ${existsChain}`;
}

/**
 * Full ordered funnel: for step k, user must have fired events 0..k-1 in order (timestamps) in the window.
 */
export async function computeDynamicFunnelDb(rawSteps, dateFrom, dateTo) {
  const pool = getPool();
  const d1 = parseDateParam(dateTo) || new Date();
  let d0 = parseDateParam(dateFrom) || new Date(d1.getTime() - 7 * 86400000);
  const sf = d0.toISOString();
  const st = d1.toISOString();

  const steps = String(rawSteps || '')
    .split(/[\n,]+/)
    .map((s) => String(s || '').trim().slice(0, 128))
    .filter((s) => /^[a-zA-Z0-9_.:+-]{1,128}$/.test(s))
    .slice(0, 12);

  if (!steps.length) return { steps: [], range: { from: sf, to: st } };

  const out = [];
  for (let k = 0; k < steps.length; k += 1) {
    const prefix = steps.slice(0, k + 1);
    const sql = buildOrderedFunnelCountSql(prefix.length);
    const params = [sf, st, ...prefix];
    const r = await pool.query(sql, params);
    const c = Number(r.rows[0]?.c || 0);
    const prevCount = out.length ? out[out.length - 1].distinctUsers : null;
    out.push({
      eventName: steps[k],
      distinctUsers: c,
      conversionFromPrevious:
        k === 0 ? null : prevCount != null && prevCount > 0 ? Math.round((c / prevCount) * 10000) / 100 : null
    });
  }
  return { steps: out, range: { from: sf, to: st } };
}

export async function insertAuditAlertRow({ rule, severity = 'warning', message, payload = {} }) {
  if (!isBillingDbConfigured()) return null;
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO audit_alerts (rule, severity, message, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, created_at`,
    [
      String(rule || 'unknown').slice(0, 64),
      String(severity || 'warning').slice(0, 32),
      String(message || '').slice(0, 2000),
      JSON.stringify(payload && typeof payload === 'object' ? payload : {})
    ]
  );
  return r.rows[0] || null;
}

export async function listAuditAlertsDb({ limit = 50, offset = 0 } = {}) {
  if (!isBillingDbConfigured()) return [];
  const pool = getPool();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const r = await pool.query(
    `SELECT id, rule, severity, message, payload, created_at
     FROM audit_alerts
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [lim, off]
  );
  return r.rows.map((row) => ({
    id: row.id,
    rule: row.rule,
    severity: row.severity,
    message: row.message,
    payload: row.payload || {},
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at
  }));
}

/**
 * Rule: error_rate — errors/total in window ≥ threshold (min volume).
 * Rule: payment_failure_spike — failures now vs previous window.
 */
export async function evaluateAuditAlertsDb() {
  if (!isBillingDbConfigured()) return { inserted: 0 };
  const pool = getPool();
  const now = Date.now();
  const w1a = new Date(now - 60 * 60 * 1000);
  const w1b = new Date(now);
  const w0a = new Date(now - 120 * 60 * 1000);
  const w0b = w1a;

  const errWin = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE event_type = 'error')::int AS errs
     FROM audit_events
     WHERE created_at >= $1 AND created_at < $2`,
    [w1a.toISOString(), w1b.toISOString()]
  );
  const total = Number(errWin.rows[0]?.total || 0);
  const errs = Number(errWin.rows[0]?.errs || 0);
  const rate = total > 0 ? errs / total : 0;

  let inserted = 0;
  if (total >= 30 && rate >= 0.12) {
    await insertAuditAlertRow({
      rule: 'high_error_rate',
      severity: 'critical',
      message: `High error rate: ${(rate * 100).toFixed(1)}% (${errs}/${total}) in the last hour`,
      payload: { total, errs, rate, window: '1h' }
    });
    inserted += 1;
  }

  const pay = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM audit_events
         WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND event_name = 'payment_failed') AS cur,
       (SELECT COUNT(*)::int FROM audit_events
         WHERE created_at >= $3::timestamptz AND created_at < $4::timestamptz AND event_name = 'payment_failed') AS prev`,
    [w1a.toISOString(), w1b.toISOString(), w0a.toISOString(), w0b.toISOString()]
  );
  const cur = Number(pay.rows[0]?.cur || 0);
  const prev = Number(pay.rows[0]?.prev || 0);
  if (cur >= 5 && cur >= prev * 2 && prev >= 1) {
    await insertAuditAlertRow({
      rule: 'payment_failure_spike',
      severity: 'warning',
      message: `Payment failures spiked: ${cur} in last hour vs ${prev} prior hour`,
      payload: { cur, prev }
    });
    inserted += 1;
  }

  return { inserted };
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
