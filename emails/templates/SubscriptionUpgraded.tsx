import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  EmailButton,
  EmailCard,
  FeatureList,
  HeroSection,
  PlanBadge,
  QuickActions,
  StatusBadge,
} from '../components';
import { BRAND } from '../brand';
import { SITE } from '../brand';

export type SubscriptionUpgradedData = {
  firstName?: string;
  planName?: string;
  monthlyCredits?: number;
};

const PLAN_FEATURES: Record<string, string[]> = {
  pro: [
    'Higher monthly processing credits',
    'Priority export queue',
    'Advanced AI translation & summaries',
  ],
  business: [
    'Team-ready processing limits',
    'Priority support & faster exports',
    'Full AI workspace features',
  ],
  starter: ['Core transcription tools', 'Standard export quality', 'Dashboard access'],
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
        subtitle={`Hi ${firstName}, your workspace has been upgraded. Enjoy more power, faster exports, and premium AI features.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        {monthlyCredits != null ? (
          <DetailRow label="Credits included" value={`${monthlyCredits} / month`} />
        ) : null}
        <Text style={{ margin: '16px 0 12px', fontSize: '13px', fontWeight: 600, color: BRAND.textMuted }}>
          What&apos;s included
        </Text>
        <FeatureList items={features} />
      </EmailCard>
      <EmailButton href={SITE.dashboardUrl} fullWidth>
        Start Creating
      </EmailButton>
      <QuickActions />
    </CutupLayout>
  );
}
