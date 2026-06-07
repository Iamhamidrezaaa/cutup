import { Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Variant = 'primary' | 'secondary';

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  /** @deprecated All CTAs are centered with max-width 280px for mobile safety */
  fullWidth?: boolean;
};

export function EmailButton({ href, children, variant = 'primary' }: Props) {
  const isPrimary = variant === 'primary';
  return (
    <Section className="email-pad-x" style={{ padding: `0 ${BRAND.padX} 10px`, textAlign: 'center' }}>
      <table
        cellPadding={0}
        cellSpacing={0}
        role="presentation"
        align="center"
        style={{
          margin: '0 auto',
          maxWidth: BRAND.buttonMaxWidth,
          width: '100%',
        }}
      >
        <tbody>
          <tr>
            <td
              align="center"
              style={{
                borderRadius: BRAND.radius,
                backgroundColor: isPrimary ? BRAND.primary : BRAND.card,
                border: isPrimary ? 'none' : `1px solid ${BRAND.border}`,
                padding: '13px 20px',
              }}
            >
              <a
                href={href}
                style={{
                  display: 'block',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: isPrimary ? '#FFFFFF' : BRAND.text,
                  textDecoration: 'none',
                  lineHeight: '1.3',
                  textAlign: 'center',
                  fontFamily: BRAND.fontFamily,
                }}
              >
                {children}
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
