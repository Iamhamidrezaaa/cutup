import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  DetailTable,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  PlanBadge,
  StatusBadge,
} from '../components';
import { BRAND } from '../brand';

export type SubscriptionExpiredData = {
  firstName?: string;
  planName?: string;
  amount?: string;
  payUrl?: string;
};

export function SubscriptionExpired({
  firstName = 'there',
  planName = 'Pro',
  amount = '€19.00',
  payUrl,
}: SubscriptionExpiredData) {
  const pay = payUrl || '';

  return (
    <CutupLayout preview="Your subscription has ended — renew to keep access">
      <StatusBadge variant="warning">Subscription ended</StatusBadge>
      <HeroSection
        title="Your subscription has ended"
        subtitle={`Hi ${firstName}, your ${planName} plan is no longer active. Renew now to restore exports and monthly credits.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        <DetailTable>
          <DetailRow label="Plan" value={planName} />
          <DetailRow label="Renewal amount" value={amount} last />
        </DetailTable>
      </EmailCard>
      {pay ? (
        <EmailButton href={pay} fullWidth>
          Renew subscription
        </EmailButton>
      ) : null}
      <EmailText inset muted small style={{ color: BRAND.warning }}>
        This link opens your billing dashboard. Sign in if prompted, then complete payment to renew.
      </EmailText>
    </CutupLayout>
  );
}
