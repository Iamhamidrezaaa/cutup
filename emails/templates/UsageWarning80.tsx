import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { BRAND, SITE } from '../brand';

export type UsageWarningData = {
  firstName?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  upgradeUrl?: string;
};

export function UsageWarning80({
  firstName = 'there',
  used = 0,
  remaining = 0,
  limit = 0,
  upgradeUrl,
}: UsageWarningData) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;

  return (
    <CutupLayout preview="80% of monthly credits used">
      <EmailHeading>80% of monthly credits used</EmailHeading>
      <EmailText>
        Hi {firstName}, you&apos;ve used most of your monthly processing credits. Consider upgrading
        to avoid interruptions.
      </EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Used:</strong> {used}
        </EmailText>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Remaining:</strong> {remaining}
        </EmailText>
        <EmailText style={{ margin: 0 }}>
          <strong>Limit:</strong> {limit}
        </EmailText>
      </EmailCard>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={upgrade}>Upgrade Plan</EmailButton>
      </Section>
      <EmailText muted small style={{ color: BRAND.warning }}>
        You&apos;re approaching your monthly limit.
      </EmailText>
    </CutupLayout>
  );
}
