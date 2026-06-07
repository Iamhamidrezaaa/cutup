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
      <StatusBadge variant="success">Welcome aboard</StatusBadge>
      <HeroSection
        title="Welcome to your AI video workspace"
        subtitle={`Hi ${name}, your Cutup account is ready. Transcribe, translate, summarize, and export videos — all in one premium workspace.`}
      />
      <EmailButton href={SITE.dashboardUrl} fullWidth>
        Open Dashboard
      </EmailButton>
      <QuickActions />
      <EmailText inset muted small>
        Need help getting started? Reply to this email or reach us at {SITE.supportEmail}.
      </EmailText>
    </CutupLayout>
  );
}
