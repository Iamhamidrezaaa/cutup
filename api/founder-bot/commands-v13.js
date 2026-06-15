/**
 * Founder Bot V1.3 — Support Center commands.
 */
import {
  getTicketsMetrics,
  getUrgentMetrics,
  getSlaMetrics,
  getFeedbackMetrics
} from './metrics-v13.js';
import { formatPipelineFeedbackStage } from '../pipeline-feedback-repository.js';
import { SUPPORT_DEPARTMENTS } from '../support-constants.js';

export const founderBotHelpExtensionV13 = [
  '/tickets — ticket counts',
  '/urgent — urgent & SLA breaches',
  '/sla — SLA by department',
  '/feedback — requests & bugs'
].join('\n');

function formatTickets(m) {
  if (!m.ok) return `⚠️ Tickets\n\n${m.error || 'Unavailable'}`;
  return [
    '🎫 Tickets',
    '',
    `Open: ${m.open}`,
    `Waiting: ${m.waiting}`,
    `Resolved: ${m.resolved}`,
    `Closed: ${m.closed}`
  ].join('\n');
}

function formatTicketList(title, items) {
  if (!items?.length) return `${title}\n—`;
  return [
    title,
    ...items.map(
      (t, i) =>
        `${i + 1}. ${t.ticketNumber} · ${t.subject || '—'} (${t.userName || t.userEmail || '—'})`
    )
  ].join('\n');
}

function formatUrgent(m) {
  if (!m.ok) return `⚠️ Urgent\n\n${m.error || 'Unavailable'}`;
  return [
    '🚨 Urgent Queue',
    '',
    formatTicketList('Urgent Tickets', m.urgent),
    '',
    formatTicketList('Breached SLA Tickets', m.breached)
  ].join('\n');
}

function formatSla(m) {
  if (!m.ok) return `⚠️ SLA\n\n${m.error || 'Unavailable'}`;
  const lines = ['⏱ SLA', ''];
  for (const dept of SUPPORT_DEPARTMENTS) {
    const counts = m.byDepartment[dept] || { healthy: 0, atRisk: 0, breached: 0 };
    lines.push(m.formatDepartmentLabel(dept));
    lines.push(`Healthy: ${counts.healthy}`);
    lines.push(`At Risk: ${counts.atRisk}`);
    lines.push(`Breached: ${counts.breached}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatFeedbackList(title, items, formatter) {
  if (!items?.length) return `${title}\n—`;
  return [title, ...items.map((item, i) => `${i + 1}. ${formatter(item)}`)].join('\n');
}

function formatFeedback(m) {
  if (!m.ok) return `⚠️ Feedback\n\n${m.error || 'Unavailable'}`;
  return [
    '💬 Feedback',
    '',
    formatFeedbackList('Feature Requests', m.featureRequests, (r) =>
      `${r.ticketNumber || '—'} · ${r.subject || '—'} (${r.userName || '—'})`
    ),
    '',
    formatFeedbackList('Bug Reports', m.bugReports, (r) => {
      const stage = formatPipelineFeedbackStage(r.action, {});
      const who = r.userEmail || 'Anonymous';
      const note = r.comment ? ` — ${String(r.comment).slice(0, 80)}` : '';
      return `${stage} · ${who}${note}`;
    }),
    '',
    formatFeedbackList('Suggestions', m.suggestions, (r) => {
      const stage = formatPipelineFeedbackStage(r.action, {});
      const who = r.userEmail || 'Anonymous';
      const note = r.comment ? ` — ${String(r.comment).slice(0, 80)}` : '';
      return `${stage} · ${who}${note}`;
    })
  ].join('\n');
}

export async function dispatchCommandV13(command) {
  switch (command) {
    case '/tickets':
      return formatTickets(await getTicketsMetrics());
    case '/urgent':
      return formatUrgent(await getUrgentMetrics());
    case '/sla':
      return formatSla(await getSlaMetrics());
    case '/feedback':
      return formatFeedback(await getFeedbackMetrics());
    default:
      return null;
  }
}
