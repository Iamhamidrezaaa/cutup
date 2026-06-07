import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { BRAND, SITE } from '../brand';
import type { UsageWarningData } from './UsageWarning80';

export function UsageWarning100({
  firstName = 'there',
  used = 0,
  remaining = 0,
  limit = 0,
  upgradeUrl,
}: UsageWarningData) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;

  return (
    <CutupLayout preview="100% of monthly credits used">
      <EmailHeading>100% of monthly credits used</EmailHeading>
      <EmailText>
        Hi {firstName}, you&apos;ve used all monthly processing credits on your current plan. Upgrade
        to continue generating outputs.
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
      <EmailText muted small style={{ color: BRAND.danger }}>
        Processing is paused until your cycle renews or you upgrade.
      </EmailText>
    </CutupLayout>
  );
}
