import { Body, Container, Head, Html, Preview, Section } from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import * as React from 'react';
import { BRAND } from '../brand';
import { EmailFooter } from '../components/EmailFooter';
import { EmailHeadStyles } from '../components/EmailHeadStyles';
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <EmailHeadStyles />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={tailwindConfig}>
        <Body
          className="email-body-wrap m-0 p-0"
          style={{
            backgroundColor: BRAND.background,
            fontFamily: BRAND.fontFamily,
            WebkitFontSmoothing: 'antialiased',
            margin: 0,
            padding: BRAND.padBody,
            width: '100%',
          }}
        >
          <Container
            className="email-container mx-auto"
            style={{
              width: '100%',
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
