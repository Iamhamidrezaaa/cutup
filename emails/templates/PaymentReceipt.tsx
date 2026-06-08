import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  DetailTable,
  EmailButton,
  EmailCard,
  EmailText,
  HeroSection,
  PlanBadge,
  SuccessIndicator,
} from '../components';
import { SITE } from '../brand';

export type PaymentReceiptData = {
  firstName?: string;
  amount?: string;
  planName?: string;
  paymentDate?: string;
  invoiceUrl?: string;
};

export function PaymentReceipt({
  firstName = 'there',
  amount = '—',
  planName = 'Cutup',
  paymentDate,
  invoiceUrl,
}: PaymentReceiptData) {
  const dateLabel = paymentDate || new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });

  return (
    <CutupLayout preview="Payment confirmed">
      <SuccessIndicator label="Paid" />
      <HeroSection
        title="Payment confirmed"
        subtitle={`Hi ${firstName}, thank you.`}
      />
      <EmailCard>
        <PlanBadge plan={planName} />
        <DetailTable>
          <DetailRow label="Amount" value={amount} />
          <DetailRow label="Plan" value={planName} />
          <DetailRow label="Billing date" value={dateLabel} last />
        </DetailTable>
      </EmailCard>
      {invoiceUrl ? <EmailButton href={invoiceUrl}>View Invoice</EmailButton> : null}
      <EmailText inset muted small>
        Billing questions? {SITE.billingEmail}
      </EmailText>
    </CutupLayout>
  );
}
