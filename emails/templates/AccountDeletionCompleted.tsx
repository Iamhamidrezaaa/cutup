import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

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
      <EmailHeading>Your Cutup account has been deleted</EmailHeading>
      <EmailText>Hi {firstName}, your Cutup account and associated data have been permanently removed.</EmailText>
      <EmailText>
        • Your account is no longer available.
        <br />• The same email address is locked for <strong>{cooldownDays} days</strong> and cannot
        be used to register a new account during this period.
      </EmailText>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={`mailto:${SITE.supportEmail}`} variant="secondary">
          Contact Support
        </EmailButton>
      </Section>
      <EmailText muted small>
        If you believe this was a mistake, contact {SITE.supportEmail} as soon as possible.
      </EmailText>
    </CutupLayout>
  );
}
