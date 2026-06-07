/**
 * Admin email pipeline diagnostics.
 *
 * GET  /api/admin/email-debug
 * POST /api/admin/email-debug-send  { recipient }
 */
import { setCORSHeaders } from './cors.js';
import { resolveAdminAuth } from './admin-panel-auth.js';
import {
  listEmailTemplates,
  previewEmailTemplate,
  sendTemplatedEmail,
  getPlatformLoadError,
} from './email-events-bus.js';
import { getLastRenderError, getLastSendResult } from './email-debug-state.js';
import { listRegistryMeta } from './email-registry-meta.js';

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

async function countTemplates() {
  const list = await listEmailTemplates();
  if (list?.length) return list.length;
  return listRegistryMeta().length;
}

async function probeRender() {
  try {
    const rendered = await previewEmailTemplate('WELCOME_EMAIL', { firstName: 'Debug' });
    return {
      working: Boolean(rendered?.html?.length),
      subject: rendered?.subject || null,
      htmlLength: rendered?.html?.length ?? 0,
    };
  } catch (err) {
    return { working: false, error: err?.message || String(err), stack: err?.stack || null };
  }
}

export default async function handler(req, res) {
  setCORSHeaders(res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const admin = await resolveAdminAuth(req);
  if (!admin) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const resendKeyPresent = resendKey != null && String(resendKey).trim() !== '';
  const emailFrom = 'Cutup <noreply@cutup.shop>';

  try {
    if (req.method === 'GET') {
      const templatesLoaded = await countTemplates();
      const renderProbe = await probeRender();
      const platformLoadError = getPlatformLoadError();

      return res.json({
        ok: true,
        resendConfigured: resendKeyPresent,
        resendKeyPresent,
        emailFrom,
        templatesLoaded,
        renderWorking: renderProbe.working,
        renderProbe,
        platformLoadError,
        lastRenderError: getLastRenderError(),
        lastSendResult: getLastSendResult(),
        reactEmailRenderInstalled: await checkReactEmailRender(),
      });
    }

    if (req.method === 'POST') {
      const body = parseJsonBody(req);
      const recipient = String(body.recipient || admin.email || '').trim();
      if (!recipient) {
        return res.status(400).json({ ok: false, error: 'recipient_required' });
      }

      const result = await sendTemplatedEmail({
        template: 'WELCOME_EMAIL',
        recipient,
        data: { firstName: 'Debug' },
        tags: ['admin_debug_send'],
      });

      return res.json({
        ok: Boolean(result.sent),
        template: 'WELCOME_EMAIL',
        recipient,
        result,
        lastRenderError: getLastRenderError(),
      });
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[admin-email-debug]', err);
    return res.status(500).json({
      ok: false,
      error: 'server_error',
      message: err?.message,
      stack: err?.stack,
      lastRenderError: getLastRenderError(),
    });
  }
}

async function checkReactEmailRender() {
  try {
    const mod = await import('@react-email/render');
    return {
      installed: true,
      renderIsFunction: typeof mod.render === 'function',
    };
  } catch (err) {
    return { installed: false, error: err?.message || String(err) };
  }
}
