/**
 * GET /api/tools-content?type=youtube-to-text
 * Generates long-form SEO JSON via OpenAI (cached in-memory).
 * Falls back to unique static copy if the model is unavailable.
 */
import OpenAI from 'openai';
import { handleCORS } from './cors.js';

const cache = new Map();

const PUBLIC_SITE = process.env.CUTUP_PUBLIC_URL || 'https://cutup.shop';

function pingGoogleFireAndForget() {
  fetch(`${PUBLIC_SITE}/api/ping-google`).catch(() => {});
}

const TOOL_SEED = {
  'youtube-to-text': {
    name: 'YouTube to text',
    summary: 'Turn YouTube links into editable transcripts and timed subtitles with Cutup.',
    audience: 'creators, students, editors, and teams who repurpose video',
  },
  'instagram-subtitles': {
    name: 'Instagram subtitles',
    summary: 'Generate captions and subtitle drafts for Instagram Reels and supported video URLs.',
    audience: 'social creators, agencies, and brands posting short-form video',
  },
  'tiktok-caption-generator': {
    name: 'TikTok caption generator',
    summary: 'Create caption and transcript drafts from TikTok links for fast short-form workflows.',
    audience: 'TikTok creators, editors, and marketers',
  },
};

function sanitizeType(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(s)) return '';
  return s;
}

function seedForType(type) {
  if (TOOL_SEED[type]) return TOOL_SEED[type];
  const readable = type.replace(/-/g, ' ');
  return {
    name: readable,
    summary: `Cutup helps teams turn video into subtitles and transcripts for ${readable}.`,
    audience: 'creators and teams using Cutup',
  };
}

function parseJsonFromModel(text) {
  let s = String(text || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error('Invalid JSON from model');
  }
}

function normalizeFaqs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (!x || typeof x !== 'object') return null;
      const question = String(x.question ?? x.q ?? '').trim();
      const answer = String(x.answer ?? x.a ?? '').trim();
      if (!question || !answer) return null;
      return { question, answer };
    })
    .filter(Boolean);
}

function normalizePayload(raw) {
  const benefits = Array.isArray(raw.benefits) ? raw.benefits.map((x) => String(x).trim()).filter(Boolean) : [];
  const useCasesExpanded = Array.isArray(raw.useCasesExpanded)
    ? raw.useCasesExpanded.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const examples = Array.isArray(raw.examples)
    ? raw.examples.map((x) => String(x).trim()).filter(Boolean)
    : [];
  return {
    introExpanded: String(raw.introExpanded ?? '').trim(),
    howItWorks: String(raw.howItWorks ?? '').trim(),
    benefits,
    useCasesExpanded,
    faqsExpanded: normalizeFaqs(raw.faqsExpanded),
    comparison: String(raw.comparison ?? '').trim(),
    tips: String(raw.tips ?? '').trim(),
    mistakes: String(raw.mistakes ?? '').trim(),
    examples,
  };
}

function buildPrompt(type, seed) {
  return `You are writing long-form SEO body copy for Cutup (cutup.shop), a product that converts video links and files into subtitles and transcripts.

Tool landing focus: "${seed.name}"
One-line product angle: ${seed.summary}
Primary audience: ${seed.audience}

Write in natural English. Be specific and useful. No filler, no hype, no keyword stuffing. No HTML tags. No markdown headings in the values—plain text only; you may use newline characters (\\n) between paragraphs within a string field.

Return a single JSON object with exactly these keys:
- "introExpanded": string, about 220–320 words across 2–4 paragraphs (separate with \\n\\n). Explain who this workflow helps and what problem it solves.
- "howItWorks": string, about 280–380 words across 2–5 paragraphs (\\n\\n). Describe the user workflow: paste link, preview, edit, export—without inventing features Cutup does not have. Stay high-level.
- "benefits": array of 6–8 short strings (one clear benefit each, no numbering prefix).
- "useCasesExpanded": array of 5–7 strings; each 2–4 sentences describing a concrete scenario.
- "faqsExpanded": array of 6–10 objects with "question" and "answer" strings; answers 2–5 sentences; include accuracy, limits, and privacy at a sensible generic level.
- "comparison": string, about 180–260 words (\\n\\n between paragraphs). Compare manual transcription / native captions only briefly vs. using a dedicated tool like Cutup—balanced, not attacking competitors by name.
- "tips": string, about 180–260 words (\\n\\n). Actionable tips for getting cleaner captions (audio, pacing, review).
- "mistakes": string, about 160–240 words (\\n\\n). Common mistakes people make in this workflow and how to avoid them.
- "examples": array of 4–6 short strings; each describes a concrete before/after or sample workflow tip.

Target roughly 1200–2000 words total across all fields combined.`;
}

