/**
 * Admin Support Center API
 *
 * GET  /api/admin/support?action=analytics|list|detail&ticket=...
 * POST /api/admin/support  { action: reply|assign|status|note, ... }
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import { getPool } from './db/pool.js';
import {
  listAdminTickets,
  getTicketForAdmin,
  addAdminReply,
  assignSupportTicket,
  updateSupportTicketStatus,
  addInternalNote,
  getSupportAnalytics,
  getUserProfileByUserId,
} from './support-tickets-repository.js';
import {
  notifyTicketReplied,
  notifyTicketAssigned,
  notifyTicketResolved,
  notifyTicketClosed,
} from './support-notify.js';

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length) {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : {};
}

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

async function requireSupportAdmin(req, res) {
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
  const role = normalizeRole(auth.role);
  if (!['admin', 'super_admin'].includes(role)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return null;
  }
  return { ...auth, adminId: Number(auth.adminId) };
}

async function listAdminsForAssign() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, email, role FROM admins WHERE status = 'active' ORDER BY email ASC`,
  );
  return rows;
}

export default async function handler(req, res) {
  const admin = await requireSupportAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const action = String(req.query?.action || 'list').trim();

      if (action === 'analytics') {
        const result = await getSupportAnalytics();
        return res.json({ ok: true, analytics: result.analytics });
      }

      if (action === 'admins') {
        const admins = await listAdminsForAssign();
        return res.json({ ok: true, admins });
      }

      const ticketNumber = String(req.query?.ticket || '').trim();
      if (ticketNumber || action === 'detail') {
        const detail = await getTicketForAdmin(ticketNumber);
        if (!detail.ok) return res.status(404).json({ ok: false, error: detail.reason });
        return res.json({
          ok: true,
          ticket: detail.ticket,
          messages: detail.messages,
          notes: detail.notes,
          events: detail.events,
        });
      }

      const list = await listAdminTickets({
        page: req.query?.page,
        limit: req.query?.limit,
        status: req.query?.status,
        department: req.query?.department,
        priority: req.query?.priority,
        assignedAdminId: req.query?.assigned,
        q: req.query?.q,
      });
      return res.json({ ok: true, ...list });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      const action = String(body?.action || '').trim();
      const ticketNumber = String(body?.ticketNumber || body?.ticket || '').trim();

      if (action === 'reply') {
        const result = await addAdminReply({
          ticketNumber,
          adminId: admin.adminId,
          adminEmail: admin.email,
          message: body?.message,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        const profile = await getUserProfileByUserId(result.userId);
        await notifyTicketReplied({
          ticket: result.ticket,
          userEmail: result.userEmail,
          firstName: profile?.first_name || 'there',
          agentName: admin.email,
          replyText: body?.message,
        });
        return res.json({ ok: true, message: result.message, ticket: result.ticket });
      }

      if (action === 'assign') {
        const result = await assignSupportTicket({
          ticketNumber,
          adminId: admin.adminId,
          assigneeAdminId: body?.assigneeAdminId ?? body?.assignedAdminId,
          adminEmail: admin.email,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        const profile = await getUserProfileByUserId(result.userId);
        await notifyTicketAssigned({
          ticket: result.ticket,
          userEmail: result.userEmail,
          firstName: profile?.first_name || 'there',
          agentName: admin.email,
        });
        return res.json({ ok: true, ticket: result.ticket });
      }

      if (action === 'status') {
        const result = await updateSupportTicketStatus({
          ticketNumber,
          status: body?.status,
          adminId: admin.adminId,
          adminEmail: admin.email,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        const profile = await getUserProfileByUserId(result.userId);
        const status = String(body?.status || '').toUpperCase();
        if (status === 'RESOLVED') {
          await notifyTicketResolved({
            ticket: result.ticket,
            userEmail: result.userEmail,
            firstName: profile?.first_name || 'there',
          });
        } else if (status === 'CLOSED') {
          await notifyTicketClosed({
            ticket: result.ticket,
            userEmail: result.userEmail,
            firstName: profile?.first_name || 'there',
          });
        }
        return res.json({ ok: true, ticket: result.ticket });
      }

      if (action === 'note') {
        const result = await addInternalNote({
          ticketNumber,
          adminId: admin.adminId,
          adminEmail: admin.email,
          note: body?.note,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        return res.json({ ok: true, note: result.note });
      }

      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-support-tickets]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
