import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
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
    <CutupLayout preview="Your Cutup account deletion request">
      <EmailHeading>Your Cutup account deletion request</EmailHeading>
      <EmailText>
        Hi {firstName}, we received a request to delete your Cutup account. Your account is scheduled
        for deletion.
      </EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 12px' }}>
          • Your account will be permanently deleted once confirmed.
        </EmailText>
        <EmailText style={{ margin: '0 0 12px' }}>
          • You cannot create another account using the same email for{' '}
          <strong>{cooldownDays} days</strong> after deletion.
        </EmailText>
        <EmailText style={{ margin: 0 }}>
          • If you did not request this, contact support immediately.
        </EmailText>
      </EmailCard>
      <Section style={{ margin: '24px 0 16px' }}>
        <EmailButton href={cancel}>Cancel Deletion</EmailButton>
      </Section>
      {confirmDeletionUrl ? (
        <Section style={{ margin: '0 0 16px' }}>
          <EmailButton href={confirmDeletionUrl} variant="secondary">
            Confirm Deletion
          </EmailButton>
        </Section>
      ) : null}
      <EmailText muted small style={{ color: BRAND.danger }}>
        Didn&apos;t request this? Email{' '}
        <a href={`mailto:${SITE.supportEmail}`} style={{ color: BRAND.primary }}>
          {SITE.supportEmail}
        </a>{' '}
        immediately.
      </EmailText>
    </CutupLayout>
  );
}
