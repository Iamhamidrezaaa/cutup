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
    <Section className="email-block-hero">
      <Heading
        as="h1"
        className="email-hero-title email-word-break"
        style={{
          margin: '0 0 16px',
          fontSize: BRAND.heroTitleSize,
          lineHeight: '1.25',
          fontWeight: 700,
          color: BRAND.text,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </Heading>
      {subtitle ? (
        <Text
          className="email-body-text email-word-break"
          style={{
            margin: '0 0 8px',
            fontSize: BRAND.bodySize,
            lineHeight: '1.65',
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
