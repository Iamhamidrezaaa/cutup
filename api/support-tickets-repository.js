import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureSupportTicketsSchema } from './support-tickets-bootstrap.js';
import { ensureOperationsV3Schema } from './operations-bootstrap.js';
import { ensureAdminProfilesSchema } from './admin-profiles-bootstrap.js';
import {
  avatarFallbackUrl,
  resolveAgentIdentity,
} from './admin-profiles-repository.js';
import { isValidDepartment, isValidPriority, isValidStatus } from './support-constants.js';
import { computeSlaDueAt, computeSlaStatus, enrichTicketWithSla } from './support-sla.js';

function mapTicket(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    ticket_number: row.ticket_number,
    user_id: String(row.user_id),
    user_email: row.user_email || null,
    department: row.department,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    message: row.message,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    assigned_admin_id: row.assigned_admin_id != null ? Number(row.assigned_admin_id) : null,
    assigned_admin_email: row.assigned_admin_email || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at || null,
    closed_by: row.closed_by || null,
    satisfaction_rating: row.satisfaction_rating != null ? Number(row.satisfaction_rating) : null,
    first_response_at: row.first_response_at || null,
    resolved_at: row.resolved_at || null,
    last_activity_at: row.last_activity_at || row.updated_at,
    message_count: row.message_count != null ? Number(row.message_count) : undefined,
    sla_due_at: row.sla_due_at || null,
    sla_status: row.sla_status || null,
  };
}

function withSla(row) {
  return enrichTicketWithSla(mapTicket(row));
}

function mapMessage(row) {
  const attach = row.attachments;
  let attachments = null;
  if (Array.isArray(attach)) attachments = attach;
  else if (attach && typeof attach === 'object') attachments = attach;
  return {
    id: Number(row.id),
    ticket_id: Number(row.ticket_id),
    sender_type: row.sender_type,
    sender_user_id: row.sender_user_id ? String(row.sender_user_id) : null,
    sender_admin_id: row.sender_admin_id != null ? Number(row.sender_admin_id) : null,
    sender_name: row.sender_name || null,
    sender_email: row.sender_email || null,
    sender_avatar_url: row.sender_avatar_url || null,
    sender_job_title: row.sender_job_title || null,
    message: row.message,
    attachments,
    created_at: row.created_at,
  };
}

function mapEvent(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: Number(row.id),
    ticket_id: Number(row.ticket_id),
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_id: row.actor_id || null,
    payload,
    created_at: row.created_at,
  };
}

const USER_VISIBLE_EVENT_TYPES = ['created', 'status_change', 'assigned', 'admin_reply', 'user_reply'];

async function nextTicketNumber(client) {
  const { rows } = await client.query(`SELECT nextval('support_ticket_number_seq') AS n`);
  const n = Number(rows[0]?.n || 1000);
  return `TKT-${String(n).padStart(6, '0')}`;
}

