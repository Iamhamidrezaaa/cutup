import { isBillingDbConfigured } from './db/pool.js';
import {
  insertAuditEventRow,
  sanitizeAuditMetadata,
  getRequestAuditContext
} from './audit-repository.js';

/**
 * Server-side audit (admin actions, cron, webhooks). Fire-and-forget friendly.
 */
export async function recordServerAuditEvent({
  eventType = 'system',
  eventName,
  metadata = {},
  req = null,
  userId = null,
  sessionId = null
}) {
  if (!isBillingDbConfigured()) return;
  try {
    const ctx = req ? getRequestAuditContext(req) : { ip: null, userAgent: null, path: null, referrer: null };
    await insertAuditEventRow({
      userId,
      sessionId,
      eventType: String(eventType || 'system').slice(0, 64),
      eventName: String(eventName || 'unknown').slice(0, 128),
      metadata: sanitizeAuditMetadata(metadata),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      path: ctx.path,
      referrer: ctx.referrer
    });
  } catch (e) {
    console.warn('[audit-internal]', e?.message || e);
  }
}
