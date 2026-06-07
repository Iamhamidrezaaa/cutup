import { Img, Link, Section, Text } from '@react-email/components';
import { BRAND, SITE } from '../brand';

export function EmailHeader() {
  return (
    <Section style={{ padding: '32px 24px 8px', textAlign: 'left' }}>
      <table cellPadding={0} cellSpacing={0} style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: 'middle' }}>
              <Link href={SITE.url} style={{ textDecoration: 'none' }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: '22px',
                    fontWeight: 800,
                    color: BRAND.primary,
                    letterSpacing: '-0.03em',
                  }}
                >
                  Cutup
                </Text>
              </Link>
            </td>
          </tr>
          <tr>
            <td>
              <Text
                style={{
                  margin: '4px 0 0',
                  fontSize: '13px',
                  color: BRAND.textMuted,
                  letterSpacing: '0.02em',
                }}
              >
                {SITE.tagline}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
      <Img
        src={`${SITE.url}/icons/icon128.png`}
        width="0"
        height="0"
        alt=""
        style={{ display: 'none' }}
      />
    </Section>
  );
}
