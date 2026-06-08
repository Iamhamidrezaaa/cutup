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

export type AccountDeletionCompletedData = {
  firstName?: string;
  cooldownDays?: number;
};

export function AccountDeletionCompleted({
  firstName = 'there',
  cooldownDays = 30,
}: AccountDeletionCompletedData) {
  return (
    <CutupLayout preview="Your Cutup account has been deleted">
      <StatusBadge variant="neutral">Account deleted</StatusBadge>
      <HeroSection
        title="Your account has been deleted"
        subtitle={`Hi ${firstName}, your Cutup account and associated data have been permanently removed.`}
      />
      <EmailCard>
        <Text className="email-card-body-text" style={{ margin: '0 0 10px' }}>
          • Your account is no longer available.
        </Text>
        <Text className="email-card-body-text" style={{ margin: 0 }}>
          • The same email address is locked for <strong>{cooldownDays} days</strong> and cannot be
          used to register a new account during this period.
        </Text>
      </EmailCard>
      <EmailButton href={SITE.supportHomeUrl} variant="secondary">
        Contact Support
      </EmailButton>
      <EmailText inset muted small>
        If you believe this was a mistake, contact {SITE.supportEmail} as soon as possible.
      </EmailText>
    </CutupLayout>
  );
}
