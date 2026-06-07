import { Section, Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  children: React.ReactNode;
  muted?: boolean;
  small?: boolean;
  style?: React.CSSProperties;
  inset?: boolean;
};

export function EmailText({ children, muted, small, style, inset }: Props) {
  return (
    <Section
      className={inset ? 'email-pad-x' : undefined}
      style={{ padding: inset ? `0 ${BRAND.padX}` : 0, margin: '0 0 12px' }}
    >
      <Text
        className="email-body-text email-word-break"
        style={{
          margin: 0,
          fontSize: small ? '14px' : BRAND.bodySize,
          lineHeight: '1.5',
          color: muted ? BRAND.textMuted : BRAND.text,
          ...style,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}
