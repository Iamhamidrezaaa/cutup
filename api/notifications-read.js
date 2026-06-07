/**
 * POST /api/notifications/:id/read
 * POST /api/notifications/read-all
 */
import { resolveNotificationUserId, loadNotificationService } from './notifications-auth.js';

function parseJsonBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body && typeof body === 'object' ? body : {};
}

function parseNotificationId(req) {
  const fromBody = parseJsonBody(req)?.id ?? parseJsonBody(req)?.notificationId;
  if (fromBody != null && String(fromBody).trim()) return Number(fromBody);
  const url = String(req.url || '');
  const match = url.match(/\/notifications\/(\d+)\/read/);
  if (match) return Number(match[1]);
  const q = req.query?.id;
  if (q != null) return Number(q);
  return NaN;
}

function isReadAllRequest(req) {
  const url = String(req.url || '');
  if (url.includes('/read-all')) return true;
  const body = parseJsonBody(req);
  return body.all === true || req.query?.all === 'true' || req.query?.action === 'read-all';
}

export default async function handler(req, res) {
  const auth = await resolveNotificationUserId(req, res);
  if (!auth) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const service = await loadNotificationService();
  if (!service?.markAsRead || !service?.markAllAsRead) {
    return res.status(503).json({ ok: false, error: 'service_unavailable' });
  }

  try {
    if (isReadAllRequest(req)) {
      const result = await service.markAllAsRead(auth.userId);
      if (!result.ok) {
        return res.status(503).json({ ok: false, error: result.reason || 'read_all_failed' });
      }
      return res.json({ ok: true, updated: result.updated });
    }

    const id = parseNotificationId(req);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_notification_id' });
    }

    const result = await service.markAsRead(auth.userId, id);
    if (!result.ok) {
      const code = result.reason === 'not_found' ? 404 : 503;
      return res.status(code).json({ ok: false, error: result.reason || 'read_failed' });
    }
    return res.json({ ok: true, notification: result.notification });
  } catch (err) {
    console.error('[notifications-read]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
