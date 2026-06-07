import { Button } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Variant = 'primary' | 'secondary';

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
};

export function EmailButton({ href, children, variant = 'primary' }: Props) {
  const isPrimary = variant === 'primary';
  return (
    <Button
      href={href}
      style={{
        display: 'inline-block',
        padding: '14px 28px',
        borderRadius: BRAND.radius,
        fontSize: '15px',
        fontWeight: 600,
        textDecoration: 'none',
        textAlign: 'center',
        backgroundColor: isPrimary ? BRAND.primary : BRAND.surface,
        color: isPrimary ? '#FFFFFF' : BRAND.text,
        border: isPrimary ? 'none' : `1px solid ${BRAND.border}`,
        boxShadow: isPrimary ? '0 1px 2px rgba(99,91,255,0.24)' : 'none',
      }}
    >
      {children}
    </Button>
  );
}
