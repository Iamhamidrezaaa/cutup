import { Heading, Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';
import { EmailBlock } from './EmailBlock';

type Props = {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export function HeroSection({ title, subtitle, children }: Props) {
  return (
    <EmailBlock padding={BRAND.heroPad}>
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
    </EmailBlock>
  );
}
