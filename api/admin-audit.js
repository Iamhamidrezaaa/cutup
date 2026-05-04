import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import {
  listAuditEventsDb,
  countAuditEventsDb,
  getAuditSummaryDb,
  getUserAuditTimelineDb,
  isUuid,
  getAuditEventTimeseriesDb,
  getAuditErrorTimeseriesDb,
  getAuditDauTimeseriesDb,
  computeDynamicFunnelDb,
  listAuditAlertsDb,
  evaluateAuditAlertsDb
} from './audit-repository.js';
import { ensureAdminsSchema } from './admins-repository.js';

function normalizeAdminRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** Same ops tier as GET /api/admin?action=users — admin + super_admin may read audit; editor may not. */
async function requireAuditReader(req, res) {
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
  const role = normalizeAdminRole(auth.role);
  if (!['admin', 'super_admin'].includes(role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return { ...auth, role };
}

export async function adminAuditSummaryHandler(req, res) {
  const auth = await requireAuditReader(req, res);
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

function listFiltersFromQuery(req) {
  return {
    userId: req.query.user_id || req.query.userId || null,
    eventName: req.query.event_name || req.query.eventName || null,
    eventType: req.query.event_type || req.query.eventType || null,
    dateFrom: req.query.date_from || req.query.dateFrom || null,
    dateTo: req.query.date_to || req.query.dateTo || null,
    plan: req.query.plan || null,
    countryCode: req.query.country || req.query.country_code || req.query.countryCode || null,
    activityMin: req.query.activity_min || req.query.activityMin || null
  };
}

export async function adminAuditListHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const filters = { ...listFiltersFromQuery(req), limit, offset };

    if (filters.userId && !isUuid(String(filters.userId))) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }

    const [events, total] = await Promise.all([listAuditEventsDb(filters), countAuditEventsDb(filters)]);

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
  const auth = await requireAuditReader(req, res);
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

/** Aggregated series for dashboard charts (single round-trip). */
export async function adminAuditChartsHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const dateFrom = req.query.date_from || req.query.dateFrom || null;
    const dateTo = req.query.date_to || req.query.dateTo || null;
    const bucket = req.query.bucket === 'day' ? 'day' : 'hour';
    const [events, errors, dau] = await Promise.all([
      getAuditEventTimeseriesDb({ dateFrom, dateTo, bucket }),
      getAuditErrorTimeseriesDb({ dateFrom, dateTo, bucket }),
      getAuditDauTimeseriesDb({ dateFrom, dateTo })
    ]);
    return res.json({ ok: true, bucket, events, errors, dau });
  } catch (e) {
    console.error('[admin-audit charts]', e);
    return res.status(500).json({ error: 'charts_failed', message: e?.message });
  }
}

export async function adminAuditFunnelHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const steps = req.query.steps || req.query.step || '';
    const dateFrom = req.query.date_from || req.query.dateFrom || null;
    const dateTo = req.query.date_to || req.query.dateTo || null;
    const result = await computeDynamicFunnelDb(steps, dateFrom, dateTo);
    return res.json({ ok: true, funnel: result });
  } catch (e) {
    console.error('[admin-audit funnel]', e);
    return res.status(500).json({ error: 'funnel_failed', message: e?.message });
  }
}

export async function adminAuditAlertsHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 40));
    const offset = (page - 1) * limit;
    const alerts = await listAuditAlertsDb({ limit, offset });
    return res.json({ ok: true, alerts, page, limit });
  } catch (e) {
    console.error('[admin-audit alerts]', e);
    return res.status(500).json({ error: 'alerts_failed', message: e?.message });
  }
}

export async function adminAuditEvaluateAlertsHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const out = await evaluateAuditAlertsDb();
    return res.json({ ok: true, ...out });
  } catch (e) {
    console.error('[admin-audit evaluate]', e);
    return res.status(500).json({ error: 'evaluate_failed', message: e?.message });
  }
}
