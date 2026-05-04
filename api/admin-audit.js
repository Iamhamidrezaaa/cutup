import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import {
  listAuditEventsDb,
  countAuditEventsDb,
  getAuditSummaryDb,
  getUserAuditTimelineDb,
  isUuid
} from './audit-repository.js';
import { ensureAdminsSchema } from './admins-repository.js';

async function requireSuperAdmin(req, res) {
  setAdminPanelCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return null;
  }
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
  if (auth.role !== 'super_admin') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return auth;
}

export async function adminAuditSummaryHandler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const summary = await getAuditSummaryDb({
      dateFrom: req.query.date_from || req.query.dateFrom,
      dateTo: req.query.date_to || req.query.dateTo
    });
    return res.json({ ok: true, summary });
  } catch (e) {
    console.error('[admin-audit summary]', e);
    return res.status(500).json({ error: 'summary_failed', message: e?.message });
  }
}

export async function adminAuditListHandler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const filters = {
      userId: req.query.user_id || req.query.userId || null,
      eventName: req.query.event_name || req.query.eventName || null,
      eventType: req.query.event_type || req.query.eventType || null,
      dateFrom: req.query.date_from || req.query.dateFrom || null,
      dateTo: req.query.date_to || req.query.dateTo || null,
      limit,
      offset
    };

    if (filters.userId && !isUuid(String(filters.userId))) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }

    const [events, total] = await Promise.all([
      listAuditEventsDb(filters),
      countAuditEventsDb(filters)
    ]);

    return res.json({
      ok: true,
      events,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1
    });
  } catch (e) {
    console.error('[admin-audit list]', e);
    return res.status(500).json({ error: 'list_failed', message: e?.message });
  }
}

export async function adminAuditUserTimelineHandler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.params?.userId || req.params?.id;
  if (!userId || !isUuid(String(userId))) {
    return res.status(400).json({ error: 'invalid_user_id' });
  }

  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const timeline = await getUserAuditTimelineDb(userId, limit);
    return res.json({ ok: true, userId: String(userId), timeline, count: timeline.length });
  } catch (e) {
    console.error('[admin-audit timeline]', e);
    return res.status(500).json({ error: 'timeline_failed', message: e?.message });
  }
}
