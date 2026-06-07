import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
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
    <CutupLayout preview="Payment received — thank you">
      <EmailHeading>Payment received</EmailHeading>
      <EmailText>Hi {firstName}, we received your payment. Thank you for supporting Cutup.</EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Plan:</strong> {planName}
        </EmailText>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Amount:</strong> {amount}
        </EmailText>
        <EmailText style={{ margin: 0 }}>
          <strong>Date:</strong> {dateLabel}
        </EmailText>
      </EmailCard>
      {invoiceUrl ? (
        <Section style={{ margin: '20px 0' }}>
          <EmailButton href={invoiceUrl}>View Invoice</EmailButton>
        </Section>
      ) : null}
      <EmailText muted small>
        Billing questions? Contact {SITE.supportEmail}.
      </EmailText>
    </CutupLayout>
  );
}
