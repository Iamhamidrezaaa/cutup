import { getPool, isBillingDbConfigured } from './db/pool.js';
import { ensureNotificationsSchema } from './notifications-bootstrap.js';

function mapRow(row) {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    type: row.type,
    title: row.title,
    message: row.message,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
    read_at: row.read_at || null,
  };
}

export async function insertNotification({ userId, type, title, message, metadata = {} }) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureNotificationsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, metadata)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [userId, type, title, message, JSON.stringify(metadata)],
  );
  return { ok: true, notification: mapRow(rows[0]) };
}

export async function listNotificationsDb({ userId, page = 1, limit = 20, filter = 'all' }) {
  if (!isBillingDbConfigured()) {
    return { ok: false, reason: 'db_not_configured', notifications: [], total: 0, page, limit, totalPages: 0 };
  }
  await ensureNotificationsSchema();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;

  const where = ['user_id = $1::uuid'];
  const params = [userId];
  if (filter === 'unread') where.push('is_read = FALSE');
  if (filter === 'read') where.push('is_read = TRUE');
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const pool = getPool();
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM notifications ${whereSql}`,
    params,
  );
  const total = countRes.rows[0]?.total ?? 0;
  const listRes = await pool.query(
    `SELECT * FROM notifications ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [...params, safeLimit, offset],
  );

  return {
    ok: true,
    notifications: listRes.rows.map(mapRow),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit) || 1),
  };
}

export async function countUnreadNotificationsDb(userId) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured', count: 0 };
  await ensureNotificationsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1::uuid AND is_read = FALSE`,
    [userId],
  );
  return { ok: true, count: rows[0]?.count ?? 0 };
}

export async function markNotificationReadDb(userId, notificationId) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureNotificationsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2::uuid
     RETURNING *`,
    [notificationId, userId],
  );
  if (!rows[0]) return { ok: false, reason: 'not_found' };
  return { ok: true, notification: mapRow(rows[0]) };
}

export async function markAllNotificationsReadDb(userId) {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureNotificationsSchema();
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
     WHERE user_id = $1::uuid AND is_read = FALSE`,
    [userId],
  );
  return { ok: true, updated: rowCount ?? 0 };
}

export async function getNotificationStatsDb() {
  if (!isBillingDbConfigured()) return { ok: false, reason: 'db_not_configured' };
  await ensureNotificationsSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_read = FALSE)::int AS unread,
      COUNT(*) FILTER (WHERE is_read = TRUE)::int AS read_count,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h
     FROM notifications`,
  );
  const recent = await pool.query(
    `SELECT n.id, n.type, n.title, n.is_read, n.created_at, u.email AS user_email
     FROM notifications n
     JOIN users u ON u.id = n.user_id
     ORDER BY n.created_at DESC
     LIMIT 20`,
  );
  return {
    ok: true,
    stats: rows[0] || { total: 0, unread: 0, read_count: 0, last_24h: 0 },
    recent: recent.rows,
  };
}
