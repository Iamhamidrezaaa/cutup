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
  UsageProgressBar,
} from '../components';
import { BRAND, SITE } from '../brand';

export type UsageWarningData = {
  firstName?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  planName?: string;
  upgradeUrl?: string;
};

export function UsageWarning80({
  firstName = 'there',
  used = 0,
  remaining = 0,
  limit = 0,
  planName = 'Starter',
  upgradeUrl,
}: UsageWarningData) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;

  return (
    <CutupLayout preview="You're approaching your monthly limit">
      <StatusBadge variant="warning">80% used</StatusBadge>
      <HeroSection
        title="You're approaching your monthly limit"
        subtitle={`Hi ${firstName}, you've used most of your monthly credits. Upgrade now to avoid interruptions.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        <UsageProgressBar used={used} limit={limit} label="Monthly usage" />
        <DetailTable>
          <DetailRow label="Used" value={used} />
          <DetailRow label="Remaining" value={remaining} last />
        </DetailTable>
      </EmailCard>
      <EmailButton href={upgrade} fullWidth>
        Upgrade Plan
      </EmailButton>
      <EmailText inset muted small style={{ color: BRAND.warning }}>
        You&apos;re approaching your monthly limit. Credits reset at the start of your billing cycle.
      </EmailText>
    </CutupLayout>
  );
}
