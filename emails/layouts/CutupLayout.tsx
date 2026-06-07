import { Body, Container, Head, Html, Preview } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import * as React from 'react';
import { BRAND } from '../brand';
import { EmailFooter } from '../components/EmailFooter';
import { EmailHeader } from '../components/EmailHeader';

type Props = {
  preview: string;
  children: React.ReactNode;
};

const tailwindConfig = {
  theme: {
    extend: {
      colors: {
        brand: BRAND.primary,
        'brand-dark': BRAND.primaryDark,
      },
    },
  },
};

export function CutupLayout({ preview, children }: Props) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body
          className="m-0 p-0"
          style={{
            backgroundColor: BRAND.background,
            fontFamily: BRAND.fontFamily,
            WebkitFontSmoothing: 'antialiased',
          }}
        >
          <Container
            className="mx-auto"
            style={{
              maxWidth: '560px',
              margin: '0 auto',
              backgroundColor: BRAND.background,
            }}
          >
            <EmailHeader />
            <Container style={{ padding: '8px 24px 16px' }}>{children}</Container>
            <EmailFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
