import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  PlanBadge,
  StatusBadge,
  UsageProgressBar,
} from '../components';
import { BRAND, SITE } from '../brand';
import type { UsageWarningData } from './UsageWarning80';

export function UsageWarning100({
  firstName = 'there',
  used = 0,
  remaining = 0,
  limit = 0,
  planName = 'Starter',
  upgradeUrl,
}: UsageWarningData) {
  const upgrade = upgradeUrl || `${SITE.dashboardUrl}#subscription`;

  return (
    <CutupLayout preview="Monthly credits exhausted">
      <StatusBadge variant="danger">Limit reached</StatusBadge>
      <HeroSection
        title="Monthly credits exhausted"
        subtitle={`Hi ${firstName}, you've used all credits on your current plan. Upgrade to continue creating.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        <UsageProgressBar used={used} limit={limit} label="Monthly usage" />
        <DetailRow label="Used" value={used} />
        <DetailRow label="Remaining" value={remaining} last />
      </EmailCard>
      <EmailButton href={upgrade} fullWidth>
        Upgrade Plan
      </EmailButton>
      <EmailText inset muted small style={{ color: BRAND.danger }}>
        Processing is paused until your cycle renews or you upgrade your plan.
      </EmailText>
    </CutupLayout>
  );
}
