/**
 * GET /api/tools-content?type=youtube-to-text
 * Generates long-form SEO JSON via OpenAI (cached in-memory).
 */
import OpenAI from 'openai';
import { handleCORS } from './cors.js';

const cache = new Map();

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
  return {
    introExpanded: String(raw.introExpanded ?? '').trim(),
    howItWorks: String(raw.howItWorks ?? '').trim(),
    benefits,
    useCasesExpanded,
    faqsExpanded: normalizeFaqs(raw.faqsExpanded),
    comparison: String(raw.comparison ?? '').trim(),
    tips: String(raw.tips ?? '').trim(),
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

Target roughly 1200–2000 words total across all fields combined.`;
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

  try {
    const seed = seedForType(type);
    const payload = await generateWithOpenAI(type, seed);
    cache.set(type, payload);
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[tools-content]', e?.message || e);
    const status = e?.code === 'NO_KEY' ? 503 : 500;
    return res.status(status).json({
      error: 'Could not generate content',
      details: process.env.NODE_ENV === 'development' ? String(e?.message || e) : undefined,
    });
  }
}
