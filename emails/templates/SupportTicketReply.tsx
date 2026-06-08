import { Img, Text } from '@react-email/components';
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
  agentAvatarUrl?: string;
  agentJobTitle?: string;
  replyText?: string;
};

export function SupportTicketReply({
  firstName = 'there',
  ticketNumber = '0000',
  agentName = 'Cutup Support',
  agentAvatarUrl,
  agentJobTitle = 'Customer Success',
  replyText = '',
  ticketUrl,
}: SupportTicketReplyData) {
  const url = ticketUrl || SITE.supportTicketUrl(ticketNumber);

  return (
    <CutupLayout preview={`Update on Ticket #${ticketNumber}`}>
      <StatusBadge variant="info">New reply</StatusBadge>
      <HeroSection
        title={`Update on ticket #${ticketNumber}`}
        subtitle={`Hi ${firstName}, ${agentName} replied to your support request.`}
      />
      <EmailCard>
        {agentAvatarUrl ? (
          <Img
            src={agentAvatarUrl}
            width="48"
            height="48"
            alt={agentName}
            style={{
              borderRadius: '999px',
              margin: '0 0 12px',
              display: 'block',
              border: '1px solid #e5e7eb',
            }}
          />
        ) : null}
        <Text
          style={{
            margin: '0 0 4px',
            fontSize: '15px',
            fontWeight: 700,
            color: BRAND.text,
          }}
        >
          {agentName}
        </Text>
        <Text
          style={{
            margin: '0 0 12px',
            fontSize: BRAND.metaSize,
            fontWeight: 500,
            color: BRAND.textMuted,
          }}
        >
          {agentJobTitle}
        </Text>
        <Text
          className="email-card-body-text email-word-break"
          style={{ margin: 0, whiteSpace: 'pre-wrap' }}
        >
          {replyText || '—'}
        </Text>
      </EmailCard>
      <EmailButton href={url} fullWidth>
        View Ticket
      </EmailButton>
    </CutupLayout>
  );
}