async function logTicketEvent(client, ticketId, eventType, actorType, actorId, payload = {}) {
  await client.query(
    `INSERT INTO support_ticket_events (ticket_id, event_type, actor_type, actor_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [ticketId, eventType, actorType, actorId || null, JSON.stringify(payload)],
  );
}

export async function createSupportTicket({
  userId,
  department,
  priority = 'NORMAL',
  subject,
  message,
  attachments = null,
  metadata = {},
}) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  await ensureOperationsV3Schema();

  const dept = String(department || '').trim().toUpperCase();
  const pri = String(priority || 'NORMAL').trim().toUpperCase();
  const subj = String(subject || '').trim();
  const body = String(message || '').trim();
  const attach = Array.isArray(attachments) && attachments.length ? attachments : null;

  if (!isValidDepartment(dept)) return { ok: false, reason: 'invalid_department' };
  if (!isValidPriority(pri)) return { ok: false, reason: 'invalid_priority' };
  if (!subj || subj.length < 3) return { ok: false, reason: 'invalid_subject' };
  if (!body && !attach) return { ok: false, reason: 'invalid_message' };
  if (body && body.length < 10 && !attach) return { ok: false, reason: 'invalid_message' };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketNumber = await nextTicketNumber(client);
    const slaDue = computeSlaDueAt(new Date(), dept, pri);
    const { rows } = await client.query(
      `INSERT INTO support_tickets
        (ticket_number, user_id, department, priority, status, subject, message, metadata, sla_due_at, sla_status)
       VALUES ($1, $2::uuid, $3, $4, 'OPEN', $5, $6, $7::jsonb, $8, 'healthy')
       RETURNING *`,
      [ticketNumber, userId, dept, pri, subj, body, JSON.stringify(metadata), slaDue],
    );
    const ticket = rows[0];
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_user_id, message, attachments)
       VALUES ($1, 'user', $2::uuid, $3, $4::jsonb)`,
      [ticket.id, userId, body || '', attach ? JSON.stringify(attach) : null],
    );
    await logTicketEvent(client, ticket.id, 'created', 'user', userId, { department: dept, priority: pri });
    await client.query('COMMIT');
    return { ok: true, ticket: mapTicket(ticket) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserTicketOverview(userId) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  await ensureOperationsV3Schema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_count,
      COUNT(*) FILTER (WHERE status = 'WAITING_FOR_USER')::int AS waiting_count,
      COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress_count,
      COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_7d,
      AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) FILTER (WHERE first_response_at IS NOT NULL) AS avg_first_response_sec
     FROM support_tickets WHERE user_id = $1::uuid`,
    [userId],
  );
  const row = rows[0] || {};
  const avgSec = row.avg_first_response_sec;
  return {
    ok: true,
    stats: {
      ...row,
      avg_first_response_ms: avgSec != null ? Math.round(Number(avgSec) * 1000) : null,
    },
  };
}

export async function getUserSupportActivity(userId, { limit = 5 } = {}) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured', activity: [] };
  await ensureSupportTicketsSchema();
  const safeLimit = Math.min(30, Math.max(1, Number(limit) || 5));
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT e.event_type, e.payload, e.created_at, t.ticket_number, t.subject
     FROM support_ticket_events e
     JOIN support_tickets t ON t.id = e.ticket_id
     WHERE t.user_id = $1::uuid
       AND e.event_type IN ('created', 'assigned', 'admin_reply', 'user_reply', 'status_change')
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [userId, safeLimit],
  );
  return {
    ok: true,
    activity: rows.map((r) => ({
      event_type: r.event_type,
      payload: r.payload && typeof r.payload === 'object' ? r.payload : {},
      created_at: r.created_at,
      ticket_number: r.ticket_number,
      subject: r.subject,
    })),
  };
}

export async function listUserTickets(userId, { page = 1, limit = 20 } = {}) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured', tickets: [] };
  await ensureSupportTicketsSchema();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;
  const pool = getPool();

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM support_tickets WHERE user_id = $1::uuid`,
    [userId],
  );
  const total = countRes.rows[0]?.total ?? 0;

  const { rows } = await pool.query(
    `SELECT t.*,
      (SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS last_activity_at
     FROM support_tickets t
     WHERE t.user_id = $1::uuid
     ORDER BY COALESCE((SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id), t.updated_at) DESC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, offset],
  );

  return {
    ok: true,
    tickets: rows.map(withSla),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit) || 1),
  };
}

export async function getTicketForUser(userId, ticketNumber) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  await ensureAdminProfilesSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, a.email AS assigned_admin_email,
      ap.display_name AS assigned_agent_name,
      ap.avatar_url AS assigned_agent_avatar,
      ap.job_title AS assigned_agent_title
     FROM support_tickets t
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     LEFT JOIN admin_profiles ap ON ap.admin_user_id = t.assigned_admin_id
     WHERE t.ticket_number = $1 AND t.user_id = $2::uuid
     LIMIT 1`,
    [String(ticketNumber).trim(), userId],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  const [messages, events] = await Promise.all([
    pool.query(
      `SELECT m.*,
        CASE WHEN m.sender_type = 'admin' THEN a.email ELSE u.email END AS sender_email,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(ap.display_name, a.email)
             ELSE COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1), u.email) END AS sender_name,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(ap.avatar_url, '') ELSE '' END AS sender_avatar_url,
        CASE WHEN m.sender_type = 'admin' THEN ap.job_title ELSE NULL END AS sender_job_title
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id = m.sender_user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN admins a ON a.id = m.sender_admin_id
       LEFT JOIN admin_profiles ap ON ap.admin_user_id = m.sender_admin_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [rows[0].id],
    ),
    pool.query(
      `SELECT e.*
       FROM support_ticket_events e
       WHERE e.ticket_id = $1 AND e.event_type = ANY($2::text[])
       ORDER BY e.created_at ASC`,
      [rows[0].id, USER_VISIBLE_EVENT_TYPES],
    ),
  ]);
  const ticket = withSla(rows[0]);
  ticket.assigned_agent = rows[0].assigned_admin_id
    ? {
        display_name: rows[0].assigned_agent_name || rows[0].assigned_admin_email,
        avatar_url: rows[0].assigned_agent_avatar || avatarFallbackUrl(rows[0].assigned_agent_name || 'Agent'),
        job_title: rows[0].assigned_agent_title || null,
      }
    : null;

  return {
    ok: true,
    ticket,
    messages: messages.rows.map((row) => {
      const msg = mapMessage(row);
      if (msg.sender_type === 'admin') {
        msg.sender_avatar_url = row.sender_avatar_url || avatarFallbackUrl(msg.sender_name);
      }
      return msg;
    }),
    events: events.rows.map(mapEvent),
  };
}

export async function addUserReply(userId, ticketNumber, message, attachments = null) {
  const body = String(message || '').trim();
  const attach = Array.isArray(attachments) && attachments.length ? attachments : null;
  if (!body && !attach) return { ok: false, reason: 'invalid_message' };

  const ticketRes = await getTicketForUser(userId, ticketNumber);
  if (!ticketRes.ok) return ticketRes;
  if (['CLOSED', 'RESOLVED'].includes(ticketRes.ticket.status)) {
    return { ok: false, reason: 'ticket_closed' };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_user_id, message, attachments)
       VALUES ($1, 'user', $2::uuid, $3, $4::jsonb)
       RETURNING *`,
      [ticketRes.ticket.id, userId, body || '', attach ? JSON.stringify(attach) : null],
    );
    const newStatus = ticketRes.ticket.status === 'WAITING_FOR_USER' ? 'IN_PROGRESS' : ticketRes.ticket.status;
    await client.query(
      `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1`,
      [ticketRes.ticket.id, newStatus === 'WAITING_FOR_USER' ? 'IN_PROGRESS' : newStatus],
    );
    await logTicketEvent(client, ticketRes.ticket.id, 'user_reply', 'user', userId, {});
    await client.query('COMMIT');
    return { ok: true, message: mapMessage(rows[0]), ticket: { ...ticketRes.ticket, status: newStatus } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ——— Admin ———

function buildAdminWhere(filters, params) {
  const where = [];
  let n = params.length + 1;

  if (filters.status) {
    where.push(`t.status = $${n}`);
    params.push(String(filters.status).trim().toUpperCase());
    n += 1;
  }
  if (filters.department) {
    where.push(`t.department = $${n}`);
    params.push(String(filters.department).trim().toUpperCase());
    n += 1;
  }
  if (filters.priority) {
    where.push(`t.priority = $${n}`);
    params.push(String(filters.priority).trim().toUpperCase());
    n += 1;
  }
  if (filters.queue === 'breached') {
    where.push(`t.sla_status = 'breached' AND t.status NOT IN ('RESOLVED','CLOSED')`);
  } else if (filters.queue === 'urgent') {
    where.push(`t.priority = 'URGENT' AND t.status NOT IN ('RESOLVED','CLOSED')`);
  } else if (filters.queue === 'waiting') {
    where.push(`t.status = 'WAITING_FOR_USER'`);
  } else if (filters.queue === 'resolved') {
    where.push(`t.status IN ('RESOLVED','CLOSED')`);
  } else if (filters.queue === 'assigned_me' || filters.queue === 'assigned') {
    if (filters.currentAdminId) {
      where.push(`t.assigned_admin_id = $${n} AND t.status NOT IN ('RESOLVED','CLOSED')`);
      params.push(Number(filters.currentAdminId));
      n += 1;
    } else {
      where.push(`t.assigned_admin_id IS NOT NULL AND t.status NOT IN ('RESOLVED','CLOSED')`);
    }
  } else if (filters.queue === 'open') {
    where.push(`t.status = 'OPEN'`);
  } else if (filters.queue === 'all_open' || filters.queue === '') {
    where.push(`t.status NOT IN ('RESOLVED','CLOSED')`);
  }
  if (filters.assignedAdminId === 'unassigned') {
    where.push('t.assigned_admin_id IS NULL');
  } else if (filters.assignedAdminId) {
    where.push(`t.assigned_admin_id = $${n}`);
    params.push(Number(filters.assignedAdminId));
    n += 1;
  }
  if (filters.q) {
    where.push(`(
      t.ticket_number ILIKE $${n}
      OR t.subject ILIKE $${n}
      OR u.email ILIKE $${n}
    )`);
    params.push(`%${String(filters.q).trim()}%`);
    n += 1;
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', nextN: n };
}

export async function listAdminTickets(filters = {}) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured', tickets: [] };
  await ensureSupportTicketsSchema();
  await ensureAdminProfilesSchema();

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
  const offset = (page - 1) * limit;
  const params = [];
  const { whereSql } = buildAdminWhere(filters, params);

  const pool = getPool();
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;

  const listParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT t.*, u.email AS user_email,
      COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1)) AS customer_name,
      a.email AS assigned_admin_email,
      ap.display_name AS assigned_agent_name,
      ap.avatar_url AS assigned_agent_avatar,
      ap.job_title AS assigned_agent_title,
      (SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS last_activity_at,
      (SELECT COALESCE(SUM(
        CASE WHEN m.attachments IS NULL THEN 0
             WHEN jsonb_typeof(m.attachments) = 'array' THEN jsonb_array_length(m.attachments)
             ELSE 0 END
      ), 0)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS attachment_count
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     LEFT JOIN admin_profiles ap ON ap.admin_user_id = t.assigned_admin_id
     ${whereSql}
     ORDER BY COALESCE((SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id), t.updated_at) DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams,
  );

  return {
    ok: true,
    tickets: rows.map((row) => {
      const ticket = withSla(row);
      ticket.customer_name = row.customer_name || null;
      ticket.attachment_count = Number(row.attachment_count) || 0;
      ticket.assigned_agent = row.assigned_admin_id
        ? {
            display_name: row.assigned_agent_name || row.assigned_admin_email,
            avatar_url: row.assigned_agent_avatar || avatarFallbackUrl(row.assigned_agent_name || 'Agent'),
            job_title: row.assigned_agent_title || null,
          }
        : null;
      return ticket;
    }),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}

export async function getCustomerContextForSupport(userId) {
  if (!isBillingDbConfigured()) return null;
  await ensureSupportTicketsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
      u.id,
      u.email,
      u.created_at AS join_date,
      up.first_name,
      up.last_name,
      s.plan,
      (SELECT COUNT(*)::int FROM support_tickets st
        WHERE st.user_id = u.id AND st.status NOT IN ('RESOLVED','CLOSED')) AS open_tickets,
      (SELECT COUNT(*)::int FROM support_tickets st
        WHERE st.user_id = u.id AND st.status IN ('RESOLVED','CLOSED')) AS resolved_tickets,
      (SELECT MAX(GREATEST(
        st.updated_at,
        COALESCE((SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = st.id), st.updated_at)
      )) FROM support_tickets st WHERE st.user_id = u.id) AS last_activity,
      (SELECT ROUND(AVG(st.satisfaction_rating)::numeric, 1)
        FROM support_tickets st WHERE st.user_id = u.id AND st.satisfaction_rating IS NOT NULL) AS support_score
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN subscriptions s ON s.user_id = u.id
     WHERE u.id = $1::uuid
     LIMIT 1`,
    [String(userId)],
  );
  const row = rows[0];
  if (!row) return null;
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    || String(row.email || '').split('@')[0]
    || 'Customer';
  return {
    user_id: String(row.id),
    name,
    email: row.email,
    plan: row.plan || 'free',
    join_date: row.join_date,
    open_tickets: Number(row.open_tickets) || 0,
    resolved_tickets: Number(row.resolved_tickets) || 0,
    last_activity: row.last_activity,
    support_score: row.support_score != null ? Number(row.support_score) : null,
    avatar_url: avatarFallbackUrl(name),
  };
}

export async function getTicketForAdmin(ticketNumber) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  await ensureAdminProfilesSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, u.email AS user_email,
      COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1)) AS customer_name,
      a.email AS assigned_admin_email,
      ap.display_name AS assigned_agent_name,
      ap.avatar_url AS assigned_agent_avatar,
      ap.job_title AS assigned_agent_title
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     LEFT JOIN admin_profiles ap ON ap.admin_user_id = t.assigned_admin_id
     WHERE t.ticket_number = $1 LIMIT 1`,
    [String(ticketNumber).trim()],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };

  const [messages, notes, events, customer] = await Promise.all([
    pool.query(
      `SELECT m.*,
        CASE WHEN m.sender_type = 'admin' THEN a.email ELSE u.email END AS sender_email,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(ap.display_name, a.email)
             ELSE COALESCE(NULLIF(TRIM(up.first_name), ''), SPLIT_PART(u.email, '@', 1), u.email) END AS sender_name,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(ap.avatar_url, '')
             ELSE '' END AS sender_avatar_url,
        CASE WHEN m.sender_type = 'admin' THEN ap.job_title ELSE NULL END AS sender_job_title
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id = m.sender_user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN admins a ON a.id = m.sender_admin_id
       LEFT JOIN admin_profiles ap ON ap.admin_user_id = m.sender_admin_id
       WHERE m.ticket_id = $1 ORDER BY m.created_at ASC`,
      [rows[0].id],
    ),
    pool.query(
      `SELECT n.*, ap.display_name AS admin_display_name, ap.avatar_url AS admin_avatar_url, ap.job_title AS admin_job_title
       FROM support_ticket_notes n
       LEFT JOIN admin_profiles ap ON ap.admin_user_id = n.admin_id
       WHERE n.ticket_id = $1 ORDER BY n.created_at DESC`,
      [rows[0].id],
    ),
    pool.query(
      `SELECT e.* FROM support_ticket_events e WHERE e.ticket_id = $1 ORDER BY e.created_at ASC`,
      [rows[0].id],
    ),
    getCustomerContextForSupport(rows[0].user_id),
  ]);

  const ticket = withSla(rows[0]);
  ticket.customer_name = rows[0].customer_name || null;
  ticket.assigned_agent = rows[0].assigned_admin_id
    ? {
        display_name: rows[0].assigned_agent_name || rows[0].assigned_admin_email,
        avatar_url: rows[0].assigned_agent_avatar || avatarFallbackUrl(rows[0].assigned_agent_name || 'Agent'),
        job_title: rows[0].assigned_agent_title || null,
      }
    : null;

  const mappedMessages = messages.rows.map((row) => {
    const msg = mapMessage(row);
    if (msg.sender_type === 'admin') {
      msg.sender_avatar_url = row.sender_avatar_url || avatarFallbackUrl(msg.sender_name);
    } else {
      msg.sender_avatar_url = avatarFallbackUrl(msg.sender_name || 'Customer');
    }
    return msg;
  });

  const mappedNotes = notes.rows.map((n) => ({
    ...n,
    admin_display_name: n.admin_display_name || n.admin_email,
    admin_avatar_url: n.admin_avatar_url || avatarFallbackUrl(n.admin_display_name || n.admin_email),
    admin_job_title: n.admin_job_title || null,
  }));

  const allAttachments = [];
  mappedMessages.forEach((m) => {
    if (Array.isArray(m.attachments)) {
      m.attachments.forEach((a) => {
        if (a && typeof a === 'object') allAttachments.push({ ...a, message_id: m.id, sender_type: m.sender_type });
      });
    }
  });

  return {
    ok: true,
    ticket,
    messages: mappedMessages,
    notes: mappedNotes,
    events: events.rows.map(mapEvent),
    customer,
    attachments: allAttachments,
  };
}

export async function addAdminReply({ ticketNumber, adminId, adminEmail, message, attachments = null }) {
  const body = String(message || '').trim();
  const attach = Array.isArray(attachments) && attachments.length ? attachments : null;
  if (!body && !attach) return { ok: false, reason: 'invalid_message' };

  const detail = await getTicketForAdmin(ticketNumber);
  if (!detail.ok) return detail;

  const agent = await resolveAgentIdentity(adminId, adminEmail);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_admin_id, message, attachments)
       VALUES ($1, 'admin', $2, $3, $4::jsonb) RETURNING *`,
      [detail.ticket.id, adminId, body || '', attach ? JSON.stringify(attach) : null],
    );

    const updates = [
      `status = 'WAITING_FOR_USER'`,
      `updated_at = NOW()`,
      `assigned_admin_id = $2`,
    ];
    const updateParams = [detail.ticket.id, adminId];
    if (!detail.ticket.first_response_at) {
      updates.push(`first_response_at = NOW()`, `sla_status = 'healthy'`);
    }
    await client.query(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $1`, updateParams);
    await logTicketEvent(client, detail.ticket.id, 'admin_reply', 'admin', String(adminId), {
      agentName: agent.display_name,
    });
    await client.query('COMMIT');

    const msg = mapMessage({
      ...rows[0],
      sender_email: adminEmail,
      sender_name: agent.display_name,
      sender_avatar_url: agent.avatar_url,
      sender_job_title: agent.job_title,
    });
    return {
      ok: true,
      message: msg,
      ticket: {
        ...detail.ticket,
        status: 'WAITING_FOR_USER',
        assigned_admin_id: adminId,
        first_response_at: detail.ticket.first_response_at || new Date().toISOString(),
      },
      userId: detail.ticket.user_id,
      userEmail: detail.ticket.user_email,
      agentName: agent.display_name,
      agentAvatarUrl: agent.avatar_url,
      agentJobTitle: agent.job_title,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function assignSupportTicket({ ticketNumber, adminId, assigneeAdminId, adminEmail }) {
  const detail = await getTicketForAdmin(ticketNumber);
  if (!detail.ok) return detail;

  const assignee = Number(assigneeAdminId);
  if (!Number.isFinite(assignee) || assignee <= 0) {
    return { ok: false, reason: 'assignee_required' };
  }
  const pool = getPool();
  let assigneeEmail = null;
  if (assignee) {
    const assigneeRes = await pool.query(`SELECT email FROM admins WHERE id = $1 LIMIT 1`, [assignee]);
    assigneeEmail = assigneeRes.rows[0]?.email || null;
  }
  await pool.query(
    `UPDATE support_tickets SET assigned_admin_id = $2, updated_at = NOW() WHERE id = $1`,
    [detail.ticket.id, assignee],
  );
  await logTicketEvent(pool, detail.ticket.id, 'assigned', 'admin', String(adminId), {
    assigneeAdminId: assignee,
    assigneeEmail,
    adminEmail,
  });

  return {
    ok: true,
    ticket: { ...detail.ticket, assigned_admin_id: assignee },
    userId: detail.ticket.user_id,
    userEmail: detail.ticket.user_email,
  };
}

export async function updateSupportTicketStatus({ ticketNumber, status, adminId, adminEmail }) {
  const next = String(status || '').trim().toUpperCase();
  if (!isValidStatus(next)) return { ok: false, reason: 'invalid_status' };

  const detail = await getTicketForAdmin(ticketNumber);
  if (!detail.ok) return detail;

  const pool = getPool();
  const sets = ['status = $2', 'updated_at = NOW()'];
  const params = [detail.ticket.id, next];

  if (next === 'RESOLVED') {
    sets.push('resolved_at = COALESCE(resolved_at, NOW())');
  }
  if (next === 'CLOSED') {
    sets.push('closed_at = COALESCE(closed_at, NOW())');
    sets.push("closed_by = COALESCE(closed_by, 'admin')");
  }

  await pool.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $1`, params);
  await logTicketEvent(pool, detail.ticket.id, 'status_change', 'admin', String(adminId), {
    status: next,
    adminEmail,
  });

  const { rows: fresh } = await pool.query(
    `SELECT t.*, u.email AS user_email, a.email AS assigned_admin_email
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     WHERE t.id = $1 LIMIT 1`,
    [detail.ticket.id],
  );

  return {
    ok: true,
    ticket: withSla(fresh[0] || { ...detail.ticket, status: next }),
    userId: detail.ticket.user_id,
    userEmail: detail.ticket.user_email,
  };
}

export async function closeTicketByUser(userId, ticketNumber, satisfactionRating) {
  const rating = Number(satisfactionRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, reason: 'invalid_rating' };
  }

  const ticketRes = await getTicketForUser(userId, ticketNumber);
  if (!ticketRes.ok) return ticketRes;
  if (ticketRes.ticket.status === 'CLOSED') {
    return { ok: false, reason: 'already_closed' };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE support_tickets
       SET status = 'CLOSED', closed_at = NOW(), closed_by = 'user',
           satisfaction_rating = $2, updated_at = NOW()
       WHERE id = $1`,
      [ticketRes.ticket.id, rating],
    );
    await logTicketEvent(client, ticketRes.ticket.id, 'status_change', 'user', userId, {
      status: 'CLOSED',
      satisfaction_rating: rating,
    });
    await client.query('COMMIT');
    const fresh = await getTicketForUser(userId, ticketNumber);
    return { ok: true, ticket: fresh.ticket };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function addInternalNote({ ticketNumber, adminId, adminEmail, note }) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, reason: 'invalid_note' };
  const detail = await getTicketForAdmin(ticketNumber);
  if (!detail.ok) return detail;

  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO support_ticket_notes (ticket_id, admin_id, admin_email, note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [detail.ticket.id, adminId, adminEmail, text],
  );
  await logTicketEvent(pool, detail.ticket.id, 'internal_note', 'admin', String(adminId), {});
  return { ok: true, note: rows[0] };
}

async function refreshSlaStatuses(pool) {
  await pool.query(
    `UPDATE support_tickets SET sla_status = CASE
      WHEN status IN ('RESOLVED','CLOSED') OR first_response_at IS NOT NULL THEN 'healthy'
      WHEN sla_due_at IS NULL THEN 'healthy'
      WHEN sla_due_at <= NOW() THEN 'breached'
      WHEN sla_due_at <= NOW() + INTERVAL '2 hours' THEN 'at_risk'
      ELSE 'healthy'
    END
    WHERE status NOT IN ('RESOLVED','CLOSED') AND first_response_at IS NULL`,
  );
}

export async function getSupportAnalytics() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  await ensureOperationsV3Schema();
  const pool = getPool();
  await refreshSlaStatuses(pool);

  const [summary, dept, response, agents, breached] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_tickets,
        COUNT(*) FILTER (WHERE status = 'WAITING_FOR_USER')::int AS waiting_tickets,
        COUNT(*) FILTER (WHERE priority = 'URGENT' AND status NOT IN ('RESOLVED','CLOSED'))::int AS urgent_tickets,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS tickets_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS tickets_7d
       FROM support_tickets`,
    ),
    pool.query(
      `SELECT department, COUNT(*)::int AS count
       FROM support_tickets GROUP BY department ORDER BY count DESC LIMIT 8`,
    ),
    pool.query(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) FILTER (WHERE first_response_at IS NOT NULL) AS avg_first_response_sec,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_sec
       FROM support_tickets`,
    ),
    pool.query(
      `SELECT a.email AS agent_email,
        COUNT(*) FILTER (WHERE t.status NOT IN ('RESOLVED','CLOSED'))::int AS open_assigned,
        COUNT(*)::int AS total_assigned
       FROM support_tickets t
       JOIN admins a ON a.id = t.assigned_admin_id
       WHERE t.assigned_admin_id IS NOT NULL
       GROUP BY a.email ORDER BY open_assigned DESC LIMIT 8`,
    ),
    pool.query(
      `SELECT t.ticket_number, t.subject, t.department, t.priority, t.sla_due_at, u.email AS user_email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE t.sla_status = 'breached' AND t.status NOT IN ('RESOLVED','CLOSED')
       ORDER BY t.sla_due_at ASC LIMIT 10`,
    ),
  ]);

  const avgFirst = response.rows[0]?.avg_first_response_sec;
  const avgRes = response.rows[0]?.avg_resolution_sec;

  return {
    ok: true,
    analytics: {
      openTickets: summary.rows[0]?.open_tickets ?? 0,
      waitingTickets: summary.rows[0]?.waiting_tickets ?? 0,
      urgentTickets: summary.rows[0]?.urgent_tickets ?? 0,
      breachedCount: breached.rows.length,
      tickets24h: summary.rows[0]?.tickets_24h ?? 0,
      tickets7d: summary.rows[0]?.tickets_7d ?? 0,
      avgFirstResponseMs: avgFirst != null ? Math.round(Number(avgFirst) * 1000) : null,
      avgResolutionMs: avgRes != null ? Math.round(Number(avgRes) * 1000) : null,
      departmentDistribution: dept.rows,
      agentPerformance: agents.rows,
      breachedTickets: breached.rows,
    },
  };
}

export async function getUserProfileByUserId(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT u.email, up.first_name
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1::uuid LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}
