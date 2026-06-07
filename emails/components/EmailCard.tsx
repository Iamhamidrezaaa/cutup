import { Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = { children: React.ReactNode };

export function EmailCard({ children }: Props) {
  return (
    <Section
      style={{
        backgroundColor: BRAND.surface,
        borderRadius: BRAND.radiusLg,
        border: `1px solid ${BRAND.border}`,
        padding: '20px 24px',
        margin: '0 0 24px',
      }}
    >
      {children}
    </Section>
  );
}
