/**
 * Help Center V3 — structured article content (48 articles, 8 categories).
 */
import { enrichArticleSections } from './help-article-depth.js';

function article(slug, category, title, summary, sections, opts = {}) {
  const enriched = enrichArticleSections(slug, category, title, sections);
  const wordCount =
    [summary, enriched.content, ...enriched.steps, ...enriched.tips, ...enriched.troubleshooting.map((t) => t.a), ...enriched.faq.map((f) => f.a)]
      .join(' ')
      .split(/\s+/).length;
  const reading_minutes = Math.max(3, Math.min(14, Math.ceil(wordCount / 160)));
  return {
    slug,
    category_slug: category,
    title,
    summary,
    tags: opts.tags || [],
    is_popular: Boolean(opts.is_popular),
    body: JSON.stringify({
      reading_minutes,
      hero_image: opts.hero_image || `/help-illustrations/articles/${slug}-hero.svg`,
      inline_image: opts.inline_image || `/help-illustrations/articles/${slug}-inline.svg`,
      inline_caption: opts.inline_caption || `Example: ${title}`,
      overview: enriched.content,
      content: enriched.content,
      steps: enriched.steps,
      tips: enriched.tips,
      troubleshooting: enriched.troubleshooting,
      faq: enriched.faq,
      related_slugs: opts.related || [],
    }),
  };
}

export const HELP_CATEGORIES = [
  { slug: 'getting-started', title: 'Getting Started', description: 'Set up your workspace and first project', icon: '🚀', sort_order: 1 },
  { slug: 'exports', title: 'Exports', description: 'Download transcripts, subtitles, and video', icon: '📤', sort_order: 2 },
  { slug: 'transcripts', title: 'Transcripts', description: 'Accuracy, editing, and formatting', icon: '📝', sort_order: 3 },
  { slug: 'translation', title: 'Translation', description: 'Multilingual captions and dubbing', icon: '🌐', sort_order: 4 },
  { slug: 'billing', title: 'Billing', description: 'Plans, invoices, and payments', icon: '💳', sort_order: 5 },
  { slug: 'credits', title: 'Credits', description: 'Usage limits and top-ups', icon: '⚡', sort_order: 6 },
  { slug: 'account', title: 'Account', description: 'Profile, preferences, and security', icon: '👤', sort_order: 7 },
  { slug: 'security', title: 'Security', description: 'Privacy, data retention, and access', icon: '🔒', sort_order: 8 },
];

export const HELP_CONTENT_VERSION = 5;