function buildFallbackPayload(type, seed) {
  const n = seed.name;
  const faq = (q, a) => ({ question: q, answer: a });
  const baseIntro = `This guide explains how to get reliable text and subtitles from video when your focus is ${n.toLowerCase()}. ${seed.summary} Whether you publish weekly or batch a semester of lectures, the same pattern applies: start with clean audio, generate a draft transcript or captions, then edit for accuracy before you export.\n\nCutup is built for creators and teams who need a fast first pass without sacrificing review time. You can explore every Cutup workflow from the tools hub, compare approaches on the blog, and jump into the editor from the homepage whenever you are ready.`;
  const baseHow = `Start by opening Cutup and choosing the workflow that matches your source. Paste a supported link or upload a file, then run a preview so you can scan the transcript or captions before you commit time to polishing.\n\nNext, read through the first minute carefully. Names, numbers, and jargon are where automated drafts usually need a human touch. Fix those early so you do not repeat the same correction hundreds of times.\n\nWhen the wording looks trustworthy, export in the format your editor expects—often plain text, SRT, or a subtitle draft you can tweak in your NLE. If you collaborate, share the text version first so reviewers can comment without downloading large video files.\n\nFinally, archive the final transcript alongside the project. Searchable text makes future repurposing—quotes, chapters, blog posts—much cheaper than re-watching entire videos.`;
  const baseCompare = `Manual transcription is accurate but slow for long-form video. Platform-native auto captions can be convenient yet may lack export options or consistency across episodes.\n\nA dedicated pipeline keeps you in one place: preview, edit, export, repeat. That matters when you ship on a schedule and cannot afford scattered tools or mismatched caption styles.`;
  const baseTips = `Prioritize microphone placement and room tone before you rely on any automated pass. Short sentences and clear pacing improve line breaks in captions. Batch similar videos in one sitting so your terminology stays consistent.\n\nAlways spot-check timestamps near music, cross-talk, or heavy accents. Keep a short glossary of product names and speaker labels to paste when you see repeat errors.`;

  if (type === 'youtube-to-text') {
    return normalizePayload({
      introExpanded: `${baseIntro}\n\nYouTube creators often need transcripts for descriptions, newsletters, and accessibility. The goal is not perfection on the first click—it is a strong draft you can trust after a focused edit pass.`,
      howItWorks: `${baseHow}\n\nFor YouTube specifically, confirm you have rights to the audio you are processing and that your use follows channel and platform policies. Treat the transcript as editorial content: verify quotes before you publish them elsewhere.`,
      benefits: [
        'Faster first drafts for long interviews and livestreams',
        'Searchable text for repurposing clips into articles',
        'Cleaner handoff to editors who do not want to scrub video',
        'More consistent spelling of channel-specific vocabulary',
        'Easier accessibility documentation for public uploads',
        'Less rework when sponsors require quoted approvals',
      ],
      useCasesExpanded: [
        'A news commentator archives every weekly episode as text so researchers can quote accurately without scrubbing video.',
        'A course creator turns module intros into lesson outlines by editing an exported transcript instead of retyping.',
        'A podcast editor ships show notes the same day by starting from timed text and trimming redundant segments.',
      ],
      faqsExpanded: [
        faq('Do I still need to review the transcript?', 'Yes. Automated drafts save time, but you should verify names, numbers, and sensitive quotes before publishing.'),
        faq('Can I use transcripts for accessibility?', 'Accessible publishing typically requires accurate captions. Use drafts as a starting point, then correct errors users would notice.'),
        faq('Where do I start in Cutup?', 'Open the tools page, pick the YouTube workflow, then continue in the main editor linked from the homepage.'),
      ],
      comparison: baseCompare,
      tips: `${baseTips}\n\nIf chapters matter, align headings with natural topic shifts you see in the transcript rather than arbitrary timecodes.`,
      mistakes: `Skipping the audio check is the most common mistake: noisy rooms produce confident-looking errors. Another pitfall is exporting before normalizing spelling of recurring names, which makes later searches unreliable. Avoid publishing pull-quotes without verifying the exact wording against the recording.\n\nTreat timecodes as approximate until you spot-check a few transitions, especially on music-heavy segments.`,
      examples: [
        'Interview: export text, highlight three pull quotes, paste into a Substack draft.',
        'Tutorial: fix product names once in the first paragraph, then search-replace downstream.',
        'Livestream: trim filler words in the transcript before turning highlights into Shorts scripts.',
      ],
    });
  }

  if (type === 'instagram-subtitles') {
    return normalizePayload({
      introExpanded: `${baseIntro}\n\nShort-form video on Instagram rewards legible captions: many viewers watch muted. Your subtitles should be concise, on-beat, and easy to read on a phone.`,
      howItWorks: `${baseHow}\n\nFor Reels and short clips, aim for one idea per line. Read the draft out loud; if a line feels crowded on screen, split it. Export a subtitle file your editor accepts, then re-import to verify timing against the final cut.`,
      benefits: [
        'Readable first drafts for vertical video',
        'Faster iteration when you batch similar Reels',
        'Consistent line lengths across a campaign',
        'Easier collaboration with agencies reviewing copy',
        'Less back-and-forth on spelling of brand terms',
        'Cleaner archives of what was actually said on camera',
      ],
      useCasesExpanded: [
        'A skincare brand generates caption drafts for twenty UGC clips in one afternoon, then legal reviews only the on-screen text.',
        'A creator coach exports subtitles to teach students how to tighten hooks without rewatching every take.',
      ],
      faqsExpanded: [
        faq('Are short captions different from long-form subtitles?', 'Usually yes: shorter lines and faster pacing matter more on small screens.'),
        faq('Should I verify timing?', 'Always spot-check cuts, stickers, and jump cuts that can shift perceived pacing.'),
        faq('Where can I read more?', 'Visit the Cutup blog for workflow ideas, or open tools.html for every supported workflow.'),
      ],
      comparison: baseCompare,
      tips: `${baseTips}\n\nAvoid dense punctuation in captions; em dashes that look fine in prose can crowd a phone display.`,
      mistakes: `Using full paragraphs on-screen is a common mistake—split thoughts. Another is trusting the first draft for regulated claims; marketing language still needs human review. Do not forget to check safe zones so captions are not covered by UI chrome.\n\nSkipping a silent preview on a real device often hides readability issues until after publish.`,
      examples: [
        'Hook line under 42 characters, second line adds context, third line CTA.',
        'Export SRT, import to editor, nudge two lines that clash with on-screen text.',
      ],
    });
  }

  if (type === 'tiktok-caption-generator') {
    return normalizePayload({
      introExpanded: `${baseIntro}\n\nTikTok-style pacing rewards punchy lines. Captions should reinforce the hook in the first second and stay readable while viewers scroll.`,
      howItWorks: `${baseHow}\n\nFor TikTok workflows, iterate hooks: generate a draft, tighten the first two lines, then regenerate timing if your edit changes beat drops. Keep a swipe file of lines that performed well so you can reuse structural patterns without copying verbatim.`,
      benefits: [
        'Hook-first drafts that match fast pacing',
        'Repeatable caption structure across a series',
        'Less time rewatching to type lines manually',
        'Cleaner collaboration between creator and editor',
        'Easier compliance review when claims appear on-screen',
        'Better documentation of what was promised in-video',
      ],
      useCasesExpanded: [
        'A growth team tests three hook variants by editing caption text before re-exporting timed files.',
        'A musician publishes lyric-forward clips with reviewed captions to reduce misheard lines.',
      ],
      faqsExpanded: [
        faq('How tight should lines be?', 'Shorter is usually better; read on a phone and remove filler words.'),
        faq('Do I need to disclose promos?', 'Follow platform and regional rules; captions do not replace legal disclosures.'),
        faq('What if I need other tools?', 'Browse tools.html and link back to the homepage editor when you are ready to process video.'),
      ],
      comparison: baseCompare,
      tips: `${baseTips}\n\nIf you rely on trending sounds, verify captions still make sense when audio is muted.`,
      mistakes: `Matching text to the wrong beat is common after aggressive edits—re-sync after picture lock. Another mistake is stacking hashtags inside captions instead of the caption field metadata.\n\nPublishing without reviewing on-screen safe zones can hide key words behind buttons.`,
      examples: [
        'Hook: problem in five words, second line: twist, third line: CTA.',
        'Export, import, shift two timestamps after trimming dead air at the top.',
      ],
    });
  }

  return normalizePayload({
    introExpanded: `${baseIntro}\n\nThis page focuses on ${n}. Adjust the workflow to your platform, but keep the same review discipline.`,
    howItWorks: baseHow,
    benefits: [
      'Faster drafts for spoken content',
      'Easier editing with text instead of scrubbing video',
      'Better consistency across a content calendar',
      'Simpler handoffs for reviewers',
      'Searchable archives of what was said',
      'Stronger accessibility when paired with human review',
    ],
    useCasesExpanded: [
      'Teams repurpose webinars into articles starting from an edited transcript.',
      'Studios sync naming conventions across episodes using a shared glossary.',
    ],
    faqsExpanded: [
      faq('Is automation enough on its own?', 'Use it as a draft; human review still matters for accuracy and compliance.'),
      faq('Where should I go next?', 'Use tools.html for all workflows, blog.html for guides, and the homepage to open the editor.'),
    ],
    comparison: baseCompare,
    tips: baseTips,
    mistakes: `Skipping review, ignoring audio quality, and exporting before normalizing repeated terms are the most common issues.\n\nAvoid publishing quotes you have not verified against the recording.`,
    examples: ['Paste a link, preview, edit the first minute, export text.', 'Share the transcript doc with legal before on-screen claims go live.'],
  });
}

