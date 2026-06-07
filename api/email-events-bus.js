/**
 * Event-driven email bus — business logic emits events here; never calls Resend directly.
 */
let platformPromise = null;

async function loadPlatform() {
  if (!platformPromise) {
    platformPromise = import('./email-platform/index.js').catch((err) => {
      console.warn('[email-events-bus] platform unavailable:', err?.message || err);
      return null;
    });
  }
  return platformPromise;
}

export async function emitEmailEvent(event, payload) {
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
    return { sent: false, skipped: true, template };
  }
  return platform.sendEmail({ template, recipient, data, senderRole, tags });
}

export async function previewEmailTemplate(template, data = {}) {
  const platform = await loadPlatform();
  if (!platform?.renderEmailTemplate) return null;
  return platform.renderEmailTemplate(template, data);
}

export async function listEmailTemplates() {
  const platform = await loadPlatform();
  if (!platform?.listAllTemplates) return [];
  return platform.listAllTemplates();
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
