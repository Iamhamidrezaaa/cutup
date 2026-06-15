/**
 * Founder Bot V1.3 — Support Center alerts.
 */
import { queueTelegramMessage } from './telegram.js';
import { formatDepartmentLabel } from '../support-constants.js';
import { formatPipelineFeedbackStage } from '../pipeline-feedback-repository.js';

function displayUserName(payload = {}) {
  const parts = [payload.firstName, payload.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (payload.userName) return String(payload.userName);
  if (payload.name) return String(payload.name);
  if (payload.email) return String(payload.email).split('@')[0];
  return '—';
}

function priorityLabel(priority) {
  const p = String(priority || 'NORMAL').toUpperCase();
  return p.charAt(0) + p.slice(1).toLowerCase();
}

function formatTicketAlert({
  emoji,
  title,
  department,
  priority,
  subject,
  userName,
  ticketNumber,
  extraLines = []
}) {
  return [
    `${emoji} ${title}`,
    '',
    'Department:',
    formatDepartmentLabel(department),
    '',
    'Priority:',
    priorityLabel(priority),
    '',
    'Subject:',
    subject || '—',
    '',
    'User:',
    userName || '—',
    ticketNumber ? `\nTicket: ${ticketNumber}` : null,
    ...extraLines
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export async function onNewSupportTicket(payload = {}) {
  try {
    const text = formatTicketAlert({
      emoji: '🎫',
      title: 'New Support Ticket',
      department: payload.department,
      priority: payload.priority,
      subject: payload.subject,
      userName: displayUserName(payload),
      ticketNumber: payload.ticketNumber
    });
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onNewSupportTicket', err?.message || err);
  }
}

export async function onUrgentSupportTicket(payload = {}) {
  try {
    const text = formatTicketAlert({
      emoji: '🚨',
      title: 'Urgent Support Ticket',
      department: payload.department,
      priority: payload.priority || 'URGENT',
      subject: payload.subject,
      userName: displayUserName(payload),
      ticketNumber: payload.ticketNumber
    });
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onUrgentSupportTicket', err?.message || err);
  }
}

export async function onTicketEscalated(payload = {}) {
  try {
    const reason = payload.reason || 'Assigned for urgent handling';
    const text = formatTicketAlert({
      emoji: '⬆️',
      title: 'Ticket Escalated',
      department: payload.department,
      priority: payload.priority,
      subject: payload.subject,
      userName: displayUserName(payload),
      ticketNumber: payload.ticketNumber,
      extraLines: ['', 'Reason:', reason]
    });
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onTicketEscalated', err?.message || err);
  }
}

export async function onNegativeFeedback(payload = {}) {
  try {
    const stage = formatPipelineFeedbackStage(payload.action, payload.metadata || {});
    const user = payload.userEmail || 'Anonymous';
    const comment = String(payload.comment || '').trim() || '(No comment)';
    const text = [
      '👎 Negative Feedback',
      '',
      'Stage:',
      stage,
      '',
      'User:',
      user,
      '',
      'Comment:',
      comment.slice(0, 500)
    ].join('\n');
    queueTelegramMessage(text);
  } catch (err) {
    console.warn('[founder-bot] onNegativeFeedback', err?.message || err);
  }
}

function notify(fn, payload) {
  void fn(payload).catch(() => {});
}

export function founderAlertNewSupportTicket(payload) {
  notify(onNewSupportTicket, payload);
}

export function founderAlertUrgentSupportTicket(payload) {
  notify(onUrgentSupportTicket, payload);
}

export function founderAlertTicketEscalated(payload) {
  notify(onTicketEscalated, payload);
}

export function founderAlertNegativeFeedback(payload) {
  notify(onNegativeFeedback, payload);
}
