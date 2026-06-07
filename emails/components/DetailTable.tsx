import { Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  children: React.ReactNode;
};

/** Inner inset so detail row borders never touch the card edge. */
export function DetailTable({ children }: Props) {
  return (
    <Section
      className="email-detail-wrap"
      style={{
        padding: BRAND.detailWrapPad,
        marginTop: '4px',
      }}
    >
      {children}
    </Section>
  );
}
