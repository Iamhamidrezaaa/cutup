import { CutupLayout } from '../layouts/CutupLayout';
import {
  DetailRow,
  EmailButton,
  EmailCard,
  HeroSection,
  QuickActions,
  StatusBadge,
  SuccessIndicator,
} from '../components';
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
      <SuccessIndicator label="Export ready" />
      <HeroSection
        title="Your export is ready"
        subtitle="Your file has finished processing and is ready to download."
      />
      <EmailCard>
        <StatusBadge variant="success">Export summary</StatusBadge>
        <DetailRow label="Project" value={projectName} />
        <DetailRow label="Export type" value={exportType} />
        <DetailRow label="Export date" value={dateLabel} last />
      </EmailCard>
      <EmailButton href={download} fullWidth>
        Download Export
      </EmailButton>
      <EmailButton href={SITE.dashboardUrl} variant="secondary">
        Open Dashboard
      </EmailButton>
      <QuickActions />
    </CutupLayout>
  );
}
