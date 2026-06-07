/**
 * GET /api/notifications/stream — SSE real-time notification updates
 * Provider abstraction: polls DB; future WebSocket can replace transport.
 */
import { setCORSHeaders } from './cors.js';
import { resolveNotificationUserId, loadNotificationService } from './notifications-auth.js';

const POLL_MS = 5000;
const HEARTBEAT_MS = 25000;

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const auth = await resolveNotificationUserId(req, res);
  if (!auth) return;
  const userId = auth.userId;
  res.flushHeaders?.();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  let lastCount = -1;
  let lastId = 0;

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const tick = async () => {
    if (closed) return;
    try {
      const svc = await loadNotificationService();
      const countRes = await svc.getUnreadCount(userId);
      const count = countRes?.count ?? 0;
      if (count !== lastCount) {
        lastCount = count;
        send('unread', { count });
      }
      const listRes = await svc.getNotifications({ userId, page: 1, limit: 5, filter: 'all' });
      const latest = listRes?.notifications?.[0];
      if (latest && Number(latest.id) > lastId) {
        lastId = Number(latest.id);
        send('notification', { notification: latest });
      }
    } catch (err) {
      console.warn('[notifications-stream]', err?.message || err);
    }
  };

  send('connected', { ok: true });
  await tick();

  const pollTimer = setInterval(tick, POLL_MS);
  const heartbeatTimer = setInterval(() => send('ping', { t: Date.now() }), HEARTBEAT_MS);

  req.on('close', () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  });
}
