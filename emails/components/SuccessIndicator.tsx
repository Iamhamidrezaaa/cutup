import { Section, Text } from '@react-email/components';
import { BRAND } from '../brand';

type Props = {
  label?: string;
};

export function SuccessIndicator({ label = 'Success' }: Props) {
  return (
    <Section className="email-pad-x" style={{ padding: `0 ${BRAND.padX} 8px`, textAlign: 'center' }}>
      <table cellPadding={0} cellSpacing={0} role="presentation" align="center">
        <tbody>
          <tr>
            <td align="center">
              <Text
                style={{
                  display: 'inline-block',
                  margin: 0,
                  width: '36px',
                  height: '36px',
                  lineHeight: '36px',
                  borderRadius: '999px',
                  backgroundColor: BRAND.successBg,
                  color: BRAND.success,
                  fontSize: '18px',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                ✓
              </Text>
            </td>
          </tr>
          {label ? (
            <tr>
              <td align="center" style={{ paddingTop: '6px' }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: '11px',
                    fontWeight: 600,
                    color: BRAND.success,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </Text>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Section>
  );
}
