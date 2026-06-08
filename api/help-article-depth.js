/** Depth enrichment — ensures every article meets V3 content minimums */

const CATEGORY_FAQ = {
  'getting-started': [
    { q: 'How long does my first transcription take?', a: 'Short clips often finish in under a minute. Longer videos scale with duration and current queue load.' },
    { q: 'Can I use Cutup on mobile?', a: 'Yes. The dashboard works in modern mobile browsers, though we recommend desktop for editing long transcripts.' },
    { q: 'Do I need a paid plan to start?', a: 'You can explore with your included credits. Upgrade when you need higher limits or burn-in exports.' },
  ],
  exports: [
    { q: 'Which export format should I choose?', a: 'Use SRT for editors, TXT for documents, and MP4 burn-in for social delivery without separate subtitle tracks.' },
    { q: 'Will exports match my preview edits?', a: 'Yes. Exports reflect the latest saved transcript state at the time you submit the export job.' },
    { q: 'Can I export multiple formats from one project?', a: 'Yes. Run separate exports for SRT, TXT, and MP4 from the same transcript.' },
  ],
  transcripts: [
    { q: 'How accurate are Cutup transcripts?', a: 'Accuracy depends on audio quality and accent. A quick review pass fixes most issues for publication.' },
    { q: 'Can I edit after exporting?', a: 'Edit in Cutup first, then re-export. Exported files are snapshots — edit the source transcript to regenerate.' },
    { q: 'Does editing affect timing?', a: 'Text edits preserve cue timing unless you split or merge lines in a timing-aware editor.' },
  ],
  translation: [
    { q: 'Should I translate before or after editing?', a: 'Always finalize the source transcript first to avoid re-translating after corrections.' },
    { q: 'Can I translate to multiple languages?', a: 'Yes. Run translation once per target language and export each SRT separately.' },
    { q: 'Is machine translation final quality?', a: 'Treat it as a strong draft — review names, idioms, and on-screen length before publishing.' },
  ],
  billing: [
    { q: 'When am I charged?', a: 'Subscriptions renew on your billing anniversary. One-time purchases charge immediately at checkout.' },
    { q: 'Can I change plans mid-cycle?', a: 'Upgrades apply immediately. Downgrades take effect at the end of the current period.' },
    { q: 'Where do I find receipts?', a: 'Open Billing in the dashboard and download PDF invoices from your history.' },
  ],
  credits: [
    { q: 'What consumes credits?', a: 'Transcription, translation, and video exports each draw from your monthly pool.' },
    { q: 'Do unused credits roll over?', a: 'Typically no — check your plan terms on the Plans page for your account.' },
    { q: 'How do I see what used credits?', a: 'Usage & activity lists each event with type and timestamp.' },
  ],
  account: [
    { q: 'How do I change my login email?', a: 'Cutup uses Google sign-in. Update your Google account email or sign in with a different Google profile.' },
    { q: 'Who can see my profile data?', a: 'Only you and Cutup systems for billing and support. We do not sell profile data.' },
    { q: 'How fast do profile changes apply?', a: 'Immediately for dashboard display; invoices may use the address saved at checkout time.' },
  ],
  security: [
    { q: 'Is my content encrypted?', a: 'Yes — data is encrypted in transit and at rest on Cutup infrastructure.' },
    { q: 'How do I report suspicious activity?', a: 'Open a support ticket or email security@cutup.app with details and timestamps.' },
    { q: 'How long is data retained?', a: 'Retention depends on plan and library items. See Data privacy and retention for specifics.' },
  ],
};

const CATEGORY_TROUBLESHOOTING = {
  'getting-started': [
    { q: 'Link import fails immediately', a: 'Confirm the video is public. Private, members-only, or DRM-protected sources require direct upload.' },
    { q: 'Upload stalls or times out', a: 'Check file size against plan limits, use a stable connection, and retry with H.264 MP4.' },
  ],
  exports: [
    { q: 'Export stuck on processing', a: 'Wait 15 minutes during peak load. If unchanged, refresh Content library — the job may have completed.' },
    { q: 'Download button missing', a: 'Ensure the job status is Completed. Failed jobs show an error you can retry or report to support.' },
  ],
  transcripts: [
    { q: 'Many words are wrong in one section', a: 'Often audio overlap or music. Re-transcribe after isolating vocals, or manually fix that segment.' },
    { q: 'Preview will not load', a: 'Refresh the session. If the source expired, re-import the video and transcribe again.' },
  ],
  translation: [
    { q: 'Translation language unavailable', a: 'Pick the closest supported variant or contact support if you need a specific locale.' },
    { q: 'Lines too long after translation', a: 'Shorten the source cue or split lines before exporting subtitles.' },
  ],
  billing: [
    { q: 'Card declined at checkout', a: 'Verify billing address, try another card, or contact your bank about international charges.' },
    { q: 'Invoice shows wrong company name', a: 'Update Profile before the next billing cycle; contact support to amend an issued invoice.' },
  ],
  credits: [
    { q: 'Credits dropped unexpectedly', a: 'Check Usage & activity for recent jobs. Large exports and long transcripts consume more credits.' },
    { q: 'Balance did not reset on expected date', a: 'Reset follows your subscription anniversary, not necessarily the 1st of the month.' },
  ],
  account: [
    { q: 'Cannot save profile changes', a: 'Fill all required fields and ensure you are signed in. Try logging out and back in.' },
    { q: 'Wrong Google account signed in', a: 'Use header Log out, then sign in with the correct Google profile.' },
  ],
  security: [
    { q: 'Logged out frequently', a: 'Session timeout protects shared devices. Disable aggressive cookie blockers for cutup.app.' },
    { q: 'Unrecognized login alert', a: 'Change your Google password and review connected apps at myaccount.google.com.' },
  ],
};

