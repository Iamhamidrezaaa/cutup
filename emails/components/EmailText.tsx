import { Section, Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';
import { EmailBlock } from './EmailBlock';

type Props = {
  children: React.ReactNode;
  muted?: boolean;
  small?: boolean;
  style?: React.CSSProperties;
  inset?: boolean;
};

export function EmailText({ children, muted, small, style, inset }: Props) {
  const content = (
    <Text
      className={small ? 'email-meta-text email-word-break' : 'email-body-text email-word-break'}
      style={{
        margin: 0,
        fontSize: small ? BRAND.metaSize : BRAND.bodySize,
        lineHeight: small ? '1.5' : '1.6',
        color: muted ? BRAND.textMuted : BRAND.text,
        ...style,
      }}
    >
      {children}
    </Text>
  );

  if (inset) {
    return <EmailBlock padding={BRAND.insetPad}>{content}</EmailBlock>;
  }

  return <Section style={{ margin: '0 0 16px' }}>{content}</Section>;
}
