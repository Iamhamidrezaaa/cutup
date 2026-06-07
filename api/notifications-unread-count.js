/**
 * GET /api/notifications/unread-count
 */
import { resolveNotificationUserId, loadNotificationService } from './notifications-auth.js';

export default async function handler(req, res) {
  const auth = await resolveNotificationUserId(req, res);
  if (!auth) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const service = await loadNotificationService();
  if (!service?.getUnreadCount) {
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  }

  try {
    const result = await service.getUnreadCount(auth.userId);
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason || 'count_failed' });
    }
    return res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error('[notifications-unread-count]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
