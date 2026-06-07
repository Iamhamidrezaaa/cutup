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
      className="email-card-outer"
      style={{
        margin: `0 ${BRAND.padX} ${BRAND.cardMarginBottom}`,
        ...style,
      }}
    >
      <Section
        className="email-card-inner"
        style={{
          backgroundColor: BRAND.card,
          borderRadius: BRAND.radiusLg,
          border: `1px solid ${BRAND.border}`,
          boxShadow: BRAND.shadowSm,
          padding: BRAND.cardPad,
        }}
      >
        {children}
      </Section>
    </Section>
  );
}
