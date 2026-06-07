import { Section, Text } from '@react-email/components';
import { BRAND } from '../brand';

type Props = {
  used: number;
  limit: number;
  label?: string;
};

export function UsageProgressBar({ used, limit, label }: Props) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor = pct >= 100 ? BRAND.danger : pct >= 80 ? BRAND.warning : BRAND.primary;

  return (
    <Section style={{ margin: '0 0 16px' }}>
      {label ? (
        <Text
          style={{
            margin: '0 0 8px',
            fontSize: '13px',
            color: BRAND.textMuted,
            fontWeight: 500,
          }}
        >
          {label}
        </Text>
      ) : null}
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
        <tbody>
          <tr>
            <td
              style={{
                backgroundColor: BRAND.surface,
                borderRadius: '999px',
                padding: '0',
                height: '10px',
              }}
            >
              <table
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ width: `${pct}%`, minWidth: pct > 0 ? '8px' : '0' }}
              >
                <tbody>
                  <tr>
                    <td
                      style={{
                        backgroundColor: barColor,
                        borderRadius: '999px',
                        height: '10px',
                        fontSize: '0',
                        lineHeight: '0',
                      }}
                    >
                      &nbsp;
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
      <Text
        style={{
          margin: '8px 0 0',
          fontSize: '13px',
          color: BRAND.textMuted,
        }}
      >
        {used} of {limit} credits used ({pct}%)
      </Text>
    </Section>
  );
}
