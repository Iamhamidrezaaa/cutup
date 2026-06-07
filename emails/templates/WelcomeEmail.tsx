import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

export type WelcomeEmailData = {
  firstName?: string;
};

export function WelcomeEmail({ firstName = 'there' }: WelcomeEmailData) {
  const name = String(firstName).trim() || 'there';
  return (
    <CutupLayout preview="Welcome to Cutup — your AI video workspace">
      <EmailHeading>Welcome to Cutup</EmailHeading>
      <EmailText>
        Hi {name}, thanks for joining Cutup. Your AI video workspace is ready — transcribe, translate,
        summarize, and export videos in one place.
      </EmailText>
      <Section style={{ margin: '28px 0' }}>
        <EmailButton href={SITE.dashboardUrl}>Open Dashboard</EmailButton>
      </Section>
      <EmailText muted small>
        Questions? Reply to this email or contact {SITE.supportEmail}.
      </EmailText>
    </CutupLayout>
  );
}
