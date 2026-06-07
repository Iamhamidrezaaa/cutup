/**
 * Admin notification center stats.
 * GET /api/admin/notifications
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import { getNotificationStatsDb } from './notifications-repository.js';

function normalizeAdminRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'db_not_configured' });
  }

  const auth = await resolveAdminAuth(req);
  if (!auth) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const role = normalizeAdminRole(auth.role);
  if (!['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const result = await getNotificationStatsDb();
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason || 'stats_failed' });
    }
    return res.json({
      ok: true,
      total: result.stats.total,
      unread: result.stats.unread,
      read: result.stats.read_count,
      last24h: result.stats.last_24h,
      recent: result.recent,
    });
  } catch (err) {
    console.error('[admin-notifications]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
