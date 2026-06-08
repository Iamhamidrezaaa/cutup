import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  DetailTable,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  StatusBadge,
  SuccessIndicator,
} from '../components';
import { SITE } from '../brand';
import type { SupportTicketData } from './SupportTicketCreated';

export function SupportTicketResolved({
  firstName = 'there',
  ticketNumber = '0000',
  subject = 'Support request',
  ticketUrl,
}: SupportTicketData) {
  const url = ticketUrl || SITE.supportTicketUrl(ticketNumber);

  return (
    <CutupLayout preview={`Ticket #${ticketNumber} resolved`}>
      <SuccessIndicator label="Resolved" />
      <HeroSection
        title={`Ticket #${ticketNumber} resolved`}
        subtitle={`Hi ${firstName}, your support request has been marked as resolved.`}
      />
      <EmailCard>
        <StatusBadge variant="success" inline>Resolved</StatusBadge>
        <DetailTable>
          <DetailRow label="Ticket" value={`#${ticketNumber}`} />
          <DetailRow label="Subject" value={subject} last />
        </DetailTable>
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
