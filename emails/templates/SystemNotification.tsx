import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailButton,
  EmailCard,
  HeroSection,
  StatusBadge,
} from '../components';
import { BRAND } from '../brand';
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
      <StatusBadge variant="info">System update</StatusBadge>
      <HeroSection title={title} subtitle={`Hi ${firstName}, here's an important update from Cutup.`} />
      <EmailCard>
        <Text style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: '1.65', color: BRAND.text }}>
          {message || '—'}
        </Text>
      </EmailCard>
      <EmailButton href={ctaUrl || SITE.dashboardUrl} fullWidth>
        {ctaLabel}
      </EmailButton>
    </CutupLayout>
  );
}
