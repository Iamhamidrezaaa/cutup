import { Hr, Section } from '@react-email/components';
import { BRAND } from '../brand';

export function EmailDivider() {
  return (
    <Section className="email-pad-x" style={{ padding: `0 ${BRAND.padX}` }}>
      <Hr
        style={{
          borderColor: BRAND.border,
          borderWidth: '1px',
          margin: '12px 0',
        }}
      />
    </Section>
  );
}
