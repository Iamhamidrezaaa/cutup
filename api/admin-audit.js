import { setAdminPanelCorsHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import {
  listAuditEventsDb,
  countAuditEventsDb,
  getAuditSummaryDb,
  buildEmptyAuditSummaryFromHttpQuery,
  getUserAuditTimelineDb,
  isUuid,
  getAuditEventTimeseriesDb,
  getAuditErrorTimeseriesDb,
  getAuditDauTimeseriesDb,
  computeDynamicFunnelDb,
  listAuditAlertsDb,
  evaluateAuditAlertsDb,
  seedTestAuditEventsDb
} from './audit-repository.js';
import {
  getAdminAuditLogDashboard,
  listAuditEventsEnriched,
  resolveUserIdFromJourneyQuery,
  getUserJourneyExplorer,
  listEventNotesDb,
  upsertEventNoteDb,
  listPinnedNotesDb
} from './admin-audit-log-repository.js';
import { ensureAdminsSchema } from './admins-repository.js';
import { ensureAuditEventNotesSchema } from './audit-event-notes-bootstrap.js';

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

  let summary;
  try {
    summary = await getAuditSummaryDb({
      dateFrom: req.query.date_from || req.query.dateFrom,
      dateTo: req.query.date_to || req.query.dateTo
    });
  } catch (e) {
    console.error('[audit summary error]', e);
    summary = buildEmptyAuditSummaryFromHttpQuery(req.query);
  }
  return res.json({ ok: true, summary });
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
    activityMin: req.query.activity_min || req.query.activityMin || null,
    email: req.query.email || null,
    ip: req.query.ip || null,
    sessionId: req.query.session_id || req.query.sessionId || null,
    severity: req.query.severity || null,
    category: req.query.category || null,
    adminOnly: req.query.admin_only || req.query.adminOnly || null,
    customerOnly: req.query.customer_only || req.query.customerOnly || null,
    paymentEvents: req.query.payment_events || req.query.paymentEvents || null,
    authEvents: req.query.auth_events || req.query.authEvents || null,
    aiEvents: req.query.ai_events || req.query.aiEvents || null,
    provider: req.query.provider || null,
    requestId: req.query.request_id || req.query.requestId || null
  };
}

export async function adminAuditDashboardHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await ensureAuditEventNotesSchema();
    const dashboard = await getAdminAuditLogDashboard({
      preset: req.query.preset || '24h',
      dateFrom: req.query.date_from || req.query.dateFrom,
      dateTo: req.query.date_to || req.query.dateTo
    });
    const pinned = await listPinnedNotesDb(20);
    return res.json({ ok: true, ...dashboard, incidentPins: pinned });
  } catch (e) {
    console.error('[admin-audit dashboard]', e);
    return res.status(500).json({ error: 'dashboard_failed' });
  }
}

export async function adminAuditJourneyHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const q = req.query.q || req.query.email || req.query.userId || req.query.sessionId;
    const resolved = await resolveUserIdFromJourneyQuery(q);
    if (resolved.error) return res.status(404).json({ error: resolved.error });
    const journey = await getUserJourneyExplorer(resolved.userId, Number(req.query.limit) || 300);
    return res.json({ ok: true, ...resolved, ...journey });
  } catch (e) {
    console.error('[admin-audit journey]', e);
    return res.status(500).json({ error: 'journey_failed' });
  }
}

export async function adminAuditNotesHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  await ensureAuditEventNotesSchema();
  const eventId = req.params?.eventId || req.query?.eventId;
  if (req.method === 'GET') {
    if (!eventId || !isUuid(String(eventId))) {
      return res.status(400).json({ error: 'invalid_event_id' });
    }
    const notes = await listEventNotesDb(eventId);
    return res.json({ ok: true, notes });
  }
  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const eid = body.eventId || eventId;
    if (!eid || !isUuid(String(eid))) return res.status(400).json({ error: 'invalid_event_id' });
    const row = await upsertEventNoteDb({
      eventId: eid,
      adminEmail: auth.email,
      note: body.note || '',
      resolved: Boolean(body.resolved),
      pinned: Boolean(body.pinned),
      sessionKey: body.sessionKey || null
    });
    return res.json({ ok: true, note: row });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

export async function adminAuditExportHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const page = 1;
    const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 2000));
    const filters = { ...listFiltersFromQuery(req), limit, offset: 0, page };
    const { events } = await listAuditEventsEnriched(filters);
    if (format === 'csv') {
      const header = 'id,createdAt,userEmail,eventName,eventType,severity,countryCode,ip,plan\n';
      const rows = events
        .map((e) =>
          [
            e.id,
            e.createdAt,
            e.userEmail || '',
            e.eventName,
            e.eventType,
            e.severity,
            e.countryCode || '',
            e.ip || '',
            e.plan || ''
          ]
            .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
      return res.send(header + rows);
    }
    return res.json({ ok: true, events, exportedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[admin-audit export]', e);
    return res.status(500).json({ error: 'export_failed' });
  }
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

    const result = await listAuditEventsEnriched({ ...filters, page, limit, offset });

    return res.json({
      ok: true,
      events: result.events,
      page,
      limit,
      total: result.total,
      totalPages: result.totalPages
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

export async function adminAuditSeedHandler(req, res) {
  const auth = await requireAuditReader(req, res);
  if (!auth) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const inserted = await seedTestAuditEventsDb();
    return res.json({ ok: true, inserted });
  } catch (e) {
    console.error('[admin-audit seed]', e);
    return res.status(500).json({ error: 'seed_failed', message: e?.message });
  }
}
