const SITE = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export function supportTicketUrl(ticketNumber) {
  return `${SITE}/dashboard.html#support/${encodeURIComponent(ticketNumber)}`;
}

export async function notifyTicketCreated({ ticket, userEmail, firstName }) {
  const bus = await import('./email-events-bus.js');
  const payload = {
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    createdAt: ticket.created_at,
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  };
  void bus.emitTicketCreated(payload);
}

export async function notifyTicketReplied({ ticket, userEmail, firstName, agentName, replyText }) {
  const bus = await import('./email-events-bus.js');
  void bus.emitTicketReplied({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    agentName: agentName || 'Cutup Support',
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
  void bus.emitTicketResolved({
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
  void bus.emitTicketClosed({
    email: userEmail,
    userId: ticket.user_id,
    firstName: firstName || 'there',
    ticketNumber: ticket.ticket_number,
    subject: ticket.subject,
    ticketUrl: supportTicketUrl(ticket.ticket_number),
  });
}
