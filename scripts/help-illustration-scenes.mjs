/** Per-article hero + inline scene definitions for Help Center illustrations */

export const SLUG_SCENES = {
  'quick-start-guide': { hero: 'home-transcribe', inline: 'transcript-lines', heroLabel: 'Start a new project', inlineLabel: 'Review your transcript' },
  'supported-video-formats': { hero: 'format-grid', inline: 'upload-dropzone', heroLabel: 'Supported sources', inlineLabel: 'Upload a video file' },
  'paste-youtube-instagram-link': { hero: 'link-input', inline: 'link-preview', heroLabel: 'Paste a video link', inlineLabel: 'Confirm video preview' },
  'upload-first-video': { hero: 'upload-dropzone', inline: 'processing-bar', heroLabel: 'Upload from device', inlineLabel: 'Processing upload' },
  'dashboard-overview': { hero: 'dashboard-hub', inline: 'sidebar-nav', heroLabel: 'Cutup dashboard', inlineLabel: 'Navigate your workspace' },
  'credits-and-plans-overview': { hero: 'credits-card', inline: 'plans-compare', heroLabel: 'Credits & plans', inlineLabel: 'Compare plan limits' },

  'export-mp4': { hero: 'video-burnin', inline: 'export-download', heroLabel: 'MP4 with captions', inlineLabel: 'Download finished export' },
  'export-srt-subtitles': { hero: 'srt-preview', inline: 'srt-download', heroLabel: 'SRT subtitle file', inlineLabel: 'Download SRT' },
  'export-txt-transcript': { hero: 'txt-document', inline: 'txt-download', heroLabel: 'Plain text export', inlineLabel: 'Save as TXT' },
  'failed-exports': { hero: 'export-error', inline: 'export-retry', heroLabel: 'Export failed', inlineLabel: 'Retry export job' },
  'export-queue': { hero: 'export-queue', inline: 'queue-status', heroLabel: 'Export queue', inlineLabel: 'Job status' },
  'download-history': { hero: 'content-library', inline: 'redownload', heroLabel: 'Content library', inlineLabel: 'Re-download past exports' },

  'improve-transcript-accuracy': { hero: 'audio-waveform', inline: 'accuracy-tips', heroLabel: 'Audio quality', inlineLabel: 'Accuracy checklist' },
  'edit-transcript-text': { hero: 'editor-highlight', inline: 'editor-save', heroLabel: 'Transcript editor', inlineLabel: 'Save your edits' },
  'fix-timestamps': { hero: 'timeline-cues', inline: 'cue-adjust', heroLabel: 'Caption timing', inlineLabel: 'Adjust cue times' },
  'speaker-labels': { hero: 'speaker-tags', inline: 'speaker-rename', heroLabel: 'Speaker labels', inlineLabel: 'Rename speakers' },
  'punctuation-formatting': { hero: 'text-format', inline: 'format-preview', heroLabel: 'Formatting', inlineLabel: 'Publication preview' },
  'transcript-preview': { hero: 'preview-player', inline: 'preview-scroll', heroLabel: 'Transcript preview', inlineLabel: 'Scan before export' },

  'translate-captions': { hero: 'translation-split', inline: 'lang-picker', heroLabel: 'Translate captions', inlineLabel: 'Choose target language' },
  'translation-languages': { hero: 'lang-list', inline: 'lang-select', heroLabel: 'Supported languages', inlineLabel: 'Pick a locale' },
  'bilingual-subtitles': { hero: 'dual-track', inline: 'dual-preview', heroLabel: 'Bilingual subtitles', inlineLabel: 'Dual-language preview' },
  'translation-quality': { hero: 'review-translation', inline: 'glossary-edit', heroLabel: 'Review translation', inlineLabel: 'Fix terminology' },
  'export-translated-srt': { hero: 'translated-srt', inline: 'per-lang-download', heroLabel: 'Translated SRT', inlineLabel: 'Download per language' },
  'translation-credits': { hero: 'translation-cost', inline: 'credit-deduct', heroLabel: 'Translation credits', inlineLabel: 'Credit usage' },

  'upgrade-plan': { hero: 'plan-upgrade', inline: 'checkout', heroLabel: 'Upgrade plan', inlineLabel: 'Confirm checkout' },
  'downgrade-plan': { hero: 'plan-downgrade', inline: 'period-end', heroLabel: 'Downgrade plan', inlineLabel: 'Effective next period' },
  'payment-failures': { hero: 'card-declined', inline: 'update-card', heroLabel: 'Payment issue', inlineLabel: 'Update payment method' },
  'invoices': { hero: 'invoice-list', inline: 'invoice-pdf', heroLabel: 'Billing history', inlineLabel: 'Download invoice PDF' },
  'vat-taxes': { hero: 'vat-form', inline: 'tax-line', heroLabel: 'VAT & tax ID', inlineLabel: 'Tax on invoice' },
  'refund-policy': { hero: 'refund-request', inline: 'refund-status', heroLabel: 'Refund request', inlineLabel: 'Request status' },

  'understand-credit-usage': { hero: 'credits-card', inline: 'usage-events', heroLabel: 'Credit balance', inlineLabel: 'Usage events' },
  'credit-usage-breakdown': { hero: 'usage-chart', inline: 'usage-filter', heroLabel: 'Usage breakdown', inlineLabel: 'Filter by action' },
  'running-low-credits': { hero: 'credits-low', inline: 'top-up', heroLabel: 'Low credits warning', inlineLabel: 'Upgrade or top up' },
  'credit-reset-cycle': { hero: 'reset-calendar', inline: 'reset-countdown', heroLabel: 'Reset cycle', inlineLabel: 'Next refresh date' },
  'transcription-vs-export-credits': { hero: 'cost-compare', inline: 'action-cost', heroLabel: 'Credit costs', inlineLabel: 'Per action cost' },
  'maximize-credit-efficiency': { hero: 'efficiency-tips', inline: 'batch-workflow', heroLabel: 'Efficient workflow', inlineLabel: 'Batch similar jobs' },

  'update-profile-information': { hero: 'profile-form', inline: 'profile-save', heroLabel: 'Profile settings', inlineLabel: 'Save profile' },
  'notification-preferences': { hero: 'notif-toggles', inline: 'notif-email', heroLabel: 'Notifications', inlineLabel: 'Email preferences' },
  'support-preferences': { hero: 'ticket-thread', inline: 'ticket-attach', heroLabel: 'Support ticket', inlineLabel: 'Attachments' },
  'account-security-overview': { hero: 'security-overview', inline: 'session-list', heroLabel: 'Account security', inlineLabel: 'Active sessions' },
  'connected-google-account': { hero: 'google-link', inline: 'google-switch', heroLabel: 'Google sign-in', inlineLabel: 'Switch account' },
  'delete-account-request': { hero: 'delete-request', inline: 'delete-confirm', heroLabel: 'Delete account', inlineLabel: 'Confirm request' },

  'data-privacy-retention': { hero: 'data-retention', inline: 'retention-policy', heroLabel: 'Data retention', inlineLabel: 'Retention periods' },
  'encryption-data-storage': { hero: 'encryption-lock', inline: 'storage-stack', heroLabel: 'Encryption', inlineLabel: 'Secure storage' },
  'session-security': { hero: 'session-timeout', inline: 'logout-all', heroLabel: 'Session security', inlineLabel: 'Sign out everywhere' },
  'google-account-protection': { hero: 'google-2fa', inline: 'google-apps', heroLabel: 'Google 2FA', inlineLabel: 'Connected apps' },
  'gdpr-data-request': { hero: 'gdpr-export', inline: 'gdpr-erasure', heroLabel: 'GDPR request', inlineLabel: 'Data export / erasure' },
  'report-security-issue': { hero: 'security-report', inline: 'security-email', heroLabel: 'Report vulnerability', inlineLabel: 'Responsible disclosure' },
};
