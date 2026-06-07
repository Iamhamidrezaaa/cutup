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
    <Section style={{ padding: inset ? '0 32px' : 0, margin: '0 0 16px' }}>
      <Text
        style={{
          margin: 0,
          fontSize: small ? '14px' : '16px',
          lineHeight: '1.65',
          color: muted ? BRAND.textMuted : BRAND.text,
          ...style,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}
