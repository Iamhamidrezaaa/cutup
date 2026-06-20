/**
 * Admin email preview + test send API.
 *
 * GET  /api/admin/email-preview
 *      → { ok, templates: [{ id, name, ... }] }
 * GET  /api/admin/email-preview?template=WELCOME_EMAIL&data={...}
 *      → { ok, template, html, subject, preview, data }
 * POST /api/admin/email-preview
 *      { template, recipient, data } → send test via Resend/SMTP
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  listEmailTemplates,
  previewEmailTemplate,
  sendTemplatedEmail,
} from './email-events-bus.js';
import { getLastRenderError } from './email-debug-state.js';
import {
  formatTemplateForApi,
  getRegistryMetaEntry,
  listRegistryMeta,
} from './email-registry-meta.js';
import { resolveEmailRecipientData } from './email-recipient-data.js';
import {
  countEmailAudience,
  runBulkEmailSend,
} from './email-broadcast-repository.js';

const emailJobs = new Map();

function enqueueEmailJob(jobName, runner) {
  const jobId = `email_job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  emailJobs.set(jobId, {
    id: jobId,
    name: jobName,
    status: 'queued',
    createdAt: new Date().toISOString(),
    doneAt: null,
    error: null,
    result: null,
  });
  setTimeout(async () => {
    const row = emailJobs.get(jobId);
    if (!row) return;
    row.status = 'running';
    try {
      const result = await runner();
      row.status = 'completed';
      row.doneAt = new Date().toISOString();
      row.result = result || null;
    } catch (e) {
      row.status = 'failed';
      row.doneAt = new Date().toISOString();
      row.error = e?.message || String(e);
    }
  }, 0);
  return jobId;
}
function parseJsonBody(req) {
  let body = req.body;
  if (typeof body === 'string' && body.length > 0) {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body && typeof body === 'object' ? body : {};
}

async function resolveTemplateCatalog() {
  let entries = await listEmailTemplates();
  if (!entries?.length) {
    console.warn('[admin-email-preview] platform registry empty — using email-registry-meta fallback');
    entries = listRegistryMeta();
  }
  return entries;
}

function resolveSampleData(templateId, entries, override) {
  if (override && typeof override === 'object' && Object.keys(override).length) {
    const entry =
      entries.find((e) => e.template === templateId) || getRegistryMetaEntry(templateId);
    return { ...(entry?.sampleData || {}), ...override };
  }
  const entry =
    entries.find((e) => e.template === templateId) || getRegistryMetaEntry(templateId);
  return entry?.sampleData || {};
}

async function mergeSendDataForRecipient(templateId, entries, recipient, override = {}) {
  const sample = resolveSampleData(templateId, entries);
  const profile = await resolveEmailRecipientData(recipient);
  return { ...sample, ...profile, ...override };
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const admin = await resolveAdminAuth(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const action = req.query?.action;
  const templateParam = String(req.query?.template || '').trim();

  try {
    // ——— Legacy: ?action=list|preview|send-test (backward compatible) ———
    if (req.method === 'GET' && action === 'list') {
      const entries = await resolveTemplateCatalog();
      return res.json({
        ok: true,
        templates: entries.map(formatTemplateForApi),
      });
    }

    if (req.method === 'GET' && action === 'recipient-data') {
      const email = String(req.query?.email || '').trim();
      if (!email) return res.status(400).json({ ok: false, error: 'email_required' });
      const profile = await resolveEmailRecipientData(email);
      return res.json({ ok: true, profile });
    }

    if (req.method === 'GET' && action === 'audience-stats') {
      const template = String(req.query?.template || templateParam || '').trim();
      const mode = String(req.query?.mode || 'all').trim().toLowerCase() === 'plan' ? 'plan' : 'all';
      const plan = String(req.query?.plan || 'free').trim();
      const excludeAlreadySent = req.query?.excludeAlreadySent !== 'false';
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      const stats = await countEmailAudience({ template, mode, plan, excludeAlreadySent });
      return res.json({ ok: true, audience: stats });
    }

    if (req.method === 'GET' && action === 'job' && req.query?.jobId) {
      const row = emailJobs.get(String(req.query.jobId).trim());
      if (!row) return res.status(404).json({ ok: false, error: 'job_not_found' });
      return res.json({ ok: true, job: row });
    }

    if (req.method === 'GET' && action === 'preview') {
      const template = templateParam;
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      const entries = await resolveTemplateCatalog();
      let data = {};
      if (req.query?.data) {
        try {
          data = JSON.parse(req.query.data);
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_data_json' });
        }
      } else {
        data = resolveSampleData(template, entries);
      }
      const rendered = await previewEmailTemplate(template, data);
      if (!rendered) {
        const lastRenderError = getLastRenderError();
        return res.status(503).json({
          ok: false,
          error: 'render_unavailable',
          lastRenderError,
          stack: lastRenderError?.stack || null,
        });
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({ ok: true, template, data, rendered });
    }

    if (req.method === 'POST' && action === 'send-test') {
      const body = parseJsonBody(req);
      const template = String(body.template || '').trim();
      const recipient = String(body.recipient || admin.email || '').trim();
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      if (!recipient) return res.status(400).json({ ok: false, error: 'recipient_required' });
      const entries = await resolveTemplateCatalog();
      const override = body.data && typeof body.data === 'object' ? body.data : {};
      const useRecipientProfile = body.useRecipientProfile !== false;
      const data = useRecipientProfile
        ? await mergeSendDataForRecipient(template, entries, recipient, override)
        : { ...resolveSampleData(template, entries), ...override };
      const result = await sendTemplatedEmail({ template, recipient, data });
      return res.json({ ok: Boolean(result.sent), result, data });
    }

    if (req.method === 'POST' && action === 'send-bulk') {
      const body = parseJsonBody(req);
      const template = String(body.template || '').trim();
      const mode = String(body.mode || 'all').trim().toLowerCase() === 'plan' ? 'plan' : 'all';
      const plan = String(body.plan || 'free').trim();
      const excludeAlreadySent = body.excludeAlreadySent !== false;
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      const entries = await resolveTemplateCatalog();
      const override = body.data && typeof body.data === 'object' ? body.data : {};
      const sampleData = resolveSampleData(template, entries, override);
      const jobId = enqueueEmailJob('send_bulk', async () =>
        runBulkEmailSend({
          template,
          mode,
          plan,
          excludeAlreadySent,
          dataOverride: override,
          sampleData,
        })
      );
      return res.status(200).json({
        ok: true,
        jobId,
        message: 'Bulk email job accepted.',
      });
    }

    // ——— Canonical API (no action param) ———
    if (req.method === 'GET' && !templateParam) {
      const entries = await resolveTemplateCatalog();
      return res.json({
        ok: true,
        templates: entries.map(formatTemplateForApi),
      });
    }

    if (req.method === 'GET' && templateParam) {
      const entries = await resolveTemplateCatalog();
      let data = resolveSampleData(templateParam, entries);
      if (req.query?.data) {
        try {
          data = { ...data, ...JSON.parse(req.query.data) };
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_data_json' });
        }
      }
      const rendered = await previewEmailTemplate(templateParam, data);
      if (!rendered) {
        const lastRenderError = getLastRenderError();
        return res.status(503).json({
          ok: false,
          error: 'render_unavailable',
          lastRenderError,
          stack: lastRenderError?.stack || null,
        });
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.json({
        ok: true,
        template: templateParam,
        subject: rendered.subject,
        preview: rendered.preview,
        html: rendered.html,
        text: rendered.text,
        data,
      });
    }

    if (req.method === 'POST') {
      const body = parseJsonBody(req);
      const template = String(body.template || '').trim();
      const recipient = String(body.recipient || admin.email || '').trim();
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      if (!recipient) return res.status(400).json({ ok: false, error: 'recipient_required' });
      const entries = await resolveTemplateCatalog();
      const override = body.data && typeof body.data === 'object' ? body.data : {};
      const useRecipientProfile = body.useRecipientProfile !== false;
      const data = useRecipientProfile
        ? await mergeSendDataForRecipient(template, entries, recipient, override)
        : { ...resolveSampleData(template, entries), ...override };
      const result = await sendTemplatedEmail({ template, recipient, data });
      return res.json({ ok: Boolean(result.sent), result, data });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-email-preview]', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: err?.message });
  }
}
