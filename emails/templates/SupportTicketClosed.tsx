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

export type SupportTicketClosedData = SupportTicketData & {
  ratingUrl?: string;
  resolutionSummary?: string;
};

export function SupportTicketClosed({
  firstName = 'there',
  ticketNumber = '0000',
  subject = 'Support request',
  ratingUrl,
  resolutionSummary,
  ticketUrl,
}: SupportTicketClosedData) {
  const rate = ratingUrl || SITE.supportTicketUrl(ticketNumber);
  const reopen = ticketUrl || SITE.supportTicketUrl(ticketNumber);

  return (
    <CutupLayout preview={`Ticket #${ticketNumber} resolved`}>
      <SuccessIndicator label="Resolved" />
      <HeroSection
        title={`Ticket #${ticketNumber} resolved`}
        subtitle={`Hi ${firstName}, your support request has been marked as resolved.`}
      />
      <EmailCard>
        <StatusBadge variant="success">Resolution summary</StatusBadge>
        <DetailTable>
          <DetailRow label="Ticket" value={`#${ticketNumber}`} />
          <DetailRow label="Subject" value={subject} />
          <DetailRow
            label="Outcome"
            value={resolutionSummary || 'Issue resolved by support team'}
            last
          />
        </DetailTable>
      </EmailCard>
      <EmailButton href={rate} fullWidth>
        Rate Support
      </EmailButton>
      <EmailButton href={reopen} variant="secondary">
        Reopen Ticket
      </EmailButton>
      <EmailText inset muted small>
        How was your experience? Your feedback helps us improve Cutup.
      </EmailText>
    </CutupLayout>
  );
}
