import { Column, Row, Section } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = {
  children: React.ReactNode;
  style?: React.CSSProperties;
};

export function EmailCard({ children, style }: Props) {
  return (
    <Section style={{ margin: 0 }}>
      <Row>
        <Column
          style={{
            paddingLeft: BRAND.padX,
            paddingRight: BRAND.padX,
            paddingBottom: BRAND.cardMarginBottom,
          }}
        >
          <Section
            style={{
              backgroundColor: BRAND.card,
              borderRadius: BRAND.radiusLg,
              border: `1px solid ${BRAND.border}`,
              boxShadow: BRAND.shadowSm,
              margin: 0,
              ...style,
            }}
          >
            <Row>
              <Column style={{ padding: BRAND.cardPad }}>{children}</Column>
            </Row>
          </Section>
        </Column>
      </Row>
    </Section>
  );
}
