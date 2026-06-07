import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  DetailTable,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  StatusBadge,
} from '../components';
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
      <StatusBadge variant="info">Ticket received</StatusBadge>
      <HeroSection
        title="We've received your request"
        subtitle={`Hi ${firstName}, our support team has your ticket and will respond shortly.`}
      />
      <EmailCard>
        <StatusBadge variant="info">#{ticketNumber}</StatusBadge>
        <DetailTable>
          <DetailRow label="Subject" value={subject} />
          <DetailRow label="Created" value={dateLabel} />
          <DetailRow label="Response time" value="Within 24 hours" last />
        </DetailTable>
      </EmailCard>
      <EmailButton href={url} fullWidth>
        View Ticket
      </EmailButton>
      <EmailText inset muted small>
        Need to add more details? Reply to this email or update your ticket in the dashboard.
      </EmailText>
    </CutupLayout>
  );
}
