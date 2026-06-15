/**
 * Shared SLA refresh helper for Founder Bot V1.3 metrics.
 */
export async function refreshSlaStatuses(pool) {
  await pool.query(
    `UPDATE support_tickets SET sla_status = CASE
      WHEN status IN ('RESOLVED','CLOSED') OR first_response_at IS NOT NULL THEN 'healthy'
      WHEN sla_due_at IS NULL THEN 'healthy'
      WHEN sla_due_at <= NOW() THEN 'breached'
      WHEN sla_due_at <= NOW() + INTERVAL '2 hours' THEN 'at_risk'
      ELSE 'healthy'
    END
    WHERE status NOT IN ('RESOLVED','CLOSED') AND first_response_at IS NULL`
  );
}
