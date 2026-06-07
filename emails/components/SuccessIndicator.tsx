import { Section, Text } from '@react-email/components';
import { BRAND } from '../brand';

type Props = {
  label?: string;
};

export function SuccessIndicator({ label = 'Success' }: Props) {
  return (
    <Section style={{ padding: '0 32px 16px', textAlign: 'center' }}>
      <Text
        style={{
          display: 'inline-block',
          margin: 0,
          width: '48px',
          height: '48px',
          lineHeight: '48px',
          borderRadius: '999px',
          backgroundColor: BRAND.successBg,
          color: BRAND.success,
          fontSize: '22px',
          fontWeight: 700,
        }}
      >
        ✓
      </Text>
      {label ? (
        <Text
          style={{
            margin: '12px 0 0',
            fontSize: '13px',
            fontWeight: 600,
            color: BRAND.success,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
      ) : null}
    </Section>
  );
}
