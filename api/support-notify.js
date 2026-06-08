import { supportTicketDeepLink } from './email-deep-links.js';

const SITE = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export function supportTicketUrl(ticketNumber) {
  return supportTicketDeepLink(ticketNumber);
}

function adminSupportUrl(ticketNumber) {
  return `${SITE}/adminha.html`;
}

function formatTicketTimestamp(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function resolveSupportInboxEmail() {
  const fromEnv = String(process.env.SUPPORT_INBOX_EMAIL || process.env.SUPPORT_NOTIFY_EMAIL || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const { PRIMARY_ADMIN_EMAIL } = await import('./admins-repository.js');
    return String(PRIMARY_ADMIN_EMAIL || '').trim();
  } catch (_err) {
    return '';
  }
}

async function notifySupportInbox({ ticket, userEmail, messagePreview }) {
  const inbox = await resolveSupportInboxEmail();
  if (!inbox) return { sent: false, skipped: true, reason: 'no_inbox_configured' };

  const { sendTemplatedEmail } = await import('./email-events-bus.js');
  const body = [
    `Customer: ${userEmail}`,
    `Subject: ${ticket.subject}`,
    `Department: ${ticket.department}`,
    `Priority: ${ticket.priority}`,
    '',
    messagePreview || ticket.message || '',
  ].join('\n');

  return sendTemplatedEmail({
    template: 'SYSTEM_NOTIFICATION',
    recipient: inbox,
    data: {
      firstName: 'Team',
      title: `New support ticket #${ticket.ticket_number}`,
      message: body,
      ctaUrl: adminSupportUrl(ticket.ticket_number),
      ctaLabel: 'Open Support Inbox',
    },
    senderRole: 'support',
    tags: ['support_new_ticket'],
  });
}

export async function notifyTicketCreated({ ticket, userEmail, firstName }) {
  const bus = await import('./email-events-bus.js');
  const payload = {
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    createdAt: formatTicketTimestamp(ticket.created_at),
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  };

  const [userResult] = await Promise.all([
    bus.emitTicketCreated(payload),
    notifySupportInbox({
      ticket,
      userEmail,
      messagePreview: ticket.message,
    }),
  ]);

  return userResult;
}

function absoluteAssetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SITE}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

export async function notifyTicketReplied({ ticket, userEmail, firstName, agentName, agentAvatarUrl, agentJobTitle, replyText }) {
  const bus = await import('./email-events-bus.js');
  return bus.emitTicketReplied({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    agentName: agentName || 'Cutup Support',
    agentAvatarUrl: absoluteAssetUrl(agentAvatarUrl),
    agentJobTitle: agentJobTitle || 'Customer Success',
    replyText: replyText || '',
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  });
}

export async function notifyTicketAssigned({ ticket, userEmail, firstName, agentName }) {
  const bus = await import('./email-events-bus.js');
  void bus.emitTicketAssigned({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    agentName: agentName || 'Cutup Support',
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  });
}

export async function notifyTicketResolved({ ticket, userEmail, firstName }) {
  const bus = await import('./email-events-bus.js');
  return bus.emitTicketResolved({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  });
}

export async function notifyTicketClosed({ ticket, userEmail, firstName }) {
  const bus = await import('./email-events-bus.js');
  return bus.emitTicketClosed({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  });
}
