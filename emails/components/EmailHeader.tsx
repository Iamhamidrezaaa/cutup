import { Img, Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';

export function EmailHeader() {
  return (
    <Section className="email-pad-x" style={{ padding: `18px ${BRAND.padX} 12px` }}>
      <table cellPadding={0} cellSpacing={0} role="presentation" width="100%" style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td width="32" style={{ verticalAlign: 'middle', width: '32px' }}>
              <Link href={SITE.url} style={{ textDecoration: 'none' }}>
                <Img
                  src={SITE.logoUrl}
                  width="28"
                  height="28"
                  alt="Cutup"
                  style={{ display: 'block', borderRadius: '6px' }}
                />
              </Link>
            </td>
            <td style={{ verticalAlign: 'middle', paddingLeft: '10px' }}>
              <Link href={SITE.url} style={{ textDecoration: 'none' }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: 700,
                    color: BRAND.text,
                    letterSpacing: '-0.02em',
                    lineHeight: '1.2',
                  }}
                >
                  <span style={{ color: BRAND.primary, marginRight: '5px' }}>✦</span>
                  {SITE.name}
                </Text>
              </Link>
              <Text
                style={{
                  margin: '2px 0 0',
                  fontSize: '12px',
                  color: BRAND.textMuted,
                  lineHeight: '1.35',
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
