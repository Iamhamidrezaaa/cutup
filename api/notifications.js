/**
 * GET /api/notifications?page=&limit=&filter=all|unread|read
 */
import { resolveNotificationUserId, loadNotificationService } from './notifications-auth.js';

export default async function handler(req, res) {
  const auth = await resolveNotificationUserId(req, res);
  if (!auth) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const service = await loadNotificationService();
  if (!service?.getNotifications) {
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  }

  try {
    const result = await service.getNotifications({
      userId: auth.userId,
      page: req.query?.page,
      limit: req.query?.limit,
      filter: req.query?.filter || 'all',
    });
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason || 'list_failed' });
    }
    return res.json({
      ok: true,
      notifications: result.notifications,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch (err) {
    console.error('[notifications]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
