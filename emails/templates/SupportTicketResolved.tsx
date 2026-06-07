import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  StatusBadge,
  SuccessIndicator,
} from '../components';
import type { SupportTicketData } from './SupportTicketCreated';

export function SupportTicketResolved({
  firstName = 'there',
  ticketNumber = '0000',
  subject = 'Support request',
  ticketUrl,
}: SupportTicketData) {
  const url = ticketUrl || 'https://cutup.shop/dashboard.html#support';

  return (
    <CutupLayout preview={`Ticket #${ticketNumber} resolved`}>
      <SuccessIndicator label="Resolved" />
      <HeroSection
        title={`Ticket #${ticketNumber} resolved`}
        subtitle={`Hi ${firstName}, your support request has been marked as resolved.`}
      />
      <EmailCard>
        <StatusBadge variant="success">Resolved</StatusBadge>
        <DetailRow label="Ticket" value={`#${ticketNumber}`} />
        <DetailRow label="Subject" value={subject} last />
      </EmailCard>
      <EmailButton href={url} fullWidth>
        View Ticket
      </EmailButton>
      <EmailText inset muted small>
        If you still need help, reply in the dashboard and we will reopen your ticket.
      </EmailText>
    </CutupLayout>
  );
}
