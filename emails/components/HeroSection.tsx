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
    <Section style={{ padding: '0 32px 8px' }}>
      <Heading
        as="h1"
        style={{
          margin: '0 0 12px',
          fontSize: '32px',
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
          style={{
            margin: '0 0 20px',
            fontSize: '17px',
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
