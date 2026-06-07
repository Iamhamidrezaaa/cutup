import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  EmailButton,
  EmailCard,
  FeatureList,
  HeroSection,
  PlanBadge,
  StatusBadge,
} from '../components';
import { BRAND, SITE } from '../brand';

export type SubscriptionUpgradedData = {
  firstName?: string;
  planName?: string;
  monthlyCredits?: number;
};

const PLAN_FEATURES: Record<string, string[]> = {
  pro: ['More monthly credits', 'Priority exports', 'Advanced AI features'],
  business: ['Higher limits', 'Priority support', 'Full workspace access'],
  starter: ['Core transcription', 'Standard exports', 'Dashboard access'],
};

export function SubscriptionUpgraded({
  firstName = 'there',
  planName = 'Pro',
  monthlyCredits,
}: SubscriptionUpgradedData) {
  const planKey = String(planName).trim().toLowerCase();
  const features = PLAN_FEATURES[planKey] || PLAN_FEATURES.pro;

  return (
    <CutupLayout preview={`You're now on ${planName}`}>
      <StatusBadge variant="success">Plan upgraded</StatusBadge>
      <HeroSection
        title={`You're now on ${planName}`}
        subtitle={`Hi ${firstName}, your plan is active with more credits and premium features.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        {monthlyCredits != null ? (
          <DetailRow label="Credits included" value={`${monthlyCredits} / month`} />
        ) : null}
        <Text style={{ margin: '10px 0 8px', fontSize: '12px', fontWeight: 600, color: BRAND.textMuted }}>
          Included
        </Text>
        <FeatureList items={features} />
      </EmailCard>
      <EmailButton href={SITE.dashboardUrl}>Start Creating</EmailButton>
    </CutupLayout>
  );
}
