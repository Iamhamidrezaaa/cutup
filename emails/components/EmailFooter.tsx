import { Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';
import { useEmailExtras } from '../EmailExtras';
import { EmailDivider } from './EmailDivider';

const linkStyle = {
  color: BRAND.textMuted,
  textDecoration: 'underline',
  fontSize: BRAND.metaSize,
  lineHeight: '1.5',
} as const;

export function EmailFooter() {
  const { unsubscribeUrl, contactEmail } = useEmailExtras();
  const unsub = unsubscribeUrl || `${SITE.url}/unsubscribe.html`;
  const contact = contactEmail || SITE.supportEmail;

  return (
    <Section className="email-block-footer">
      <EmailDivider />
      <Text
        style={{
          margin: '0 0 12px',
          fontSize: BRAND.bodySize,
          lineHeight: '1.6',
          color: BRAND.text,
          textAlign: 'center',
        }}
      >
        <Link
          href={`mailto:${contact}`}
          style={{ color: BRAND.primary, textDecoration: 'none', fontWeight: 500 }}
        >
          {contact}
        </Link>
        <br />
        <Link href={SITE.url} style={{ color: BRAND.textMuted, textDecoration: 'none' }}>
          cutup.shop
        </Link>
        {' · '}
        <Link href={unsub} style={{ color: BRAND.textMuted, textDecoration: 'underline', fontSize: BRAND.metaSize }}>
          Unsubscribe
        </Link>
      </Text>
      <Text
        className="email-footer-links email-meta-text"
        style={{
          margin: '0 0 16px',
          fontSize: BRAND.metaSize,
          lineHeight: '1.6',
          color: BRAND.textMuted,
          textAlign: 'center',
        }}
      >
        <Link href={SITE.privacyUrl} style={linkStyle}>
          Privacy Policy
        </Link>
        {' · '}
        <Link href={SITE.termsUrl} style={linkStyle}>
          Terms of Service
        </Link>
        {' · '}
        <Link href={SITE.faqUrl} style={linkStyle}>
          FAQ
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
