import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailButton,
  EmailCard,
  HeroSection,
  StatusBadge,
} from '../components';
import { BRAND, SITE } from '../brand';
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
      <StatusBadge variant="info">New reply</StatusBadge>
      <HeroSection
        title={`Update on ticket #${ticketNumber}`}
        subtitle={`Hi ${firstName}, ${agentName} replied to your support request.`}
      />
      <EmailCard>
        <Text
          style={{
            margin: '0 0 12px',
            fontSize: '13px',
            fontWeight: 600,
            color: BRAND.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {agentName}
        </Text>
        <Text style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: '1.65', color: BRAND.text }}>
          {replyText || '—'}
        </Text>
      </EmailCard>
      <EmailButton href={url} fullWidth>
        View Ticket
      </EmailButton>
    </CutupLayout>
  );
}
