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
  const cancel = cancelUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview="Account deletion scheduled">
      <StatusBadge variant="danger">Deletion scheduled</StatusBadge>
      <HeroSection
        title="Account deletion scheduled"
        subtitle={`Hi ${firstName}, we received your request. Your account is scheduled for permanent deletion.`}
      />
      <EmailCard>
        <Text style={{ margin: '0 0 12px', fontSize: '15px', lineHeight: '1.6', color: BRAND.text }}>
          <strong>Countdown:</strong> {cooldownDays}-day email lockout after deletion is confirmed.
        </Text>
        <Text style={{ margin: '0 0 12px', fontSize: '15px', lineHeight: '1.6', color: BRAND.text }}>
          • Your account and data will be permanently removed once confirmed.
        </Text>
        <Text style={{ margin: '0 0 12px', fontSize: '15px', lineHeight: '1.6', color: BRAND.text }}>
          • The same email cannot register a new account for <strong>{cooldownDays} days</strong>.
        </Text>
        <Text style={{ margin: 0, fontSize: '15px', lineHeight: '1.6', color: BRAND.text }}>
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
      <EmailButton href={`mailto:${SITE.supportEmail}`} variant="secondary">
        Contact Support
      </EmailButton>
      <EmailText inset muted small style={{ color: BRAND.danger }}>
        Didn&apos;t request this? Email {SITE.supportEmail} immediately.
      </EmailText>
    </CutupLayout>
  );
}
