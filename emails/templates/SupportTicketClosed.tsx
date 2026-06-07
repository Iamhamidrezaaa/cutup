import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';
import type { SupportTicketData } from './SupportTicketCreated';

export type SupportTicketClosedData = SupportTicketData & {
  ratingUrl?: string;
};

export function SupportTicketClosed({
  firstName = 'there',
  ticketNumber = '0000',
  subject = 'Support request',
  ratingUrl,
}: SupportTicketClosedData) {
  const rate = ratingUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview={`Ticket #${ticketNumber} resolved`}>
      <EmailHeading>Ticket #{ticketNumber} resolved</EmailHeading>
      <EmailText>
        Hi {firstName}, your support ticket &quot;{subject}&quot; has been marked as resolved.
      </EmailText>
      <EmailText>How was your experience? Your feedback helps us improve Cutup.</EmailText>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={rate}>Rate Support</EmailButton>
      </Section>
    </CutupLayout>
  );
}
