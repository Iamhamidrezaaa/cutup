import { Button, Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Variant = 'primary' | 'secondary';

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  fullWidth?: boolean;
};

export function EmailButton({ href, children, variant = 'primary', fullWidth }: Props) {
  const isPrimary = variant === 'primary';
  return (
    <Section style={{ margin: '0 32px 16px', textAlign: fullWidth ? 'center' : 'left' }}>
      <Button
        href={href}
        style={{
          display: fullWidth ? 'block' : 'inline-block',
          width: fullWidth ? '100%' : 'auto',
          padding: '16px 32px',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: 600,
          textDecoration: 'none',
          textAlign: 'center',
          backgroundColor: isPrimary ? BRAND.primary : BRAND.card,
          background: isPrimary ? BRAND.gradient : BRAND.card,
          color: isPrimary ? '#FFFFFF' : BRAND.text,
          border: isPrimary ? 'none' : `1px solid ${BRAND.border}`,
          boxShadow: isPrimary ? '0 4px 14px rgba(99, 91, 255, 0.28)' : BRAND.shadowSm,
          lineHeight: '1.2',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}
