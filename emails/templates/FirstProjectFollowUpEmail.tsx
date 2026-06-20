import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailBlock,
  EmailButton,
  EmailCard,
  EmailText,
  FeatureList,
  HeroSection,
  StatusBadge,
} from '../components';
import { BRAND, SITE } from '../brand';

export type FirstProjectFollowUpEmailData = {
  firstName?: string;
  dashboardUrl?: string;
};

const DEFAULT_FEATURES = [
  'AI-powered transcription',
  'Automatic captions',
  'Video translation',
  'Summary generation',
  'Multiple export formats',
];

export function FirstProjectFollowUpEmail({
  firstName = 'there',
  dashboardUrl,
}: FirstProjectFollowUpEmailData) {
  const name = String(firstName).trim() || 'there';
  const launchUrl = dashboardUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview="Thanks for trying CutUp — explore what&apos;s next">
      <StatusBadge variant="success">Keep creating</StatusBadge>
      <HeroSection
        title="Thanks for trying CutUp"
        subtitle={`Hi ${name},`}
      />
      <EmailText>
        We noticed that you successfully completed your first project and generated your first transcript.
      </EmailText>
      <EmailText>
        With your free account, you still have credits available to explore more features, including:
      </EmailText>
      <EmailCard>
        <FeatureList items={DEFAULT_FEATURES} />
      </EmailCard>
      <EmailText>
        Many creators use CutUp to save hours of manual transcription and caption work while making their
        content more accessible to a global audience.
      </EmailText>
      <EmailText>
        If you haven&apos;t explored all the features yet, now is a great time to upload another video and
        see what&apos;s possible.
      </EmailText>
      <EmailBlock padding={BRAND.ctaPad}>
        <Text
          style={{
            margin: '0 0 14px',
            fontSize: '14px',
            fontWeight: 600,
            color: BRAND.text,
          }}
        >
          Start your next project:
        </Text>
        <EmailButton href={launchUrl} fullWidth>
          Launch CutUp
        </EmailButton>
      </EmailBlock>
      <EmailText inset muted small>
        Thank you for being part of the CutUp community.
        <br />
        <span style={{ color: BRAND.text, fontWeight: 600 }}>— The CutUp Team</span>
      </EmailText>
    </CutupLayout>
  );
}
