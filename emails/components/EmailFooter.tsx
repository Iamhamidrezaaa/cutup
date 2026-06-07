import { Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';
import { EmailDivider } from './EmailDivider';

export function EmailFooter() {
  return (
    <Section style={{ padding: '8px 24px 40px' }}>
      <EmailDivider />
      <Text
        style={{
          margin: '0 0 12px',
          fontSize: '13px',
          lineHeight: '1.5',
          color: BRAND.textMuted,
          textAlign: 'center',
        }}
      >
        <Link href={`mailto:${SITE.supportEmail}`} style={{ color: BRAND.primary }}>
          {SITE.supportEmail}
        </Link>
        {' · '}
        <Link href={SITE.privacyUrl} style={{ color: BRAND.textMuted }}>
          Privacy Policy
        </Link>
        {' · '}
        <Link href={SITE.termsUrl} style={{ color: BRAND.textMuted }}>
          Terms
        </Link>
        {' · '}
        <Link href={SITE.dashboardUrl} style={{ color: BRAND.textMuted }}>
          Dashboard
        </Link>
      </Text>
      <Text
        style={{
          margin: 0,
          fontSize: '12px',
          color: BRAND.textSubtle,
          textAlign: 'center',
        }}
      >
        © {new Date().getFullYear()} Cutup — AI Video Workspace
      </Text>
    </Section>
  );
}
