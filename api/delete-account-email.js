/**
 * Account deletion emails — routed through email platform (Resend / SMTP).
 * @deprecated Direct HTML builders removed — use email-events-bus.
 */
import { emitAccountDeletionRequested } from './email-events-bus.js';

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export function buildDeleteAccountEmail({ first_name, days_with_cutup, deleteLink }) {
  const name = String(first_name || 'there').trim() || 'there';
  const link = String(deleteLink || '').trim();
  return {
    subject: 'Your Cutup account deletion request',
    html: '',
    text: `Hi ${name},\n\nConfirm deletion: ${link}`,
    deleteLink: link,
  };
}

export async function sendDeleteAccountConfirmationEmail(ctx, rawToken) {
  const deleteLink = `${FRONTEND_URL}/delete-account.html?token=${encodeURIComponent(rawToken)}`;
  const cancelUrl = `${FRONTEND_URL}/dashboard.html#profile`;

  if (!(await isTransportReady())) {
    console.warn('[delete-email] skipped — email transport not configured');
    return { sent: false, skipped: true, deleteLink };
  }

  const out = await emitAccountDeletionRequested({
    email: ctx.email,
    firstName: ctx.first_name || 'there',
    cancelUrl,
    confirmDeletionUrl: deleteLink,
    cooldownDays: 30,
  });

  const sent = out?.results?.some((r) => r.sent) || false;
  const skipped = out?.skipped || out?.results?.every((r) => r.skipped);
  if (sent) console.log('[delete-email-sent]', { to: ctx.email });
  return { sent, skipped, deleteLink, results: out?.results };
}

async function isTransportReady() {
  try {
    const platform = await import('./email-platform/index.js');
    if (platform?.isEmailPlatformConfigured) return platform.isEmailPlatformConfigured();
  } catch (_e) { /* build not run yet */ }
  const { isEmailTransportConfigured } = await import('./email.js');
  return isEmailTransportConfigured();
}
