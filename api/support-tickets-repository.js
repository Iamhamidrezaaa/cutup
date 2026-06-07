import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureSupportTicketsSchema } from './support-tickets-bootstrap.js';
import { isValidDepartment, isValidPriority, isValidStatus } from './support-constants.js';

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
    first_response_at: row.first_response_at || null,
    resolved_at: row.resolved_at || null,
    last_activity_at: row.last_activity_at || row.updated_at,
    message_count: row.message_count != null ? Number(row.message_count) : undefined,
  };
}

function mapMessage(row) {
  return {
    id: Number(row.id),
    ticket_id: Number(row.ticket_id),
    sender_type: row.sender_type,
    sender_user_id: row.sender_user_id ? String(row.sender_user_id) : null,
    sender_admin_id: row.sender_admin_id != null ? Number(row.sender_admin_id) : null,
    sender_name: row.sender_name || null,
    sender_email: row.sender_email || null,
    message: row.message,
    attachments: row.attachments || null,
    created_at: row.created_at,
  };
}

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
  metadata = {},
}) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();

  const dept = String(department || '').trim().toUpperCase();
  const pri = String(priority || 'NORMAL').trim().toUpperCase();
  const subj = String(subject || '').trim();
  const body = String(message || '').trim();

  if (!isValidDepartment(dept)) return { ok: false, reason: 'invalid_department' };
  if (!isValidPriority(pri)) return { ok: false, reason: 'invalid_priority' };
  if (!subj || subj.length < 3) return { ok: false, reason: 'invalid_subject' };
  if (!body || body.length < 10) return { ok: false, reason: 'invalid_message' };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ticketNumber = await nextTicketNumber(client);
    const { rows } = await client.query(
      `INSERT INTO support_tickets
        (ticket_number, user_id, department, priority, status, subject, message, metadata)
       VALUES ($1, $2::uuid, $3, $4, 'OPEN', $5, $6, $7::jsonb)
       RETURNING *`,
      [ticketNumber, userId, dept, pri, subj, body, JSON.stringify(metadata)],
    );
    const ticket = rows[0];
    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_user_id, message)
       VALUES ($1, 'user', $2::uuid, $3)`,
      [ticket.id, userId, body],
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
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS'))::int AS open_count,
      COUNT(*) FILTER (WHERE status = 'WAITING_FOR_USER')::int AS waiting_count,
      COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_count
     FROM support_tickets WHERE user_id = $1::uuid`,
    [userId],
  );
  return { ok: true, stats: rows[0] };
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
    tickets: rows.map(mapTicket),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit) || 1),
  };
}

export async function getTicketForUser(userId, ticketNumber) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, a.email AS assigned_admin_email
     FROM support_tickets t
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     WHERE t.ticket_number = $1 AND t.user_id = $2::uuid
     LIMIT 1`,
    [String(ticketNumber).trim(), userId],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  const messages = await pool.query(
    `SELECT m.*,
      CASE WHEN m.sender_type = 'admin' THEN a.email ELSE u.email END AS sender_email,
      CASE WHEN m.sender_type = 'admin' THEN a.email ELSE COALESCE(up.first_name, u.email) END AS sender_name
     FROM support_ticket_messages m
     LEFT JOIN users u ON u.id = m.sender_user_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN admins a ON a.id = m.sender_admin_id
     WHERE m.ticket_id = $1
     ORDER BY m.created_at ASC`,
    [rows[0].id],
  );
  return { ok: true, ticket: mapTicket(rows[0]), messages: messages.rows.map(mapMessage) };
}

export async function addUserReply(userId, ticketNumber, message) {
  const body = String(message || '').trim();
  if (!body || body.length < 1) return { ok: false, reason: 'invalid_message' };

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
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_user_id, message)
       VALUES ($1, 'user', $2::uuid, $3)
       RETURNING *`,
      [ticketRes.ticket.id, userId, body],
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
    `SELECT t.*, u.email AS user_email, a.email AS assigned_admin_email,
      (SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS last_activity_at
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     ${whereSql}
     ORDER BY COALESCE((SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id = t.id), t.updated_at) DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams,
  );

  return {
    ok: true,
    tickets: rows.map(mapTicket),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit) || 1),
  };
}

export async function getTicketForAdmin(ticketNumber) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, u.email AS user_email, a.email AS assigned_admin_email
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN admins a ON a.id = t.assigned_admin_id
     WHERE t.ticket_number = $1 LIMIT 1`,
    [String(ticketNumber).trim()],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };

  const [messages, notes, events] = await Promise.all([
    pool.query(
      `SELECT m.*,
        CASE WHEN m.sender_type = 'admin' THEN a.email ELSE u.email END AS sender_email,
        CASE WHEN m.sender_type = 'admin' THEN a.email ELSE COALESCE(up.first_name, u.email) END AS sender_name
       FROM support_ticket_messages m
       LEFT JOIN users u ON u.id = m.sender_user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN admins a ON a.id = m.sender_admin_id
       WHERE m.ticket_id = $1 ORDER BY m.created_at ASC`,
      [rows[0].id],
    ),
    pool.query(
      `SELECT n.* FROM support_ticket_notes n WHERE n.ticket_id = $1 ORDER BY n.created_at DESC`,
      [rows[0].id],
    ),
    pool.query(
      `SELECT e.* FROM support_ticket_events e WHERE e.ticket_id = $1 ORDER BY e.created_at ASC`,
      [rows[0].id],
    ),
  ]);

  return {
    ok: true,
    ticket: mapTicket(rows[0]),
    messages: messages.rows.map(mapMessage),
    notes: notes.rows,
    events: events.rows,
  };
}

