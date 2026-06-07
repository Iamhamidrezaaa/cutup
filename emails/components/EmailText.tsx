import { Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  children: React.ReactNode;
  muted?: boolean;
  small?: boolean;
  style?: React.CSSProperties;
};

export function EmailText({ children, muted, small, style }: Props) {
  return (
    <Text
      style={{
        margin: '0 0 16px',
        fontSize: small ? '14px' : '16px',
        lineHeight: '1.6',
        color: muted ? BRAND.textMuted : BRAND.text,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
