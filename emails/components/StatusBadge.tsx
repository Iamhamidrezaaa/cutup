import { Section, Text } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type Props = {
  children: React.ReactNode;
  variant?: Variant;
};

const VARIANT_STYLES: Record<Variant, { bg: string; text: string }> = {
  success: { bg: BRAND.successBg, text: '#047857' },
  warning: { bg: BRAND.warningBg, text: '#B45309' },
  danger: { bg: BRAND.dangerBg, text: '#B91C1C' },
  info: { bg: BRAND.infoBg, text: '#1D4ED8' },
  neutral: { bg: BRAND.surface, text: BRAND.textMuted },
};

export function StatusBadge({ children, variant = 'neutral' }: Props) {
  const colors = VARIANT_STYLES[variant];
  return (
    <Section style={{ padding: '8px 32px 0' }}>
      <Text
        style={{
          display: 'inline-block',
          margin: '0 0 8px',
          padding: '6px 12px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          backgroundColor: colors.bg,
          color: colors.text,
          lineHeight: '1',
        }}
      >
        {children}
      </Text>
    </Section>
  );
}