const CATEGORY_TIPS = {
  'getting-started': [
    'Bookmark the dashboard for one-click access to your content library.',
    'Process a short sample clip before committing credits to a full-length video.',
    'Keep source audio clear — transcription quality starts with the recording.',
  ],
  exports: [
    'Export SRT first to validate timing before spending credits on burn-in MP4.',
    'Name downloads with project and language codes for easier archive management.',
    'Archive finals locally — library retention depends on your plan.',
  ],
  transcripts: [
    'Fix proper nouns in the first minute — they often repeat throughout the file.',
    'Read aloud while reviewing — awkward phrasing is easier to hear than read.',
    'Use consistent punctuation before sharing with clients or legal review.',
  ],
  translation: [
    'Build a glossary of product terms and enforce consistent translations.',
    'Check line length in the target language before burn-in export.',
    'Review numbers, dates, and currency formats per locale.',
  ],
  billing: [
    'Add VAT ID in Profile before annual checkout if you are EU B2B.',
    'Download invoices monthly for accounting rather than at year-end.',
    'Upgrade before large batch jobs to avoid mid-project limits.',
  ],
  credits: [
    'Check Usage & activity weekly during heavy production periods.',
    'Batch similar videos in one session to track consumption clearly.',
    'Prefer TXT export for internal review when credits are low.',
  ],
  account: [
    'Use a dedicated Google account for team production to simplify handoffs.',
    'Keep billing email accessible — payment failures notify via email.',
    'Export library contents before requesting account deletion.',
  ],
  security: [
    'Enable 2-Step Verification on your Google account.',
    'Log out on shared or public computers every session.',
    'Report phishing emails that claim to be Cutup but use non-official links.',
  ],
};

function uniqueByQ(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.q || !item?.a) return false;
    const k = String(item.q).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function uniqueStrings(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const s = String(item ?? '').trim();
    if (!s) return false;
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function enrichArticleSections(slug, category, title, sections) {
  const steps = [...(sections.steps || [])];
  const padSteps = [
    `Open the relevant section in your Cutup dashboard for ${title.toLowerCase()}.`,
    'Confirm your project source is available and credits are sufficient.',
    'Follow the on-screen prompts and wait for processing to complete.',
    'Review the output in preview before exporting or sharing.',
    'Save or download results to your content library for future access.',
    'If anything looks wrong, adjust settings and retry before contacting support.',
  ];
  let pi = 0;
  while (steps.length < 6 && pi < padSteps.length) {
    if (!steps.some((s) => s.toLowerCase().includes(padSteps[pi].slice(0, 20).toLowerCase()))) {
      steps.push(padSteps[pi]);
    }
    pi += 1;
  }
  while (steps.length < 6) steps.push(`Double-check results match your expectations for "${title}".`);

  const tips = uniqueStrings([...(sections.tips || []), ...(CATEGORY_TIPS[category] || [])]);
  while (tips.length < 3) {
    tips.push(`Review this guide in context of ${title.toLowerCase()} before large batch jobs.`);
  }

  const troubleshooting = uniqueByQ([...(sections.troubleshooting || []), ...(CATEGORY_TROUBLESHOOTING[category] || [])]);
  while (troubleshooting.length < 2) {
    troubleshooting.push({
      q: `Something still does not work for ${title.toLowerCase()}`,
      a: 'Refresh the dashboard, retry once, then contact support with your project link and a screenshot.',
    });
  }

  const faq = uniqueByQ([...(sections.faq || []), ...(CATEGORY_FAQ[category] || [])]);
  while (faq.length < 3) {
    faq.push({
      q: `Where do I find ${title.toLowerCase()} in Cutup?`,
      a: 'Open the matching section in your dashboard sidebar or search Help Center for this article.',
    });
  }

  const finalTips = tips.slice(0, 6);
  const finalTroubleshooting = troubleshooting.slice(0, 4);
  const finalFaq = faq.slice(0, 5);

  const overview =
    sections.content ||
    `${title} helps you get more from Cutup. This guide explains what the feature does, how to use it step by step, and how to resolve common issues.`;

  return {
    content: overview,
    steps,
    tips: finalTips,
    troubleshooting: finalTroubleshooting,
    faq: finalFaq,
  };
}
