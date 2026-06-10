/**
 * Email all active admin-role users when negative pipeline feedback is received.
 */
import { listAdminsDb } from './admins-repository.js';
import { formatPipelineFeedbackStage } from './pipeline-feedback-repository.js';

const SITE = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

function adminRecipients(admins) {
  return (admins || [])
    .filter(
      (a) =>
        String(a.status || '').toLowerCase() === 'active' &&
        ['admin', 'super_admin'].includes(String(a.role || '').toLowerCase())
    )
    .map((a) => String(a.email || '').trim().toLowerCase())
    .filter(Boolean);
}

export async function notifyAdminsNegativePipelineFeedback(feedback) {
  if (!feedback || feedback.rating !== 'down') {
    return { sent: 0, skipped: true };
  }

  let admins = [];
  try {
    admins = await listAdminsDb();
  } catch (err) {
    console.warn('[pipeline-feedback-notify] list_admins_failed', err?.message);
  }

  const recipients = [...new Set(adminRecipients(admins))];
  if (!recipients.length) {
    console.warn('[pipeline-feedback-notify] no_admin_recipients');
    return { sent: 0, skipped: true, reason: 'no_recipients' };
  }

  const stage = formatPipelineFeedbackStage(feedback.action, feedback.metadata || {});
  const user = feedback.userEmail || 'Anonymous (not signed in)';
  const comment = String(feedback.comment || '').trim() || '(No comment provided)';

  const message = [
    `A user left negative feedback during: ${stage}`,
    `User: ${user}`,
    '',
    'Comment:',
    comment,
    '',
    `Feedback ID: ${feedback.id || '—'}`,
    `Time: ${feedback.createdAt || new Date().toISOString()}`
  ].join('\n');

  const { sendTemplatedEmail } = await import('./email-events-bus.js');
  let sent = 0;
  for (const email of recipients) {
    try {
      await sendTemplatedEmail({
        template: 'SYSTEM_NOTIFICATION',
        recipient: email,
        data: {
          firstName: 'Admin',
          title: `Negative feedback · ${stage}`,
          message,
          ctaUrl: `${SITE}/adminha.html?section=support`,
          ctaLabel: 'Open Support Center'
        },
        senderRole: 'support',
        tags: ['pipeline_feedback_negative', feedback.action || 'unknown']
      });
      sent += 1;
    } catch (err) {
      console.warn('[pipeline-feedback-notify] send_failed', { email: email.slice(0, 3) + '…', message: err?.message });
    }
  }

  console.log('[pipeline-feedback-notify]', { sent, recipients: recipients.length, stage, user: user.slice(0, 3) + '…' });
  return { sent, recipients: recipients.length };
}
