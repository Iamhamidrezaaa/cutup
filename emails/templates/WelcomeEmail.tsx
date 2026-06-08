import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailButton,
  EmailText,
  HeroSection,
  QuickActions,
  StatusBadge,
} from '../components';
import { SITE } from '../brand';

export type WelcomeEmailData = {
  firstName?: string;
};

export function WelcomeEmail({ firstName = 'there' }: WelcomeEmailData) {
  const name = String(firstName).trim() || 'there';
  return (
    <CutupLayout preview="Welcome to your AI video workspace">
      <StatusBadge variant="success">Welcome</StatusBadge>
      <HeroSection
        title="Welcome to Cutup"
        subtitle={`Hi ${name}, your AI video workspace is ready.`}
      />
      <EmailButton href={SITE.dashboardUrl}>Open Dashboard</EmailButton>
      <QuickActions />
      <EmailText inset muted small>
        Questions? {SITE.supportEmail}
      </EmailText>
    </CutupLayout>
  );
}