async function generateWithOpenAI(type, seed) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_KEY';
    throw err;
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You write factual, helpful marketing and SEO copy. Output only valid JSON matching the user schema. Never include markdown code fences.',
      },
      { role: 'user', content: buildPrompt(type, seed) },
    ],
    temperature: 0.65,
    max_tokens: 6500,
  });

  const rawText = completion.choices[0]?.message?.content;
  if (!rawText) throw new Error('Empty model response');
  const parsed = parseJsonFromModel(rawText);
  return normalizePayload(parsed);
}

export default async function handler(req, res) {
  const corsEarly = handleCORS(req, res);
  if (corsEarly) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = sanitizeType(req.query?.type);
  if (!type) {
    return res.status(400).json({ error: 'Invalid or missing type parameter' });
  }

  if (cache.has(type)) {
    return res.status(200).json(cache.get(type));
  }

  const seed = seedForType(type);
  let usedModel = false;
  let payload;

  try {
    payload = await generateWithOpenAI(type, seed);
    usedModel = true;
  } catch (e) {
    console.error('[tools-content]', e?.message || e);
    payload = buildFallbackPayload(type, seed);
  }

  cache.set(type, payload);
  if (usedModel) {
    pingGoogleFireAndForget();
  }
  return res.status(200).json(payload);
}
