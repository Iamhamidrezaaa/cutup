const SITE = (process.env.FRONTEND_URL || 'https://cutup.shop').replace(/\/$/, '');

export function buildEmailGoLink({ dest, ticket, slug, hash }) {
  const params = new URLSearchParams();
  params.set('dest', String(dest || 'dashboard').trim());
  if (ticket) params.set('ticket', String(ticket).trim());
  if (slug) params.set('slug', String(slug).trim());
  if (hash) params.set('hash', String(hash).replace(/^#/, '').trim());
  return `${SITE}/go.html?${params.toString()}`;
}

export function supportTicketDeepLink(ticketNumber) {
  return buildEmailGoLink({ dest: 'support', ticket: ticketNumber });
}

export function dashboardDeepLink(hash) {
  return buildEmailGoLink({ dest: 'dashboard', hash });
}
