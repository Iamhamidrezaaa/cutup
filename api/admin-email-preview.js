/**
 * Admin email preview + test send API.
 * GET  ?action=list|preview|sample-data
 * POST ?action=send-test
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  listEmailTemplates,
  previewEmailTemplate,
  sendTemplatedEmail,
} from './email-events-bus.js';

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const admin = await resolveAdminAuth(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const action = req.query?.action || req.body?.action;

  try {
    if (req.method === 'GET' && action === 'list') {
      const templates = await listEmailTemplates();
      return res.json({
        ok: true,
        templates: templates.map((t) => ({
          template: t.template,
          senderRole: t.senderRole,
          event: t.event || null,
          sampleSubject: t.subject(t.sampleData),
          sampleData: t.sampleData,
        })),
      });
    }

    if (req.method === 'GET' && action === 'preview') {
      const template = String(req.query?.template || '').trim();
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      let data = {};
      if (req.query?.data) {
        try {
          data = JSON.parse(req.query.data);
        } catch {
          return res.status(400).json({ ok: false, error: 'invalid_data_json' });
        }
      } else {
        const all = await listEmailTemplates();
        const entry = all.find((t) => t.template === template);
        data = entry?.sampleData || {};
      }
      const rendered = await previewEmailTemplate(template, data);
      if (!rendered) {
        return res.status(503).json({ ok: false, error: 'render_unavailable' });
      }
      return res.json({ ok: true, template, data, rendered });
    }

    if (req.method === 'POST' && action === 'send-test') {
      const body = req.body || {};
      const template = String(body.template || '').trim();
      const recipient = String(body.recipient || admin.email || '').trim();
      if (!template) return res.status(400).json({ ok: false, error: 'template_required' });
      if (!recipient) return res.status(400).json({ ok: false, error: 'recipient_required' });

      const data = body.data && typeof body.data === 'object' ? body.data : {};
      const result = await sendTemplatedEmail({ template, recipient, data });
      return res.json({ ok: result.sent || result.skipped, result });
    }

    return res.status(404).json({ ok: false, error: 'not_found' });
  } catch (err) {
    console.error('[admin-email-preview]', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
