import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

export type SystemNotificationData = {
  firstName?: string;
  title?: string;
  message?: string;
  ctaUrl?: string;
  ctaLabel?: string;
};

export function SystemNotification({
  firstName = 'there',
  title = 'Cutup update',
  message = '',
  ctaUrl,
  ctaLabel = 'Open Dashboard',
}: SystemNotificationData) {
  return (
    <CutupLayout preview={title}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>Hi {firstName},</EmailText>
      <EmailCard>
        <EmailText style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message || '—'}</EmailText>
      </EmailCard>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={ctaUrl || SITE.dashboardUrl}>{ctaLabel}</EmailButton>
      </Section>
    </CutupLayout>
  );
}
