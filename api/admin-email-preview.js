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
import {
  buildPreviewDiagnostics,
  injectPreviewDiagnostics,
} from './email-preview-diagnostics.js';

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

function attachPreviewDiagnostics(templateId, rendered) {
  if (!rendered?.html) return rendered;
  const diagnostics = buildPreviewDiagnostics(templateId, rendered.html);
  return {
    ...rendered,
    html: injectPreviewDiagnostics(rendered.html, diagnostics),
    _debug: diagnostics,
  };
}

function resolveSampleData(templateId, entries, override) {
  if (override && typeof override === 'object') return override;
  const entry =
    entries.find((e) => e.template === templateId) || getRegistryMetaEntry(templateId);
  return entry?.sampleData || {};
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
      const rendered = attachPreviewDiagnostics(template, await previewEmailTemplate(template, data));
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
      const data = body.data && typeof body.data === 'object' ? body.data : {};
      const result = await sendTemplatedEmail({ template, recipient, data });
      return res.json({ ok: Boolean(result.sent), result });
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
      const rendered = attachPreviewDiagnostics(
        templateParam,
        await previewEmailTemplate(templateParam, data),
      );
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
        _debug: rendered._debug,
      });
    }

    if (req.method === 'POST') {
      const body = parseJsonBody(req);
      const template = String(body.template || '').trim();
      const recipient = String(body.recipient || admin.email || '').trim();
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      if (!recipient) return res.status(400).json({ ok: false, error: 'recipient_required' });
      const data = body.data && typeof body.data === 'object' ? body.data : {};
      const result = await sendTemplatedEmail({ template, recipient, data });
      return res.json({ ok: Boolean(result.sent), result });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-email-preview]', err);
    return res.status(500).json({ ok: false, error: 'server_error', message: err?.message });
  }
}
