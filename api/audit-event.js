import { setCORSHeaders } from './cors.js';
import { sessions } from './auth.js';
import { resolveUserIdForAnalytics } from './billing-repository.js';
import { isBillingDbConfigured } from './db/pool.js';
import {
  insertAuditEventRow,
  sanitizeAuditMetadata,
  clampEventName,
  clampEventType,
  getRequestAuditContext
} from './audit-repository.js';

function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  return {};
}

export default async function auditEventHandler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  if (!isBillingDbConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const body = readBody(req);
  const eventName = clampEventName(body.event_name || body.name);
  if (!eventName) {
    return res.status(400).json({ ok: false, error: 'invalid_event_name' });
  }
  const eventType = clampEventType(body.event_type);

  const sessionHeader = req.headers['x-session-id'] || body.session_id || body.sessionId;
  const sessionId = sessionHeader != null ? String(sessionHeader).slice(0, 128) : null;

  let userId = null;
  if (sessionId) {
    const sess = sessions.get(sessionId);
    const email = sess?.user?.email;
    if (email) {
      try {
        userId = await resolveUserIdForAnalytics(String(email).toLowerCase());
      } catch {
        userId = null;
      }
    }
  }

  const meta = sanitizeAuditMetadata(body.metadata && typeof body.metadata === 'object' ? body.metadata : {});
  const ctx = getRequestAuditContext(req);
  const path = body.path != null ? String(body.path).slice(0, 2048) : ctx.path;
  const referrer =
    body.referrer != null
      ? String(body.referrer).slice(0, 2048)
      : ctx.referrer || (typeof body.referer === 'string' ? body.referer.slice(0, 2048) : null);

  try {
    const row = await insertAuditEventRow({
      userId,
      sessionId,
      eventType,
      eventName,
      metadata: meta,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      path,
      referrer
    });
    return res.status(201).json({ ok: true, id: row?.id || null, created_at: row?.created_at || null });
  } catch (e) {
    console.error('[audit-event]', e);
    return res.status(500).json({ ok: false, error: 'store_failed' });
  }
}
