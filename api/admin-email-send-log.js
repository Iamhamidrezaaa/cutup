/**
 * Admin email delivery log API.
 *
 * GET /api/admin/email-send-log?page=&limit=&recipient=&template=&status=&provider=&q=
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import { listEmailSendLogs } from './email-send-log-repository.js';

function normalizeAdminRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

async function requireEmailLogReader(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return null;
  }
  if (!isBillingDbConfigured()) {
    res.status(503).json({ ok: false, error: 'db_not_configured' });
    return null;
  }
  const auth = await resolveAdminAuth(req);
  if (!auth) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return null;
  }
  const role = normalizeAdminRole(auth.role);
  if (!['admin', 'super_admin'].includes(role)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return null;
  }
  return auth;
}

export default async function handler(req, res) {
  const auth = await requireEmailLogReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const result = await listEmailSendLogs({
      page: req.query.page,
      limit: req.query.limit,
      recipient: req.query.recipient,
      template: req.query.template,
      status: req.query.status,
      provider: req.query.provider,
      q: req.query.q,
    });

    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.reason || 'list_failed' });
    }

    return res.json({
      ok: true,
      logs: result.logs,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch (err) {
    console.error('[admin-email-send-log]', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: err?.message });
  }
}
