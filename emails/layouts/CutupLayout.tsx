import { Body, Container, Head, Html, Preview, Section } from '@react-email/components';
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
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body
          className="m-0 p-0"
          style={{
            backgroundColor: BRAND.background,
            fontFamily: BRAND.fontFamily,
            WebkitFontSmoothing: 'antialiased',
            margin: 0,
            padding: '32px 16px',
          }}
        >
          <Container
            className="mx-auto"
            style={{
              maxWidth: BRAND.maxWidth,
              margin: '0 auto',
            }}
          >
            <Section
              style={{
                backgroundColor: BRAND.card,
                borderRadius: BRAND.radiusLg,
                border: `1px solid ${BRAND.border}`,
                boxShadow: BRAND.shadowSm,
                overflow: 'hidden',
              }}
            >
              <EmailHeader />
              {children}
            </Section>
            <EmailFooter />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
