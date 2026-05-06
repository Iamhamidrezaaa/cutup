/**
 * Safe PostgreSQL helpers for admin dashboards (optional tables, partial failures).
 */
import { getPool, isBillingDbConfigured } from './db/pool.js';

const tableExistsCache = new Map();

/** @returns {boolean} */
export function isMissingRelationError(err) {
  const code = err?.code;
  const msg = String(err?.message || '');
  return code === '42P01' || /relation .* does not exist/i.test(msg);
}

/**
 * @param {string} context
 * @param {Error|{ message?: string, code?: string }} err
 */
export function friendlyDbError(context, err) {
  if (isMissingRelationError(err)) {
    if (/payment_attempts/i.test(String(err?.message || ''))) {
      return 'Payment verification telemetry is not available yet.';
    }
    if (/audit_events/i.test(String(err?.message || ''))) {
      return 'Audit telemetry is not available yet.';
    }
    if (/conversion_email_log/i.test(String(err?.message || ''))) {
      return 'Email cron telemetry is not available yet.';
    }
    return `${context} telemetry is not available yet.`;
  }
  return `${context} is temporarily unavailable.`;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tableName
 */
export async function tableExists(pool, tableName) {
  const key = String(tableName || '').toLowerCase();
  if (!key) return false;
  if (tableExistsCache.has(key)) return tableExistsCache.get(key);
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [key]
    );
    const ok = r.rowCount > 0;
    tableExistsCache.set(key, ok);
    return ok;
  } catch (e) {
    console.warn('[admin-db-safe] tableExists', key, e?.message);
    tableExistsCache.set(key, false);
    return false;
  }
}

export function clearTableExistsCache() {
  tableExistsCache.clear();
}

/**
 * @template T
 * @param {import('pg').Pool} pool
 * @param {string} sql
 * @param {unknown[]} params
 * @param {{ defaultValue?: T, context?: string, logLabel?: string }} [opts]
 * @returns {Promise<{ ok: true, rows: import('pg').QueryResultRow[] } | { ok: false, error: string, friendly: string, rows: [] }>}
 */
export async function safeQuery(pool, sql, params = [], opts = {}) {
  const context = opts.context || 'Metric';
  try {
    const r = await pool.query(sql, params);
    return { ok: true, rows: r.rows || [] };
  } catch (err) {
    const friendly = friendlyDbError(context, err);
    if (opts.logLabel !== false) {
      console.warn(`[admin-db-safe] ${opts.logLabel || context}:`, err?.message || err);
    }
    return { ok: false, error: err?.message || String(err), friendly, rows: [] };
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} sql
 * @param {unknown[]} params
 * @param {{ context?: string, defaultRow?: Record<string, unknown> }} [opts]
 */
export async function safeQueryScalar(pool, sql, params = [], opts = {}) {
  const r = await safeQuery(pool, sql, params, { context: opts.context, logLabel: opts.context });
  if (!r.ok) return { ok: false, value: null, friendly: r.friendly, warning: r.friendly };
  const row = r.rows[0] || opts.defaultRow || {};
  const key = Object.keys(row)[0];
  const value = key != null ? row[key] : null;
  return { ok: true, value, friendly: null, warning: null };
}

/**
 * Run fn only if table exists.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {string} tableName
 * @param {() => Promise<T>} fn
 * @param {{ fallback?: T, friendly?: string }} [opts]
 */
export async function whenTableExists(pool, tableName, fn, opts = {}) {
  const exists = await tableExists(pool, tableName);
  if (!exists) {
    const friendly =
      opts.friendly ||
      (tableName === 'payment_attempts'
        ? 'Payment verification telemetry is not available yet.'
        : `${tableName} telemetry is not configured yet.`);
    return { ok: false, value: opts.fallback ?? null, warning: friendly, missingTable: tableName };
  }
  try {
    const value = await fn();
    return { ok: true, value, warning: null, missingTable: null };
  } catch (err) {
    const friendly = friendlyDbError(tableName, err);
    console.warn(`[admin-db-safe] whenTableExists ${tableName}:`, err?.message);
    return { ok: false, value: opts.fallback ?? null, warning: friendly, missingTable: tableName };
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {Array<() => Promise<unknown>>} tasks
 */
export async function safeAllSettled(tasks) {
  const results = await Promise.allSettled(tasks.map((t) => t()));
  return results.map((r) => (r.status === 'fulfilled' ? { ok: true, value: r.value } : { ok: false, error: r.reason }));
}

export async function getAdminDbCapabilitySnapshot(pool) {
  if (!pool) return { paymentAttempts: false };
  return {
    paymentAttempts: await tableExists(pool, 'payment_attempts'),
    auditEvents: await tableExists(pool, 'audit_events'),
    conversionEmailLog: await tableExists(pool, 'conversion_email_log'),
    usageHistory: await tableExists(pool, 'usage_history'),
    payments: await tableExists(pool, 'payments')
  };
}
