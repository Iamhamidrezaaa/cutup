import { WebSocketServer } from 'ws';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { ensureAdminsSchema } from './admins-repository.js';
import { subscribeAuditEvents } from './audit-broadcast.js';

function normalizeAdminRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** WebSocket live feed; path `/api/admin/audit/live`. Cookie auth must match admin audit readers. */
export function attachAuditLiveWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    let pathname = '';
    try {
      pathname = new URL(request.url || '/', `http://${host}`).pathname;
    } catch {
      pathname = '';
    }
    if (pathname !== '/api/admin/audit/live') return;

    ensureAdminsSchema()
      .then(() => resolveAdminAuth(request))
      .then((auth) => {
        const role = normalizeAdminRole(auth?.role);
        if (!auth || !['admin', 'super_admin'].includes(role)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      })
      .catch(() => {
        try {
          socket.destroy();
        } catch (_e) {
          /* noop */
        }
      });
  });

  wss.on('connection', (ws) => {
    const onAudit = (payload) => {
      if (ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({ type: 'audit', payload }));
      } catch (_e) {
        /* noop */
      }
    };
    const unsub = subscribeAuditEvents(onAudit);
    ws.on('close', unsub);
    ws.on('error', unsub);
  });
}