export const HELP_ARTICLES = [
  // ——— Getting Started ———
  article('quick-start-guide', 'getting-started', 'Quick start guide', 'Paste a link or upload a file to generate your first transcript in minutes.', {
    content: 'Cutup turns video into editable transcripts and export-ready subtitles. This guide walks you through your first project from source to download.',
    steps: [
      'Sign in with Google from the Cutup homepage.',
      'Paste a YouTube or Instagram link, or upload an MP4/MOV file from your device.',
      'Choose your language and run Transcribe — a preview appears in under a minute for short clips.',
      'Scan the first 60 seconds and fix names, numbers, or jargon once.',
      'Open Export and download SRT, plain text, or burn-in MP4 depending on your plan.',
    ],
    tips: ['Start with a 2–5 minute clip to learn the workflow before processing long videos.', 'Quiet audio and clear speech dramatically improve first-pass accuracy.'],
    troubleshooting: [{ q: 'Transcription stuck on loading', a: 'Refresh the page and retry. If the source is private or geo-blocked, upload the file directly instead.' }],
    faq: [{ q: 'Do I need to install software?', a: 'No. Cutup runs entirely in your browser.' }],
  }, { is_popular: true, related: ['supported-video-formats', 'dashboard-overview'] }),

  article('supported-video-formats', 'getting-started', 'Supported video formats', 'MP4, MOV, WEBM uploads and major social platforms.', {
    content: 'Cutup accepts direct uploads and link-based imports. Knowing supported formats upfront saves time when a source fails to load.',
    steps: ['For uploads: use MP4, MOV, or WEBM with H.264 video and AAC audio when possible.', 'For links: public YouTube and Instagram posts are supported; private or age-gated videos may fail.', 'Check file size against your plan limit before uploading long files.', 'If upload fails, re-encode to MP4 with standard codecs using HandBrake or similar.'],
    tips: ['Shorter clips process faster and cost fewer credits.', 'Remove background music if speech is hard to hear.'],
    troubleshooting: [{ q: 'Instagram link not working', a: 'Ensure the post is public. Stories and private accounts cannot be imported.' }],
    faq: [{ q: 'Maximum upload size?', a: 'Depends on your plan. Check Plans in the dashboard for current limits.' }],
  }, { is_popular: true, related: ['upload-first-video'] }),

  article('paste-youtube-instagram-link', 'getting-started', 'Paste a YouTube or Instagram link', 'Import video without downloading files manually.', {
    content: 'Link import is the fastest way to start. Cutup fetches the source server-side and begins transcription automatically.',
    steps: ['Copy the full URL from your browser address bar.', 'Paste into the Cutup input field on the homepage or dashboard.', 'Confirm the preview thumbnail matches your video.', 'Click Transcribe and wait for the draft transcript.'],
    tips: ['Playlist URLs are not supported — use a single video link.', 'Live streams must finish before transcription can run.'],
    troubleshooting: [{ q: 'Video unavailable error', a: 'The uploader may have restricted embedding. Download the file and upload instead.' }],
    faq: [],
  }, { related: ['supported-video-formats'] }),

  article('upload-first-video', 'getting-started', 'Upload your first video file', 'When link import is not an option, upload directly.', {
    content: 'Direct upload gives you full control over source quality and works for private or offline content.',
    steps: ['Click Upload or drag a file onto the Cutup workspace.', 'Wait for the upload progress bar to complete — do not close the tab.', 'Select the spoken language if prompted.', 'Review the transcript preview before exporting.'],
    tips: ['Wired connections are more reliable than mobile hotspots for large files.'],
    troubleshooting: [{ q: 'Upload stops at 90%', a: 'Check your connection. Retry with a smaller file or lower resolution export from your editor.' }],
    faq: [],
  }, {}),

  article('dashboard-overview', 'getting-started', 'Dashboard overview', 'Understand credits, library, billing, and support in one place.', {
    content: 'Your Cutup dashboard is the hub for projects, usage, and account settings.',
    steps: ['Account overview shows remaining credits and recent activity.', 'Content library stores transcripts, translations, summaries, and MP4 exports.', 'Plans lets you compare Starter, Pro, and Business tiers.', 'Profile & settings manages your name, country, and preferences.', 'Billing shows invoices and payment history.', 'Support Center handles tickets; Help Center answers common questions.'],
    tips: ['Pin the dashboard in your browser for quick access to exports.'],
    troubleshooting: [],
    faq: [{ q: 'Where are my old projects?', a: 'Open Content library — items are sorted by most recent activity.' }],
  }, { is_popular: true }),

  article('credits-and-plans-overview', 'getting-started', 'Credits and plans overview', 'How monthly credits work across transcription and exports.', {
    content: 'Every plan includes a monthly credit pool. Different actions consume different amounts.',
    steps: ['Open Plans in the sidebar to see your current tier.', 'Check Account overview for credits remaining this cycle.', 'Transcription typically uses more credits than plain text export.', 'Usage & activity breaks down consumption by workflow type.'],
    tips: ['Upgrade before a large batch job to avoid mid-project limits.'],
    troubleshooting: [{ q: 'Credits did not reset', a: 'Reset aligns with your billing cycle date, not the calendar month.' }],
    faq: [],
  }, { related: ['understand-credit-usage', 'upgrade-plan'] }),

  // ——— Exports ———
  article('export-mp4', 'exports', 'Export MP4 with burned-in captions', 'Render captions directly onto your video file.', {
    content: 'Burn-in export produces a share-ready MP4 with captions embedded — ideal for social and client delivery.',
    steps: ['Finish editing your transcript and timing.', 'Open Export and select MP4 / Burn-in.', 'Choose caption style preset (size, position, background).', 'Submit export and monitor progress in Content library.', 'Download when status shows Completed.'],
    tips: ['Preview on mobile before publishing — small text may be hard to read.', 'Long videos queue longer during peak hours.'],
    troubleshooting: [{ q: 'Export failed', a: 'See Failed exports article. Often caused by expired source or insufficient credits.' }],
    faq: [{ q: 'Can I change font after export?', a: 'Re-export with new style settings — burned-in text cannot be edited in the MP4.' }],
  }, { is_popular: true, related: ['export-srt-subtitles', 'failed-exports'] }),

  article('export-srt-subtitles', 'exports', 'Export SRT subtitles', 'Download broadcast-ready SRT files for your editor.', {
    content: 'SRT is the industry standard for subtitles in Premiere, DaVinci Resolve, Final Cut, and YouTube.',
    steps: ['Confirm cue timing in the transcript preview.', 'Click Export → SRT.', 'Download the .srt file from Content library or the success notification.', 'Import into your NLE using File → Import Captions or equivalent.'],
    tips: ['Keep lines under 42 characters for broadcast readability.', 'Export separate SRT per language after translation.'],
    troubleshooting: [{ q: 'Timing offset in editor', a: 'Check frame rate mismatch between source and sequence.' }],
    faq: [],
  }, { is_popular: true }),

  article('export-txt-transcript', 'exports', 'Export plain text transcript', 'Share readable transcripts without timing codes.', {
    content: 'Plain text is perfect for blog posts, show notes, quotes, and team review.',
    steps: ['Open a completed transcript.', 'Choose Export → TXT or Copy all.', 'Paste into Docs, Notion, or your CMS.', 'Optionally strip speaker labels in your editor if not needed.'],
    tips: ['Fix proper nouns before export to avoid repeating corrections.'],
    troubleshooting: [],
    faq: [{ q: 'Includes timestamps?', a: 'Plain text export omits timing. Use SRT for timed captions.' }],
  }, { related: ['export-srt-subtitles'] }),

  article('failed-exports', 'exports', 'Troubleshoot failed exports', 'Recover when an export job errors or stalls.', {
    content: 'Most export failures are recoverable without losing your transcript work.',
    steps: ['Open Content library and check the failed item status message.', 'Verify you still have credits remaining.', 'Confirm the source video has not expired from temporary storage.', 'Retry export with the same settings.', 'If burn-in fails, try SRT export first to validate timing.'],
    tips: ['Screenshot the error message before retrying — useful for support tickets.'],
    troubleshooting: [{ q: 'Stuck on Processing', a: 'Wait 15 minutes. If unchanged, refresh and check library — job may have completed.' }],
    faq: [],
  }, { is_popular: true }),

  article('export-queue', 'exports', 'Understanding the export queue', 'Why some exports take longer than others.', {
    content: 'Exports run in a shared queue. Length, resolution, and burn-in effects affect wait time.',
    steps: ['Short clips (<5 min) usually finish in minutes.', 'Burn-in MP4 takes longer than SRT generation.', 'Peak hours may add queue delay — plan ahead for deadlines.', 'You can start a new transcription while an export runs.'],
    tips: ['Export overnight for long-form content.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('download-history', 'exports', 'Download history and re-downloads', 'Find past exports in your content library.', {
    content: 'Cutup keeps completed exports in Content library so you can re-download without re-processing.',
    steps: ['Open Content library from the dashboard sidebar.', 'Filter by type: transcript, translation, summary, or MP4.', 'Click an item to view details and download link.', 'Downloads expire after the retention period on your plan — save locally.'],
    tips: ['Name exports clearly in your file system — library titles match project source.'],
    troubleshooting: [{ q: 'Download link expired', a: 'Re-run export if source still available, or contact support with project date.' }],
    faq: [],
  }, {}),

  // ——— Transcripts ———
  article('improve-transcript-accuracy', 'transcripts', 'Improve transcript accuracy', 'Tips for cleaner automated transcripts.', {
    content: 'AI transcription is fast but benefits from a short human review pass.',
    steps: ['Listen to the first minute while reading — fix names and numbers immediately.', 'Correct repeated errors once; similar phrases often appear later.', 'Add punctuation for readability before sharing.', 'Use headphones to catch low-volume speech.'],
    tips: ['Reduce background music in source audio when possible.'],
    troubleshooting: [{ q: 'Wrong language detected', a: 'Manually select source language before transcribing.' }],
    faq: [],
  }, { is_popular: true }),

  article('edit-transcript-text', 'transcripts', 'Edit transcript text', 'Fix wording without breaking timing.', {
    content: 'Inline editing lets you correct words while preserving cue boundaries.',
    steps: ['Click any line in the transcript preview to edit.', 'Press Enter or click away to save the line.', 'Avoid merging or splitting lines unless you understand timing impact.', 'Re-export after edits to apply changes to SRT/MP4.'],
    tips: ['Edit in batches — finish one section before moving on.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['improve-transcript-accuracy'] }),

  article('fix-timestamps', 'transcripts', 'Fix caption timestamps', 'Align cues when speech and text drift.', {
    content: 'Timing drift can occur with music-heavy audio or cross-talk.',
    steps: ['Identify the first cue that is clearly early or late.', 'Adjust start/end in the cue editor if available, or nudge in your NLE after SRT export.', 'Re-sync in 30-second chunks rather than one global offset.', 'Re-export SRT after in-app timing fixes.'],
    tips: ['Export SRT and verify in your editor timeline before burn-in.'],
    troubleshooting: [{ q: 'All cues shifted by same amount', a: 'Apply a constant offset in your NLE — often a frame rate issue.' }],
    faq: [],
  }, {}),

  article('speaker-labels', 'transcripts', 'Work with speaker labels', 'Keep multi-speaker content readable.', {
    content: 'When multiple speakers appear, labels help readers follow the conversation.',
    steps: ['Review auto-detected speaker changes in the preview.', 'Rename generic labels (Speaker 1) to real names.', 'Keep labels consistent for export formatting.', 'Plain text export can include or omit labels based on copy settings.'],
    tips: ['Podcast interviews benefit from host vs guest labels.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('punctuation-formatting', 'transcripts', 'Punctuation and formatting', 'Make transcripts publication-ready.', {
    content: 'Good punctuation improves readability for captions and blog reuse.',
    steps: ['Add periods at natural phrase boundaries.', 'Use commas for lists and pauses — captions are not essays but need clarity.', 'Capitalize proper nouns and sentence starts.', 'Break long sentences into two cues for on-screen captions.'],
    tips: ['Read aloud — if you run out of breath, split the cue.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('transcript-preview', 'transcripts', 'Using transcript preview', 'Validate quality before spending credits on export.', {
    content: 'Preview is your quality gate. Catch issues early to avoid re-exports.',
    steps: ['Scroll the full preview for obvious gaps or hallucinated text.', 'Spot-check timestamps against video playback.', 'Search for known problem words (brand names, technical terms).', 'Proceed to export only when preview meets your standard.'],
    tips: ['Fix the first minute first — highest ROI for accuracy.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  // ——— Translation ———
  article('translate-captions', 'translation', 'Translate captions', 'Generate multilingual subtitle tracks from one source.', {
    content: 'Translate after your base transcript is final — edits before translation save rework.',
    steps: ['Finalize the source-language transcript.', 'Open Translation and select target language(s).', 'Run translation and review the first minute in each language.', 'Export separate SRT per language from Content library.'],
    tips: ['Idioms may need manual adjustment — AI translation is a strong draft.'],
    troubleshooting: [{ q: 'Wrong target language', a: 'Delete translation output and re-run with correct language pair.' }],
    faq: [],
  }, { is_popular: true }),

  article('translation-languages', 'translation', 'Supported translation languages', 'See which languages Cutup supports today.', {
    content: 'Language coverage expands over time. Always verify your pair in the translation picker.',
    steps: ['Open the translation panel before starting a job.', 'Source language should match the spoken audio.', 'Pick one or more target languages.', 'Unsupported pairs may be grayed out — check release notes for updates.'],
    tips: ['Regional variants (pt-BR vs pt-PT) affect spelling — pick the closest match.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('bilingual-subtitles', 'translation', 'Create bilingual subtitles', 'Deliver dual-language captions for international audiences.', {
    content: 'Bilingual workflows typically use two SRT tracks or stacked burn-in — plan delivery format with your client.',
    steps: ['Export source-language SRT.', 'Export translated SRT.', 'In your NLE, stack as two subtitle tracks or merge per platform spec.', 'For YouTube, upload multiple language files in Creator Studio.'],
    tips: ['Keep each language on its own line for readability when stacking.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['translate-captions', 'export-srt-subtitles'] }),

  article('translation-quality', 'translation', 'Improve translation quality', 'Review passes that catch common AI mistakes.', {
    content: 'Machine translation accelerates workflow; a quick human review ensures brand voice.',
    steps: ['Compare back-translation mentally for critical lines.', 'Fix gendered grammar in languages where it matters.', 'Verify numbers, dates, and currency formats.', 'Check on-screen length — German and Finnish often need shorter English source.'],
    tips: ['Glossary: keep a list of product terms and enforce consistent translations.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('export-translated-srt', 'translation', 'Export translated SRT files', 'Download per-language subtitle files.', {
    content: 'Each translation becomes a separate library item with its own download.',
    steps: ['Open Content library after translation completes.', 'Locate the item tagged with target language.', 'Export or download SRT.', 'Name files with language code: project_en.srt, project_es.srt.'],
    tips: ['Use ISO language codes in filenames for automation pipelines.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('translation-credits', 'translation', 'Translation credit usage', 'How translation affects your monthly balance.', {
    content: 'Translation consumes credits in addition to base transcription on some plans.',
    steps: ['Check Usage & activity for translation-specific events.', 'Estimate: each language adds processing cost proportional to duration.', 'Upgrade or wait for cycle reset if balance is low.'],
    tips: ['Translate only final transcripts to avoid paying twice after edits.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['understand-credit-usage'] }),

  // ——— Billing ———
  article('upgrade-plan', 'billing', 'Upgrade your plan', 'Move to a higher tier for more credits and features.', {
    content: 'Upgrades unlock immediately so you can finish projects without interruption.',
    steps: ['Open Plans in the dashboard sidebar.', 'Compare credit limits and export options.', 'Click Upgrade on your target plan.', 'Complete checkout — new limits apply right away.', 'Previous unused credits may roll per plan terms shown at checkout.'],
    tips: ['Annual billing often reduces effective monthly cost.'],
    troubleshooting: [{ q: 'Payment declined', a: 'See Payment failures article or try a different card.' }],
    faq: [],
  }, { is_popular: true, related: ['downgrade-plan'] }),

  article('downgrade-plan', 'billing', 'Downgrade your plan', 'Switch to a lower tier at period end.', {
    content: 'Downgrades protect you from losing access mid-cycle — changes apply at renewal.',
    steps: ['Go to Plans and select a lower tier.', 'Confirm effective date shown at checkout.', 'Continue using current limits until period ends.', 'Export or download library items before downgrade if storage limits change.'],
    tips: ['Schedule downgrade after large projects complete.'],
    troubleshooting: [],
    faq: [{ q: 'Can I cancel instead?', a: 'Yes — subscription ends at period end; see refund policy for eligibility.' }],
  }, {}),

  article('payment-failures', 'billing', 'Fix payment failures', 'Recover when a card charge does not go through.', {
    content: 'Failed payments may pause upgrades or renewals. Fixing billing restores full access.',
    steps: ['Open Billing in the dashboard.', 'Review failed invoice or alert banner.', 'Update card details or billing address.', 'Retry payment from invoice view.', 'Contact your bank if charges are blocked for international merchants.'],
    tips: ['3D Secure pop-ups must be completed — disable aggressive popup blockers.'],
    troubleshooting: [{ q: 'Charged twice', a: 'Check pending authorizations; contact support with invoice IDs.' }],
    faq: [],
  }, { is_popular: true }),

  article('invoices', 'billing', 'Access invoices and receipts', 'Download PDF records for accounting.', {
    content: 'Invoices are available for paid subscriptions and one-time purchases.',
    steps: ['Navigate to Billing.', 'Open invoice history.', 'Download PDF for each billing period.', 'Forward to your finance team or attach to expense reports.'],
    tips: ['Company name and VAT ID can be added in Profile before checkout.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('vat-taxes', 'billing', 'VAT and taxes', 'How tax is calculated on your subscription.', {
    content: 'Tax depends on billing country and whether you provide a valid VAT ID.',
    steps: ['Set country in Profile & settings.', 'Business customers: enter VAT ID if applicable.', 'Review tax line item at checkout before paying.', 'Invoices show tax breakdown for your records.'],
    tips: ['EU B2B with valid VAT ID may qualify for reverse charge — enter ID before purchase.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('refund-policy', 'billing', 'Refund policy', 'When refunds are available and how to request them.', {
    content: 'Cutup aims for fair refunds when service issues occur or accidental purchases happen.',
    steps: ['Review plan terms at purchase time.', 'For billing errors, open a support ticket within 14 days.', 'Include invoice ID and reason.', 'Partial refunds may apply if credits were substantially consumed.'],
    tips: ['Try the free tier or small project before large annual purchase.'],
    troubleshooting: [],
    faq: [{ q: 'Refund timeline?', a: 'Approved refunds return to original payment method in 5–10 business days.' }],
  }, {}),

  // ——— Credits ———
  article('understand-credit-usage', 'credits', 'Understand credit usage', 'How minutes and exports consume credits.', {
    content: 'Credits are the universal currency for AI processing on Cutup.',
    steps: ['Each transcription consumes credits based on audio duration.', 'Exports (especially MP4 burn-in) may consume additional credits.', 'Open Usage & activity for a chronological log.', 'Account overview shows remaining balance.'],
    tips: ['Batch similar videos in one session to track usage easily.'],
    troubleshooting: [],
    faq: [],
  }, { is_popular: true }),

  article('credit-usage-breakdown', 'credits', 'Credit usage breakdown', 'Read your usage dashboard.', {
    content: 'Usage & activity categorizes events so you can audit team or personal consumption.',
    steps: ['Open Usage & activity from the sidebar.', 'Scan event types: transcribe, translate, export, download.', 'Compare week-over-week for production planning.', 'Use filters if available for date ranges.'],
    tips: ['Spikes often correlate with burn-in MP4 batches.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('running-low-credits', 'credits', 'Running low on credits', 'Options before you hit zero.', {
    content: 'Hitting zero pauses new jobs until reset or upgrade.',
    steps: ['Check reset date on Account overview.', 'Prioritize remaining credits for final exports only.', 'Upgrade plan for immediate top-up.', 'Pause non-essential translation jobs until reset.'],
    tips: ['Export SRT instead of MP4 when credits are tight — often cheaper.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['upgrade-plan'] }),

  article('credit-reset-cycle', 'credits', 'Credit reset cycle', 'When monthly credits refresh.', {
    content: 'Credits reset on your subscription billing anniversary, not necessarily the 1st of the month.',
    steps: ['Find next reset date in Account overview or Billing.', 'Unused credits may not roll over — check plan terms.', 'Plan production around reset if on tight limits.'],
    tips: ['Set a calendar reminder one day before reset for batch jobs.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('transcription-vs-export-credits', 'credits', 'Transcription vs export credits', 'Which actions cost more.', {
    content: 'Not all actions cost equally. Understanding the split helps budgeting.',
    steps: ['Transcription is typically the largest single charge per project.', 'SRT export is lighter than MP4 burn-in.', 'Translation adds incremental cost per language.', 'Re-export after minor edits may cost less than full re-transcription.'],
    tips: ['Edit transcript before first export to avoid duplicate export charges.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('maximize-credit-efficiency', 'credits', 'Maximize credit efficiency', 'Produce more with the same balance.', {
    content: 'Workflow discipline reduces waste without sacrificing quality.',
    steps: ['Preview before transcribing long duplicates.', 'Fix text once, then export all formats needed.', 'Avoid re-uploading the same file — use library items.', 'Use plain text for internal review; reserve burn-in for final delivery.'],
    tips: ['Team accounts: designate one editor to finalize before export.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  // ——— Account ———
  article('update-profile-information', 'account', 'Update profile information', 'Change your name, country, and contact details.', {
    content: 'Profile data syncs to billing, invoices, and support communications.',
    steps: ['Open Profile & settings from the dashboard sidebar.', 'Edit first name, last name, phone, or address fields.', 'Set country for tax and payment compliance.', 'Click Save — changes apply immediately.'],
    tips: ['Use your legal name for invoices if required by finance.'],
    troubleshooting: [{ q: 'Save button disabled', a: 'Fill required fields marked with asterisk.' }],
    faq: [],
  }, { related: ['notification-preferences'] }),

  article('notification-preferences', 'account', 'Change notification preferences', 'Control email and in-app updates.', {
    content: 'Choose which product updates and alerts you receive.',
    steps: ['Go to Profile & settings.', 'Find Notifications or Email preferences section.', 'Toggle product updates, billing alerts, and marketing separately.', 'Save preferences.'],
    tips: ['Keep billing alerts on to catch failed payments early.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('support-preferences', 'account', 'Manage support preferences', 'How Cutup contacts you about tickets.', {
    content: 'Support replies go to your account email by default.',
    steps: ['Ensure profile email is current.', 'Watch in-app Notifications for ticket updates.', 'Reply to ticket threads from Support Center for fastest resolution.'],
    tips: ['Add support email to safe senders to avoid spam filters.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['update-profile-information'] }),

  article('account-security-overview', 'account', 'Understanding account security', 'How your Cutup account stays protected.', {
    content: 'Cutup uses Google OAuth for sign-in — no separate Cutup password to manage.',
    steps: ['Sign in only via official cutup.app URLs.', 'Review connected Google account security at myaccount.google.com.', 'Log out on shared devices using header logout.', 'Report suspicious activity via Support immediately.'],
    tips: ['Enable 2FA on your Google account for strongest protection.'],
    troubleshooting: [],
    faq: [],
  }, { related: ['connected-google-account'] }),

  article('connected-google-account', 'account', 'Connected Google account', 'What linking Google means for your Cutup account.', {
    content: 'Your Google identity is your Cutup login. Email and avatar come from Google profile.',
    steps: ['Sign in with Google on first visit.', 'Cutup receives email, name, and profile picture scopes.', 'To change login email, update primary Google email or use a different Google account.', 'Deleting Google access revokes Cutup login until re-authorized.'],
    tips: ['Workspace admins can restrict OAuth apps — whitelist Cutup if needed.'],
    troubleshooting: [{ q: 'Wrong Google account', a: 'Log out and sign in with the correct Google profile.' }],
    faq: [],
  }, {}),

  article('delete-account-request', 'account', 'Delete account request', 'Permanently remove your data from Cutup.', {
    content: 'Account deletion is irreversible after the grace period.',
    steps: ['Export or download anything you need from Content library.', 'Open Profile & settings → Delete account (or contact Support).', 'Confirm deletion request — email verification may be required.', 'Deletion completes within 30 days per privacy policy.'],
    tips: ['Cancel active subscription first to avoid renewal during grace period.'],
    troubleshooting: [],
    faq: [{ q: 'Can I recover after requesting?', a: 'Contact support within grace window if you change your mind.' }],
  }, { related: ['data-privacy-retention'] }),

  // ——— Security ———
  article('data-privacy-retention', 'security', 'Data privacy and retention', 'How Cutup stores and protects your content.', {
    content: 'Uploaded media and transcripts are processed for your projects and retained per plan policy.',
    steps: ['Media is encrypted in transit (TLS) and at rest.', 'Retention varies by plan — check terms for exact durations.', 'Request deletion via account settings or support.', 'GDPR requests handled within regulatory timelines.'],
    tips: ['Delete library items you no longer need to minimize stored data.'],
    troubleshooting: [],
    faq: [],
  }, { is_popular: true }),

  article('encryption-data-storage', 'security', 'Encryption and data storage', 'Technical safeguards for your files.', {
    content: 'Cutup applies industry-standard encryption and access controls on infrastructure.',
    steps: ['Uploads use HTTPS.', 'Storage volumes encrypt data at rest.', 'Access is limited to automated processing and authorized support with audit trails.'],
    tips: ['Do not upload highly classified material unless your plan includes enterprise controls.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('session-security', 'security', 'Session security', 'Stay signed in safely.', {
    content: 'Sessions expire after inactivity to reduce risk on shared computers.',
    steps: ['Log out from dashboard header on shared machines.', 'Do not share session URLs or cookies.', 'If session expired, sign in again with Google.'],
    tips: ['Browser password managers should not auto-fill Cutup — there is no Cutup password.'],
    troubleshooting: [{ q: 'Frequent logouts', a: 'Clear cookies or disable extensions blocking session storage.' }],
    faq: [],
  }, {}),

  article('google-account-protection', 'security', 'Protect your Google account', 'First line of defense for Cutup access.', {
    content: 'Because Cutup authenticates via Google, Google security equals Cutup security.',
    steps: ['Enable 2-Step Verification on Google.', 'Review recent devices at myaccount.google.com/security.', 'Revoke unknown third-party app access.'],
    tips: ['Use a hardware security key for high-value accounts.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('gdpr-data-request', 'security', 'GDPR data requests', 'Access, portability, and erasure rights.', {
    content: 'EU and UK users have rights to access and delete personal data.',
    steps: ['Email support or use in-app privacy request with subject GDPR Request.', 'Specify access, correction, or erasure.', 'We verify identity via account email.', 'Response within 30 days unless extended legally.'],
    tips: ['Include account email and approximate signup date.'],
    troubleshooting: [],
    faq: [],
  }, {}),

  article('report-security-issue', 'security', 'Report a security issue', 'Responsible disclosure for vulnerabilities.', {
    content: 'We appreciate coordinated disclosure of security findings.',
    steps: ['Email security@cutup.app with reproduction steps (or open urgent support ticket).', 'Do not publicly disclose before fix window.', 'Include impact assessment and suggested mitigation.'],
    tips: ['Safe harbor applies to good-faith research per our security policy.'],
    troubleshooting: [],
    faq: [],
  }, {}),
];
