import { Text } from '@react-email/components';
import { BRAND } from '../brand';
import { EmailBlock } from './EmailBlock';

type Props = {
  label?: string;
};

export function SuccessIndicator({ label = 'Success' }: Props) {
  return (
    <EmailBlock padding={`12px 40px 8px`} style={{ textAlign: 'center' }}>
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
          textAlign: 'center',
        }}
      >
        ✓
      </Text>
      {label ? (
        <Text
          style={{
            margin: '12px 0 0',
            fontSize: BRAND.metaSize,
            fontWeight: 600,
            color: BRAND.success,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          {label}
        </Text>
      ) : null}
    </EmailBlock>
  );
}
