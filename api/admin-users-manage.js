import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import { adminPatchCustomerUser, adminDeleteCustomerUser } from './billing-repository.js';
import { ensureAdminsSchema } from './admins-repository.js';
import { recordServerAuditEvent } from './audit-internal.js';

function parseUserIdFromRequest(req) {
  if (req.params && req.params.id) return String(req.params.id).trim();
  const raw = String(req.url || '').split('?')[0];
  const m = raw.match(/\/api\/admin\/users\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]).trim() : '';
}

async function requireOps(req, res) {
  if (!isBillingDbConfigured()) {
    res.status(503).json({ error: 'Service is not configured yet.' });
    return null;
  }
  await ensureAdminsSchema();
  const auth = await resolveAdminAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  if (!['admin', 'super_admin'].includes(auth.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return auth;
}

export default async function adminUsersManageHandler(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const id = parseUserIdFromRequest(req);
  if (!id) return res.status(400).json({ error: 'User id required' });

  const auth = await requireOps(req, res);
  if (!auth) return;

  try {
    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const name = body.name !== undefined ? body.name : body.displayName;
      const plan = body.plan !== undefined ? body.plan : undefined;
      const status = body.status !== undefined ? body.status : undefined;
      const result = await adminPatchCustomerUser(id, {
        name,
        plan,
        status,
        email: body.email,
        first_name: body.first_name,
        last_name: body.last_name,
        phone: body.phone,
        country: body.country,
        address: body.address,
        postal_code: body.postal_code,
        extend_days: body.extend_days,
        extend_months: body.extend_months
      });
      if (!result.ok) {
        const code =
          result.error === 'not_found'
            ? 404
            : result.error === 'cannot_edit_admin'
              ? 403
              : result.error === 'invalid_id' || result.error === 'invalid_plan' || result.error === 'invalid_status'
                ? 400
                : 400;
        return res.status(code).json({ error: result.error || 'update_failed' });
      }
      void recordServerAuditEvent({
        eventType: 'security',
        eventName: 'admin_edit_user',
        metadata: { targetUserId: id, adminId: auth.adminId, adminEmail: auth.email },
        req
      });
      return res.json({ success: true, user: result.user ?? null });
    }

    if (req.method === 'DELETE') {
      const result = await adminDeleteCustomerUser(id);
      if (!result.ok) {
        const code =
          result.error === 'not_found'
            ? 404
            : result.error === 'cannot_delete_admin'
              ? 403
              : 400;
        return res.status(code).json({ error: result.error || 'delete_failed' });
      }
      void recordServerAuditEvent({
        eventType: 'security',
        eventName: 'admin_delete_user',
        metadata: { targetUserId: id, adminId: auth.adminId, adminEmail: auth.email },
        req
      });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[admin-users-manage]', e);
    return res.status(500).json({ error: 'Request failed', message: e?.message || 'unknown' });
  }
}
