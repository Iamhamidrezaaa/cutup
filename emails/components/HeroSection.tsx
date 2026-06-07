import { Heading, Section, Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export function HeroSection({ title, subtitle, children }: Props) {
  return (
    <Section
      className="email-pad-x email-hero-section"
      style={{ padding: `${BRAND.heroPadTop} ${BRAND.padX} ${BRAND.heroPadBottom}` }}
    >
      <Heading
        as="h1"
        className="email-hero-title"
        style={{
          margin: '0 0 12px',
          fontSize: BRAND.heroTitleSize,
          lineHeight: '1.15',
          fontWeight: 700,
          color: BRAND.text,
          letterSpacing: '-0.035em',
        }}
      >
        {title}
      </Heading>
      {subtitle ? (
        <Text
          className="email-body-text"
          style={{
            margin: '0 0 20px',
            fontSize: BRAND.bodySize,
            lineHeight: '1.6',
            color: BRAND.textMuted,
          }}
        >
          {subtitle}
        </Text>
      ) : null}
      {children}
    </Section>
  );
}
