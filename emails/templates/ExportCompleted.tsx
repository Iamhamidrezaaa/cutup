import { Section } from '@react-email/components';
import { CutupLayout } from '../layouts/CutupLayout';
import { EmailButton, EmailCard, EmailHeading, EmailText } from '../components';
import { SITE } from '../brand';

export type ExportCompletedData = {
  projectName?: string;
  exportType?: string;
  exportDate?: string;
  downloadUrl?: string;
};

export function ExportCompleted({
  projectName = 'Your project',
  exportType = 'MP4',
  exportDate,
  downloadUrl,
}: ExportCompletedData) {
  const dateLabel = exportDate || new Date().toLocaleDateString('en-US', { dateStyle: 'medium' });
  const download = downloadUrl || SITE.dashboardUrl;

  return (
    <CutupLayout preview="Your export is ready">
      <EmailHeading>Your export is ready</EmailHeading>
      <EmailText>Your {exportType} export has finished processing and is ready to download.</EmailText>
      <EmailCard>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Project:</strong> {projectName}
        </EmailText>
        <EmailText style={{ margin: '0 0 8px' }}>
          <strong>Export type:</strong> {exportType}
        </EmailText>
        <EmailText style={{ margin: 0 }}>
          <strong>Date:</strong> {dateLabel}
        </EmailText>
      </EmailCard>
      <Section style={{ margin: '8px 0 20px' }}>
        <EmailButton href={download}>Download Export</EmailButton>
      </Section>
      <Section>
        <EmailButton href={SITE.dashboardUrl} variant="secondary">
          Open Dashboard
        </EmailButton>
      </Section>
    </CutupLayout>
  );
}
