import { Hr, Section } from '@react-email/components';
import { BRAND } from '../brand';

export function EmailDivider() {
  return (
    <Section style={{ padding: '0 32px' }}>
      <Hr
        style={{
          borderColor: BRAND.border,
          borderWidth: '1px',
          margin: '24px 0',
        }}
      />
    </Section>
  );
}
