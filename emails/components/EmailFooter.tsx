import { Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';

const linkStyle = {
  color: BRAND.textMuted,
  textDecoration: 'underline',
  fontSize: '12px',
  lineHeight: '1.4',
} as const;

export function EmailFooter() {
  return (
    <Section className="email-pad-x" style={{ padding: `10px ${BRAND.padX} 24px` }}>
      <table cellPadding={0} cellSpacing={0} role="presentation" width="100%" style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td align="center" style={{ paddingBottom: '12px' }}>
              <table cellPadding={0} cellSpacing={0} role="presentation" align="center">
                <tbody>
                  <tr>
                    <td align="center" style={{ paddingBottom: '4px' }}>
                      <Link
                        href={`mailto:${SITE.supportEmail}`}
                        style={{ ...linkStyle, color: BRAND.primary, textDecoration: 'none', fontSize: '13px' }}
                      >
                        {SITE.supportEmail}
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style={{ paddingBottom: '8px' }}>
                      <Link href={SITE.url} style={{ ...linkStyle, textDecoration: 'none' }}>
                        cutup.shop
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style={{ paddingBottom: '3px' }}>
                      <Link href={SITE.privacyUrl} style={linkStyle}>
                        Privacy Policy
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style={{ paddingBottom: '3px' }}>
                      <Link href={SITE.termsUrl} style={linkStyle}>
                        Terms
                      </Link>
                    </td>
                  </tr>
                  <tr>
                    <td align="center">
                      <Link href={SITE.notificationsUrl} style={linkStyle}>
                        Manage Notifications
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center">
              <Text
                style={{
                  margin: 0,
                  fontSize: '11px',
                  lineHeight: '1.4',
                  color: BRAND.textSubtle,
                  textAlign: 'center',
                }}
              >
                You received this email because you have a Cutup account.
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
