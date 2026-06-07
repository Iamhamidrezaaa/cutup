import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { BRAND, SITE } from '../brand';

export type SecurityNotificationData = {
  firstName?: string;
  title?: string;
  message?: string;
  actionUrl?: string;
  actionLabel?: string;
};

export function SecurityNotification({
  firstName = 'there',
  title = 'Security notification',
  message = 'A security-related event occurred on your Cutup account.',
  actionUrl,
  actionLabel = 'Review Account',
}: SecurityNotificationData) {
  return (
    <CutupLayout preview={title}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>Hi {firstName},</EmailText>
      <EmailCard>
        <EmailText style={{ margin: 0 }}>{message}</EmailText>
      </EmailCard>
      {actionUrl ? (
        <Section style={{ margin: '24px 0' }}>
          <EmailButton href={actionUrl}>{actionLabel}</EmailButton>
        </Section>
      ) : null}
      <EmailText muted small style={{ color: BRAND.danger }}>
        If this wasn&apos;t you, contact {SITE.supportEmail} immediately.
      </EmailText>
    </CutupLayout>
  );
}
