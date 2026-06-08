import { Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';
import { EmailBlock } from './EmailBlock';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Props = {
  children: React.ReactNode;
  variant?: Variant;
  inline?: boolean;
};

const VARIANT_STYLES: Record<Variant, { bg: string; text: string }> = {
  success: { bg: BRAND.successBg, text: '#047857' },
  warning: { bg: BRAND.warningBg, text: '#B45309' },
  danger: { bg: BRAND.dangerBg, text: '#B91C1C' },
  info: { bg: BRAND.infoBg, text: '#1D4ED8' },
  neutral: { bg: BRAND.surface, text: BRAND.textMuted },
};

export function StatusBadge({ children, variant = 'neutral', inline = false }: Props) {
  const colors = VARIANT_STYLES[variant];
  const badge = (
    <Text
      style={{
        display: 'inline-block',
        margin: inline ? '0 0 16px' : 0,
        padding: '7px 14px',
        borderRadius: '999px',
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        backgroundColor: colors.bg,
        color: colors.text,
        lineHeight: '1',
      }}
    >
      {children}
    </Text>
  );
  if (inline) return badge;
  return <EmailBlock padding={BRAND.badgePad}>{badge}</EmailBlock>;
}
