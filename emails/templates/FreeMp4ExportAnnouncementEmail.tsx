import { Text } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import {
  EmailBlock,
  EmailButton,
  EmailText,
  HeroSection,
  StatusBadge,
} from '../components';
import { BRAND, SITE } from '../brand';

export type FreeMp4ExportAnnouncementEmailData = {
  firstName?: string;
  launchUrl?: string;
  founderName?: string;
  founderTitle?: string;
};

const BENEFIT_LINES = [
  'No editing software.',
  'No manual subtitle syncing.',
  'No complicated workflow.',
];

export function FreeMp4ExportAnnouncementEmail({
  firstName = 'there',
  launchUrl,
  founderName = 'Hamidreza',
  founderTitle = 'Founder, CutUp',
}: FreeMp4ExportAnnouncementEmailData) {
  const name = String(firstName).trim() || 'there';
  const ctaUrl = launchUrl || SITE.url;

  return (
    <CutupLayout preview="Free accounts can now export captioned MP4 videos from CutUp">
      <StatusBadge variant="success">Good news</StatusBadge>
      <HeroSection title="Captioned MP4 export is here" subtitle={`Hi ${name},`} />
      <EmailText>Good news.</EmailText>
      <EmailText>
        Free accounts can now export captioned videos directly from CutUp.
      </EmailText>
      <EmailText>
        Upload a video, generate captions, and download a ready-to-post MP4 video in minutes.
      </EmailText>
      {BENEFIT_LINES.map((line) => (
        <EmailText key={line} style={{ margin: '0 0 6px' }}>
          {line}
        </EmailText>
      ))}
      <EmailText>Just upload your video and let CutUp do the work.</EmailText>
      <EmailBlock padding={BRAND.ctaPad}>
        <Text
          style={{
            margin: '0 0 14px',
            fontSize: '14px',
            fontWeight: 600,
            color: BRAND.text,
          }}
        >
          Try it now:
        </Text>
        <EmailButton href={ctaUrl} fullWidth>
          Open CutUp
        </EmailButton>
      </EmailBlock>
      <EmailText inset muted small>
        <span style={{ color: BRAND.text, fontWeight: 600 }}>— {founderName}</span>
        <br />
        {founderTitle}
      </EmailText>
    </CutupLayout>
  );
}
