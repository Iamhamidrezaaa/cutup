import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

export type SubscriptionUpgradedData = {
  firstName?: string;
  planName?: string;
  monthlyCredits?: number;
};

export function SubscriptionUpgraded({
  firstName = 'there',
  planName = 'Pro',
  monthlyCredits,
}: SubscriptionUpgradedData) {
  return (
    <CutupLayout preview={`Welcome to ${planName}`}>
      <EmailHeading>Welcome to {planName}</EmailHeading>
      <EmailText>
        Hi {firstName}, your Cutup plan has been upgraded. You now have access to more processing power
        and premium features.
      </EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Plan:</strong> {planName}
        </EmailText>
        {monthlyCredits != null ? (
          <EmailText style={{ margin: 0 }}>
            <strong>Monthly credits:</strong> {monthlyCredits}
          </EmailText>
        ) : null}
      </EmailCard>
      <Section style={{ margin: '24px 0' }}>
        <EmailButton href={SITE.dashboardUrl}>Start Creating</EmailButton>
      </Section>
    </CutupLayout>
  );
}
