import { Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Variant = 'primary' | 'secondary';

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  /** Centers CTA with max-width — preferred for all templates */
  fullWidth?: boolean;
};

export function EmailButton({ href, children, variant = 'primary' }: Props) {
  const isPrimary = variant === 'primary';
  return (
    <Section className="email-pad-x" style={{ padding: `4px ${BRAND.padX} 24px`, textAlign: 'center' }}>
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
                borderRadius: '14px',
                background: isPrimary ? BRAND.gradient : BRAND.card,
                backgroundColor: isPrimary ? BRAND.primary : BRAND.card,
                border: isPrimary ? 'none' : `1px solid ${BRAND.border}`,
                boxShadow: isPrimary ? BRAND.shadowButton : BRAND.shadowSm,
                padding: '16px 32px',
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
                  lineHeight: '1.2',
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
