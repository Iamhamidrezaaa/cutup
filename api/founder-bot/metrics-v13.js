/**
 * Founder Bot V1.3 — Support Center metrics.
 */
import { getPool, isBillingDbConfigured } from '../db/pool.js';
import { tableExists } from '../admin-db-safe.js';
import { ensureSupportTicketsSchema } from '../support-tickets-bootstrap.js';
import { formatDepartmentLabel, SUPPORT_DEPARTMENTS } from '../support-constants.js';
import { refreshSlaStatuses } from './support-metrics-shared.js';

async function ensureSupportReady(pool) {
  if (!isBillingDbConfigured()) return false;
  await ensureSupportTicketsSchema();
  if (!(await tableExists(pool, 'support_tickets'))) return false;
  await refreshSlaStatuses(pool);
  return true;
}

export async function getTicketsMetrics() {
  const pool = getPool();
  if (!(await ensureSupportReady(pool))) {
    return { ok: false, error: 'support_not_configured' };
  }

  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('OPEN', 'IN_PROGRESS'))::int AS open_count,
       COUNT(*) FILTER (WHERE status = 'WAITING_FOR_USER')::int AS waiting_count,
       COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
       COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_count
     FROM support_tickets`
  );
  const row = r.rows[0] || {};
  return {
    ok: true,
    open: Number(row.open_count || 0),
    waiting: Number(row.waiting_count || 0),
    resolved: Number(row.resolved_count || 0),
    closed: Number(row.closed_count || 0)
  };
}

export async function getUrgentMetrics() {
  const pool = getPool();
  if (!(await ensureSupportReady(pool))) {
    return { ok: false, error: 'support_not_configured' };
  }

  const [urgentRes, breachedRes] = await Promise.all([
    pool.query(
      `SELECT t.ticket_number, t.subject, t.department, t.priority, t.status,
              COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1)) AS user_name,
              u.email AS user_email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE t.priority = 'URGENT' AND t.status NOT IN ('RESOLVED', 'CLOSED')
       ORDER BY t.created_at ASC
       LIMIT 15`
    ),
    pool.query(
      `SELECT t.ticket_number, t.subject, t.department, t.priority, t.sla_due_at,
              COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1)) AS user_name,
              u.email AS user_email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE t.sla_status = 'breached' AND t.status NOT IN ('RESOLVED', 'CLOSED')
       ORDER BY t.sla_due_at ASC NULLS LAST
       LIMIT 15`
    )
  ]);

  return {
    ok: true,
    urgent: urgentRes.rows.map(mapTicketRow),
    breached: breachedRes.rows.map(mapTicketRow)
  };
}

function mapTicketRow(row) {
  return {
    ticketNumber: row.ticket_number,
    subject: row.subject,
    department: row.department,
    priority: row.priority,
    status: row.status,
    userName: row.user_name,
    userEmail: row.user_email,
    slaDueAt: row.sla_due_at
  };
}

export async function getSlaMetrics() {
  const pool = getPool();
  if (!(await ensureSupportReady(pool))) {
    return { ok: false, error: 'support_not_configured' };
  }

  const r = await pool.query(
    `SELECT department,
       COUNT(*) FILTER (
         WHERE status NOT IN ('RESOLVED', 'CLOSED')
           AND COALESCE(sla_status, 'healthy') = 'healthy'
       )::int AS healthy,
       COUNT(*) FILTER (
         WHERE status NOT IN ('RESOLVED', 'CLOSED')
           AND sla_status = 'at_risk'
       )::int AS at_risk,
       COUNT(*) FILTER (
         WHERE status NOT IN ('RESOLVED', 'CLOSED')
           AND sla_status = 'breached'
       )::int AS breached
     FROM support_tickets
     GROUP BY department
     ORDER BY department ASC`
  );

  const byDepartment = {};
  for (const dept of SUPPORT_DEPARTMENTS) {
    byDepartment[dept] = { healthy: 0, atRisk: 0, breached: 0 };
  }
  for (const row of r.rows) {
    const key = String(row.department || 'GENERAL').toUpperCase();
    byDepartment[key] = {
      healthy: Number(row.healthy || 0),
      atRisk: Number(row.at_risk || 0),
      breached: Number(row.breached || 0)
    };
  }

  return { ok: true, byDepartment, formatDepartmentLabel };
}

export async function getFeedbackMetrics() {
  const pool = getPool();
  if (!isBillingDbConfigured()) {
    return { ok: false, error: 'database_not_configured' };
  }

  const featureRequests = await tableExists(pool, 'support_tickets')
    ? pool.query(
        `SELECT t.ticket_number, t.subject, t.status, t.created_at,
                COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1)) AS user_name
         FROM support_tickets t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE t.department = 'FEATURE_REQUEST'
         ORDER BY t.created_at DESC
         LIMIT 5`
      )
    : { rows: [] };

  let bugReports = { rows: [] };
  let suggestions = { rows: [] };
  if (await tableExists(pool, 'pipeline_feedback')) {
    bugReports = await pool.query(
      `SELECT id, user_email, action, comment, created_at
       FROM pipeline_feedback
       WHERE rating = 'down'
       ORDER BY created_at DESC
       LIMIT 5`
    );
    suggestions = await pool.query(
      `SELECT id, user_email, action, comment, created_at
       FROM pipeline_feedback
       WHERE rating = 'up' AND COALESCE(TRIM(comment), '') <> ''
       ORDER BY created_at DESC
       LIMIT 5`
    );
  }

  return {
    ok: true,
    featureRequests: featureRequests.rows.map((r) => ({
      ticketNumber: r.ticket_number,
      subject: r.subject,
      status: r.status,
      userName: r.user_name,
      createdAt: r.created_at
    })),
    bugReports: bugReports.rows.map((r) => ({
      id: r.id,
      userEmail: r.user_email,
      action: r.action,
      comment: r.comment,
      createdAt: r.created_at
    })),
    suggestions: suggestions.rows.map((r) => ({
      id: r.id,
      userEmail: r.user_email,
      action: r.action,
      comment: r.comment,
      createdAt: r.created_at
    }))
  };
}
