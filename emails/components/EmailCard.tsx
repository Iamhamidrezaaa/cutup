import { Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function EmailCard({ children, style }: Props) {
  return (
    <Section
      style={{
        backgroundColor: BRAND.card,
        borderRadius: BRAND.radiusLg,
        border: `1px solid ${BRAND.border}`,
        boxShadow: BRAND.shadowSm,
        padding: '24px',
        margin: '0 32px 24px',
        ...style,
      }}
    >
      {children}
    </Section>
  );
}
