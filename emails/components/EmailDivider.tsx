import { Hr } from '@react-email/components';
import { BRAND } from '../brand';

export function EmailDivider() {
  return (
    <Hr
      style={{
        borderColor: BRAND.border,
        borderWidth: '1px',
        margin: '28px 0',
      }}
    />
  );
}
