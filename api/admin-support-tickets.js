/**
 * Admin Support Center API
 *
 * GET  /api/admin/support?action=analytics|list|detail&ticket=...
 * POST /api/admin/support  { action: reply|assign|status|note, ... }
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import { isBillingDbConfigured } from './db/pool.js';
import { adminHasPermission } from './rbac-repository.js';
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
  getAdminProfile,
  listAdminsWithProfiles,
  resolveAgentIdentity,
  upsertAdminProfile,
} from './admin-profiles-repository.js';
import {
  notifyTicketReplied,
  notifyTicketAssigned,
  notifyTicketResolved,
  notifyTicketClosed,
} from './support-notify.js';
import {
  getPipelineFeedbackAnalytics,
  listPipelineFeedbackForAdmin,
  resolvePipelineFeedback,
} from './pipeline-feedback-repository.js';

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
  const legacyOk = ['admin', 'super_admin'].includes(role);
  const hasSupport = legacyOk || (await adminHasPermission(auth.adminId, 'support.view'));
  if (!hasSupport) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return null;
  }
  return { ...auth, adminId: Number(auth.adminId) };
}

async function listAdminsForAssign() {
  return listAdminsWithProfiles();
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

      if (action === 'feedback_analytics') {
        const analytics = await getPipelineFeedbackAnalytics();
        return res.json({ ok: true, analytics });
      }

      if (action === 'feedback_list') {
        const resolvedParam = req.query?.resolved;
        let resolved = null;
        if (resolvedParam === 'true' || resolvedParam === '1') resolved = true;
        if (resolvedParam === 'false' || resolvedParam === '0') resolved = false;
        const list = await listPipelineFeedbackForAdmin({
          rating: String(req.query?.rating || 'down').trim() || 'down',
          resolved,
          limit: req.query?.limit
        });
        return res.json({ ok: true, ...list });
      }

      if (action === 'admins') {
        const admins = await listAdminsForAssign();
        return res.json({ ok: true, admins, currentAdminId: admin.adminId });
      }

      if (action === 'profile') {
        const agent = await resolveAgentIdentity(admin.adminId, admin.email);
        const profile = await getAdminProfile(admin.adminId);
        return res.json({
          ok: true,
          profile: {
            admin_user_id: admin.adminId,
            display_name: agent.display_name,
            avatar_url: agent.avatar_url,
            job_title: agent.job_title,
            is_visible: profile?.is_visible !== false,
          },
        });
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
          customer: detail.customer,
          attachments: detail.attachments,
        });
      }

      const list = await listAdminTickets({
        page: req.query?.page,
        limit: req.query?.limit,
        status: req.query?.status,
        department: req.query?.department,
        priority: req.query?.priority,
        assignedAdminId: req.query?.assigned,
        queue: req.query?.queue,
        q: req.query?.q,
        currentAdminId: admin.adminId,
      });
      return res.json({ ok: true, currentAdminId: admin.adminId, ...list });
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
          attachments: body?.attachments,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
        const profile = await getUserProfileByUserId(result.userId);
        const agent = await resolveAgentIdentity(admin.adminId, admin.email);
        await notifyTicketReplied({
          ticket: result.ticket,
          userEmail: result.userEmail,
          firstName: profile?.first_name || 'there',
          agentName: result.agentName || agent.display_name,
          agentAvatarUrl: result.agentAvatarUrl || agent.avatar_url,
          agentJobTitle: result.agentJobTitle || agent.job_title,
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
        const agent = await resolveAgentIdentity(admin.adminId, admin.email);
        await notifyTicketAssigned({
          ticket: result.ticket,
          userEmail: result.userEmail,
          firstName: profile?.first_name || 'there',
          agentName: agent.display_name,
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

      if (action === 'update_profile') {
        const saved = await upsertAdminProfile(admin.adminId, {
          displayName: body?.displayName || body?.display_name,
          avatarUrl: body?.avatarUrl || body?.avatar_url,
          jobTitle: body?.jobTitle || body?.job_title,
        });
        if (!saved.ok) return res.status(400).json({ ok: false, error: saved.reason });
        return res.json({ ok: true, profile: saved.profile });
      }

      if (action === 'feedback_resolve') {
        const feedbackId = String(body?.feedbackId || body?.id || '').trim();
        if (!feedbackId) return res.status(400).json({ ok: false, error: 'missing_id' });
        const result = await resolvePipelineFeedback(feedbackId, admin.adminId);
        if (!result.ok) return res.status(404).json({ ok: false, error: result.reason });
        return res.json({ ok: true, feedback: result.feedback });
      }

      return res.status(400).json({ ok: false, error: 'invalid_action' });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-support-tickets]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
