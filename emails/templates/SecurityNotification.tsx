import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  StatusBadge,
} from '../components';
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
  const action = actionUrl || SITE.profileUrl;

  return (
    <CutupLayout preview={title}>
      <StatusBadge variant="danger">Security alert</StatusBadge>
      <HeroSection title={title} subtitle={`Hi ${firstName}, we detected activity on your account that needs your attention.`} />
      <EmailCard>
        <Text className="email-card-body-text email-word-break" style={{ margin: 0 }}>
          {message}
        </Text>
      </EmailCard>
      <EmailButton href={action} fullWidth>
        {actionLabel}
      </EmailButton>
      <EmailText inset muted small style={{ color: BRAND.danger }}>
        If this wasn&apos;t you, contact {SITE.supportEmail} immediately.
      </EmailText>
    </CutupLayout>
  );
}
