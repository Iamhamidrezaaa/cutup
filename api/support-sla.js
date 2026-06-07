/** SLA engine — department + priority rules */

const DEPARTMENT_SLA_HOURS = {
  TECHNICAL_SUPPORT: 24,
  BILLING: 12,
  MANAGEMENT: 48,
  FEATURE_REQUEST: 48,
  ACCOUNT: 24,
  GENERAL: 24,
};

const URGENT_SLA_HOURS = 4;

export function slaHoursForTicket({ department, priority }) {
  const pri = String(priority || '').trim().toUpperCase();
  if (pri === 'URGENT') return URGENT_SLA_HOURS;
  const dept = String(department || '').trim().toUpperCase();
  return DEPARTMENT_SLA_HOURS[dept] ?? 24;
}

export function computeSlaDueAt(createdAt, department, priority) {
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return null;
  const hours = slaHoursForTicket({ department, priority });
  return new Date(base.getTime() + hours * 3600000);
}

export function computeSlaStatus({ slaDueAt, firstResponseAt, status, now = new Date() }) {
  const closed = ['RESOLVED', 'CLOSED'].includes(String(status || '').toUpperCase());
  if (closed || firstResponseAt) return 'healthy';
  if (!slaDueAt) return 'healthy';
  const due = new Date(slaDueAt);
  if (Number.isNaN(due.getTime())) return 'healthy';
  const msLeft = due.getTime() - now.getTime();
  if (msLeft <= 0) return 'breached';
  if (msLeft <= 2 * 3600000) return 'at_risk';
  return 'healthy';
}

export function enrichTicketWithSla(ticket, now = new Date()) {
  if (!ticket) return ticket;
  const slaDueAt = ticket.sla_due_at || computeSlaDueAt(ticket.created_at, ticket.department, ticket.priority);
  const slaStatus = computeSlaStatus({
    slaDueAt,
    firstResponseAt: ticket.first_response_at,
    status: ticket.status,
    now,
  });
  const msLeft = slaDueAt ? new Date(slaDueAt).getTime() - now.getTime() : null;
  return {
    ...ticket,
    sla_due_at: slaDueAt,
    sla_status: slaStatus,
    sla_ms_remaining: msLeft,
  };
}
