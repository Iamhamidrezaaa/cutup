import { Img, Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';

export function EmailHeader() {
  return (
    <Section className="email-block-header">
      <table cellPadding={0} cellSpacing={0} role="presentation" width="100%" style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: 'middle', width: '40px' }}>
              <Link href={SITE.url} style={{ textDecoration: 'none', display: 'block' }}>
                <Img
                  src={SITE.logoUrl}
                  width="32"
                  height="32"
                  alt="Cutup"
                  style={{ display: 'block', borderRadius: '8px' }}
                />
              </Link>
            </td>
            <td style={{ verticalAlign: 'middle', paddingLeft: '12px' }}>
              <Link href={SITE.url} style={{ textDecoration: 'none' }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: '20px',
                    fontWeight: 700,
                    color: BRAND.text,
                    letterSpacing: '-0.03em',
                    lineHeight: '1.2',
                  }}
                >
                  <span style={{ color: BRAND.primary, marginRight: '6px' }}>✦</span>
                  {SITE.name}
                </Text>
              </Link>
              <Text
                style={{
                  margin: '6px 0 0',
                  fontSize: BRAND.metaSize,
                  color: BRAND.textMuted,
                  letterSpacing: '0.01em',
                  lineHeight: '1.4',
                }}
              >
                {SITE.tagline}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
