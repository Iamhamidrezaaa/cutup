import { Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';
import { EmailDivider } from './EmailDivider';

export function EmailFooter() {
  return (
    <Section style={{ padding: '8px 32px 40px' }}>
      <EmailDivider />
      <Text
        style={{
          margin: '0 0 8px',
          fontSize: '14px',
          lineHeight: '1.6',
          color: BRAND.text,
          textAlign: 'center',
        }}
      >
        <Link href={`mailto:${SITE.supportEmail}`} style={{ color: BRAND.primary, textDecoration: 'none' }}>
          {SITE.supportEmail}
        </Link>
        <br />
        <Link href={SITE.url} style={{ color: BRAND.textMuted, textDecoration: 'none' }}>
          cutup.shop
        </Link>
      </Text>
      <Text
        style={{
          margin: '0 0 16px',
          fontSize: '13px',
          lineHeight: '1.6',
          color: BRAND.textMuted,
          textAlign: 'center',
        }}
      >
        <Link href={SITE.privacyUrl} style={{ color: BRAND.textMuted, textDecoration: 'underline' }}>
          Privacy Policy
        </Link>
        {' · '}
        <Link href={SITE.termsUrl} style={{ color: BRAND.textMuted, textDecoration: 'underline' }}>
          Terms of Service
        </Link>
        {' · '}
        <Link href={SITE.notificationsUrl} style={{ color: BRAND.textMuted, textDecoration: 'underline' }}>
          Manage Notifications
        </Link>
      </Text>
      <Text
        style={{
          margin: 0,
          fontSize: '12px',
          lineHeight: '1.5',
          color: BRAND.textSubtle,
          textAlign: 'center',
        }}
      >
        You received this email because you have a Cutup account.
      </Text>
    </Section>
  );
}
