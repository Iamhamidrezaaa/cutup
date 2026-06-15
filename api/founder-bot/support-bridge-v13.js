/**
 * Founder Bot V1.3 — bridge into Support Center notifications.
 */
import {
  founderAlertNewSupportTicket,
  founderAlertUrgentSupportTicket,
  founderAlertTicketEscalated,
  founderAlertNegativeFeedback
} from './alerts-v13.js';

export function notifyFounderBotTicketCreated({ ticket, userEmail, firstName }) {
  if (!ticket) return;
  const payload = {
    ticketNumber: ticket.ticket_number,
    department: ticket.department,
    priority: ticket.priority,
    subject: ticket.subject,
    email: userEmail,
    firstName: firstName || null,
    userId: ticket.user_id
  };
  founderAlertNewSupportTicket(payload);
  if (String(ticket.priority || '').toUpperCase() === 'URGENT') {
    founderAlertUrgentSupportTicket(payload);
  }
}

export function notifyFounderBotTicketEscalated({ ticket, userEmail, firstName, reason }) {
  if (!ticket) return;
  founderAlertTicketEscalated({
    ticketNumber: ticket.ticket_number,
    department: ticket.department,
    priority: ticket.priority,
    subject: ticket.subject,
    email: userEmail,
    firstName: firstName || null,
    reason: reason || 'Escalated to support lead'
  });
}

export function notifyFounderBotNegativeFeedback(feedback) {
  if (!feedback || feedback.rating !== 'down') return;
  founderAlertNegativeFeedback(feedback);
}
