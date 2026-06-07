import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

export type SupportTicketData = {
  firstName?: string;
  ticketNumber?: string;
  subject?: string;
  createdAt?: string;
  ticketUrl?: string;
};

export function SupportTicketCreated({
  firstName = 'there',
  ticketNumber = '0000',
  subject = 'Support request',
  createdAt,
  ticketUrl,
}: SupportTicketData) {
  const dateLabel = createdAt || new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });
  const url = ticketUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview={`Ticket #${ticketNumber} received`}>
      <EmailHeading>Ticket #{ticketNumber} received</EmailHeading>
      <EmailText>Hi {firstName}, we&apos;ve received your support request and will respond shortly.</EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Ticket:</strong> #{ticketNumber}
        </EmailText>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Subject:</strong> {subject}
        </EmailText>
        <EmailText style={{ margin: 0 }}>
          <strong>Created:</strong> {dateLabel}
        </EmailText>
      </EmailCard>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={url}>View Ticket</EmailButton>
      </Section>
    </CutupLayout>
  );
}
