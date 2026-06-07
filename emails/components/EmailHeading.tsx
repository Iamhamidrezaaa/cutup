import { Heading } from '@react-email/components';
import * as React from 'react';
import { BRAND } from '../brand';

type Props = { children: React.ReactNode; as?: 'h1' | 'h2' | 'h3' };

export function EmailHeading({ children, as = 'h1' }: Props) {
  const size = as === 'h1' ? '28px' : as === 'h2' ? '22px' : '18px';
  return (
    <Heading
      as={as}
      style={{
        margin: '0 0 16px',
        fontSize: size,
        lineHeight: '1.25',
        fontWeight: 700,
        color: BRAND.text,
        letterSpacing: '-0.02em',
      }}
    >
      {children}
    </Heading>
  );
}