export async function addAdminReply({ ticketNumber, adminId, adminEmail, message }) {
  const body = String(message || '').trim();
  if (!body) return { ok: false, reason: 'invalid_message' };

  const detail = await getTicketForAdmin(ticketNumber);
  if (!detail.ok) return detail;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, sender_type, sender_admin_id, message)
       VALUES ($1, 'admin', $2, $3) RETURNING *`,
      [detail.ticket.id, adminId, body],
    );

    const updates = [`status = 'WAITING_FOR_USER'`, `updated_at = NOW()`];
    if (!detail.ticket.first_response_at) {
      updates.push(`first_response_at = NOW()`);
    }
    await client.query(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $1`, [detail.ticket.id]);
    await logTicketEvent(client, detail.ticket.id, 'admin_reply', 'admin', String(adminId), { adminEmail });
    await client.query('COMMIT');

    const msg = mapMessage({ ...rows[0], sender_email: adminEmail, sender_name: adminEmail });
    return {
      ok: true,
      message: msg,
      ticket: { ...detail.ticket, status: 'WAITING_FOR_USER', first_response_at: detail.ticket.first_response_at || new Date().toISOString() },
      userId: detail.ticket.user_id,
      userEmail: detail.ticket.user_email,
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

  const assignee = assigneeAdminId == null || assigneeAdminId === '' ? null : Number(assigneeAdminId);
  const pool = getPool();
  await pool.query(
    `UPDATE support_tickets SET assigned_admin_id = $2, updated_at = NOW() WHERE id = $1`,
    [detail.ticket.id, assignee],
  );
  await logTicketEvent(pool, detail.ticket.id, 'assigned', 'admin', String(adminId), {
    assigneeAdminId: assignee,
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
  }

  await pool.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $1`, params);
  await logTicketEvent(pool, detail.ticket.id, 'status_change', 'admin', String(adminId), {
    status: next,
    adminEmail,
  });

  return {
    ok: true,
    ticket: { ...detail.ticket, status: next },
    userId: detail.ticket.user_id,
    userEmail: detail.ticket.user_email,
  };
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

export async function getSupportAnalytics() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureSupportTicketsSchema();
  const pool = getPool();

  const [summary, dept, response] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS','WAITING_FOR_USER'))::int AS open_tickets,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS tickets_24h,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS tickets_7d
       FROM support_tickets`,
    ),
    pool.query(
      `SELECT department, COUNT(*)::int AS count
       FROM support_tickets GROUP BY department ORDER BY count DESC`,
    ),
    pool.query(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))) FILTER (WHERE first_response_at IS NOT NULL) AS avg_first_response_sec,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_sec
       FROM support_tickets`,
    ),
  ]);

  const avgFirst = response.rows[0]?.avg_first_response_sec;
  const avgRes = response.rows[0]?.avg_resolution_sec;

  return {
    ok: true,
    analytics: {
      openTickets: summary.rows[0]?.open_tickets ?? 0,
      tickets24h: summary.rows[0]?.tickets_24h ?? 0,
      tickets7d: summary.rows[0]?.tickets_7d ?? 0,
      avgFirstResponseMs: avgFirst != null ? Math.round(Number(avgFirst) * 1000) : null,
      avgResolutionMs: avgRes != null ? Math.round(Number(avgRes) * 1000) : null,
      departmentDistribution: dept.rows,
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
