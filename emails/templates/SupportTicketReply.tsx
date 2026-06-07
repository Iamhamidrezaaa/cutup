import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';
import type { SupportTicketData } from './SupportTicketCreated';

export type SupportTicketReplyData = SupportTicketData & {
  agentName?: string;
  replyText?: string;
};

export function SupportTicketReply({
  firstName = 'there',
  ticketNumber = '0000',
  agentName = 'Cutup Support',
  replyText = '',
  ticketUrl,
}: SupportTicketReplyData) {
  const url = ticketUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview={`Update on Ticket #${ticketNumber}`}>
      <EmailHeading>Update on Ticket #{ticketNumber}</EmailHeading>
      <EmailText>Hi {firstName}, {agentName} replied to your support ticket.</EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 12px', fontSize: '14px', color: '#6B7280' }}>
          <strong>{agentName}</strong> wrote:
        </EmailText>
        <EmailText style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{replyText || '—'}</EmailText>
      </EmailCard>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={url}>View Ticket</EmailButton>
      </Section>
    </CutupLayout>
  );
}
