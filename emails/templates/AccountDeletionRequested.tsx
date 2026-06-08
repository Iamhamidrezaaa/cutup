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

export type AccountDeletionRequestedData = {
  firstName?: string;
  cancelUrl?: string;
  confirmDeletionUrl?: string;
  cooldownDays?: number;
};

export function AccountDeletionRequested({
  firstName = 'there',
  cancelUrl,
  confirmDeletionUrl,
  cooldownDays = 30,
}: AccountDeletionRequestedData) {
  const cancel = cancelUrl || SITE.profileUrl;

  return (
    <CutupLayout preview="Account deletion scheduled">
      <StatusBadge variant="danger">Deletion scheduled</StatusBadge>
      <HeroSection
        title="Account deletion scheduled"
        subtitle={`Hi ${firstName}, we received your request. Your account is scheduled for permanent deletion.`}
      />
      <EmailCard>
        <Text className="email-card-body-text" style={{ margin: '0 0 14px' }}>
          <strong>Countdown:</strong> {cooldownDays}-day email lockout after deletion is confirmed.
        </Text>
        <Text className="email-card-body-text" style={{ margin: '0 0 10px' }}>
          • Your account and data will be permanently removed once confirmed.
        </Text>
        <Text className="email-card-body-text" style={{ margin: '0 0 10px' }}>
          • The same email cannot register a new account for <strong>{cooldownDays} days</strong>.
        </Text>
        <Text className="email-card-body-text" style={{ margin: 0 }}>
          • Changed your mind? Cancel below before deletion completes.
        </Text>
      </EmailCard>
      <EmailButton href={cancel} fullWidth>
        Cancel Deletion
      </EmailButton>
      {confirmDeletionUrl ? (
        <EmailButton href={confirmDeletionUrl} variant="secondary">
          Confirm Deletion
        </EmailButton>
      ) : null}
      <EmailButton href={SITE.supportHomeUrl} variant="secondary">
        Contact Support
      </EmailButton>
      <EmailText inset muted small style={{ color: BRAND.danger }}>
        Didn&apos;t request this? Email {SITE.supportEmail} immediately.
      </EmailText>
    </CutupLayout>
  );
}
