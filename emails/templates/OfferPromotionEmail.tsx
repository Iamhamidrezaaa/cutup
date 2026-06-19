import { Text } from '@react-email/components';
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

export type OfferUpgradeHighlight = {
  bold: string;
  rest?: string;
};

export type OfferPromotionEmailData = {
  firstName?: string;
  sourcePlanName?: string;
  targetPlanName?: string;
  discountLabel?: string;
  couponCode?: string;
  expiresLabel?: string;
  campaignTitle?: string;
  checkoutUrl?: string;
  upgradeHighlights?: OfferUpgradeHighlight[];
};

function UpgradeHighlights({ items }: { items: OfferUpgradeHighlight[] }) {
  if (!items?.length) return null;
  return (
    <>
      <Text
        style={{
          margin: '0 0 10px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: BRAND.textMuted,
        }}
      >
        What you'll unlock
      </Text>
      {items.map((item) => (
        <Text
          key={`${item.bold}-${item.rest || ''}`}
          className="email-word-break"
          style={{
            margin: '0 0 8px',
            fontSize: '14px',
            lineHeight: '1.5',
            color: BRAND.text,
          }}
        >
          <span style={{ color: BRAND.primary, marginRight: '6px' }}>✦</span>
          <strong style={{ fontWeight: 700, color: BRAND.text }}>{item.bold}</strong>
          {item.rest || ''}
        </Text>
      ))}
    </>
  );
}

export function OfferPromotionEmail({
  firstName = 'there',
  sourcePlanName = 'Free',
  targetPlanName = 'Pro',
  discountLabel = '20% off',
  couponCode = 'CUTUPOFFER',
  expiresLabel = 'No expiry date',
  campaignTitle = 'Special upgrade offer',
  checkoutUrl = '',
  upgradeHighlights = [],
}: OfferPromotionEmailData) {
  const name = String(firstName).trim() || 'there';
  const highlights = upgradeHighlights?.length
    ? upgradeHighlights
    : [
        { bold: '35 videos per month', rest: ' — up from 3 on Free' },
        { bold: 'AI Translation', rest: ' for multilingual captions' },
        { bold: 'MP4 export', rest: ' with burned-in captions' },
        { bold: 'Premium caption styles', rest: ' built for short-form creators' },
      ];

  return (
    <CutupLayout preview={`${discountLabel} to upgrade to ${targetPlanName}`}>
      <StatusBadge variant="success">Special offer</StatusBadge>
      <HeroSection
        title={`A ${discountLabel} upgrade is waiting for you`}
        subtitle={`Hi ${name}, we reserved a limited-time offer so you can move from ${sourcePlanName} to ${targetPlanName} and unlock more creative power.`}
      />
      <EmailCard>
        <PlanBadge plan={targetPlanName} />
        <EmailText muted small style={{ margin: '0 0 12px', fontSize: '13px' }}>
          {campaignTitle}
        </EmailText>
        <DetailTable>
          <DetailRow label="Your current plan" value={sourcePlanName} />
          <DetailRow label="Upgrade to" value={targetPlanName} />
          <DetailRow label="Your discount" value={discountLabel} />
          <DetailRow label="Coupon code" value={couponCode} />
          <DetailRow label="Offer expires" value={expiresLabel} last />
        </DetailTable>
        <UpgradeHighlights items={highlights} />
      </EmailCard>
      {checkoutUrl ? (
        <EmailButton href={checkoutUrl} fullWidth>
          Upgrade to {targetPlanName} — {discountLabel}
        </EmailButton>
      ) : null}
      <EmailText inset muted small>
        Sign in with the same email address that received this message. Your coupon will be applied automatically at checkout.
        Questions? Reply or contact billing@cutup.shop
      </EmailText>
    </CutupLayout>
  );
}
