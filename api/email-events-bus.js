/**
 * Event-driven email bus — business logic emits events here; never calls Resend directly.
 */
import { setLastRenderError, setLastSendResult } from './email-debug-state.js';

let platformPromise = null;
let platformLoadError = null;

async function loadPlatform() {
  if (!platformPromise) {
    platformPromise = import('./email-platform/index.js').catch((err) => {
      platformLoadError = {
        message: err?.message || String(err),
        stack: err?.stack || null,
      };
      console.warn('[email-events-bus] platform unavailable:', platformLoadError.message, platformLoadError.stack);
      return null;
    });
  }
  return platformPromise;
}

export function getPlatformLoadError() {
  return platformLoadError;
}

async function createInAppNotification(event, payload) {
  try {
    const service = await import('./notifications-service/index.js');
    if (service?.createNotificationFromEvent) {
      await service.createNotificationFromEvent(event, payload);
    }
  } catch (err) {
    console.warn('[email-events-bus] notification skipped', event, err?.message || err);
  }
}

export async function emitEmailEvent(event, payload) {
  void createInAppNotification(event, payload);
  const platform = await loadPlatform();
  if (!platform?.emitEmailEvent) {
    return { ok: false, skipped: true, reason: 'platform_unavailable' };
  }
  try {
    return await platform.emitEmailEvent(event, payload);
  } catch (err) {
    console.error('[email-events-bus] emit failed', event, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function sendTemplatedEmail({ template, recipient, data, senderRole, tags }) {
  const platform = await loadPlatform();
  if (!platform?.sendEmail) {
    const result = { sent: false, skipped: true, template, reason: 'platform_unavailable' };
    setLastSendResult(result);
    return result;
  }
  try {
    const result = await platform.sendEmail({ template, recipient, data, senderRole, tags });
    setLastSendResult(result);
    return result;
  } catch (err) {
    const result = {
      sent: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
      template,
    };
    setLastSendResult(result);
    return result;
  }
}

export async function previewEmailTemplate(template, data = {}) {
  const platform = await loadPlatform();
  if (!platform?.renderEmailTemplate) {
    setLastRenderError({
      message: 'platform_unavailable',
      stack: platformLoadError?.stack || null,
      details: { platformLoadError },
    });
    return null;
  }
  try {
    const rendered = await platform.renderEmailTemplate(template, data);
    if (!rendered || typeof rendered.html !== 'string' || !rendered.html.trim()) {
      setLastRenderError({
        message: 'invalid_html_output',
        stack: null,
        details: {
          htmlType: typeof rendered?.html,
          htmlLength: typeof rendered?.html === 'string' ? rendered.html.length : 0,
        },
      });
      return null;
    }
    setLastRenderError(null);
    return rendered;
  } catch (err) {
    setLastRenderError(err);
    console.error('[email-events-bus] render failed', template, err?.stack || err);
    return null;
  }
}

export async function listEmailTemplates() {
  const platform = await loadPlatform();
  if (platform?.listAllTemplates) {
    try {
      const list = platform.listAllTemplates();
      if (Array.isArray(list) && list.length > 0) return list;
    } catch (err) {
      console.warn('[email-events-bus] listAllTemplates failed:', err?.message || err);
    }
  }
  try {
    const { listRegistryMeta } = await import('./email-registry-meta.js');
    return listRegistryMeta();
  } catch (err) {
    console.warn('[email-events-bus] registry meta fallback failed:', err?.message || err);
    return [];
  }
}

// ——— Domain event helpers (business logic calls these) ———

export function emitUserRegistered(payload) {
  return emitEmailEvent('user_registered', payload);
}

export function emitExportCompleted(payload) {
  return emitEmailEvent('export_completed', payload);
}

export function emitPaymentSuccessful(payload) {
  return emitEmailEvent('payment_successful', payload);
}

export function emitSubscriptionUpgraded(payload) {
  return emitEmailEvent('subscription_upgraded', payload);
}

export function emitCredits80Percent(payload) {
  return emitEmailEvent('credits_80_percent', payload);
}

export function emitCreditsExhausted(payload) {
  return emitEmailEvent('credits_exhausted', payload);
}

export function emitAccountDeletionRequested(payload) {
  return emitEmailEvent('account_deletion_requested', payload);
}

export function emitAccountDeleted(payload) {
  return emitEmailEvent('account_deleted', payload);
}

export function emitTicketCreated(payload) {
  return emitEmailEvent('ticket_created', payload);
}

export function emitTicketReplied(payload) {
  return emitEmailEvent('ticket_replied', payload);
}

export function emitTicketClosed(payload) {
  return emitEmailEvent('ticket_closed', payload);
}

export function emitSecurityNotification(payload) {
  return emitEmailEvent('security_notification', payload);
}

export function emitSystemNotification(payload) {
  return emitEmailEvent('system_notification', payload);
}
