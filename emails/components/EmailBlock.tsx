import { Column, Row, Section } from '@react-email/components';
import * as React from 'react';

type Props = {
  children: React.ReactNode;
  /** CSS padding shorthand applied on <td> — email-safe */
  padding: string;
  style?: React.CSSProperties;
};

/**
 * Email-safe padded section. React Email puts Section styles on <table> where
 * padding is ignored; Column renders a <td> that respects padding everywhere.
 */
export function EmailBlock({ children, padding, style }: Props) {
  return (
    <Section style={{ margin: 0 }}>
      <Row>
        <Column style={{ padding, margin: 0, ...style }}>{children}</Column>
      </Row>
    </Section>
  );
}
