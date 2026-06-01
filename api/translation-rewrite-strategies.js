/**
 * Language-aware subtitle rewrite strategies (localization, not generic MT polish).
 */
import { getDomainLocalizationRules } from './domain-translation-hints.js';

const LANG_LABELS = {
  en: 'English',
  fa: 'Persian (Farsi)',
  ar: 'Arabic',
  es: 'Spanish',
  ru: 'Russian',
  fr: 'French',
  de: 'German',
  tr: 'Turkish',
  hi: 'Hindi',
  tl: 'Tagalog'
};

function norm(code) {
  return String(code || '')
    .toLowerCase()
    .trim()
    .slice(0, 2);
}

const STRATEGIES = {
  fa: {
    id: 'persian_localization',
    tone: 'conversational Iranian Persian for social video',
    rules: [
      'Translate meaning, not English word order.',
      'Use Arabic script only; no Latin letters.',
      'Fitness: keep loanwords natural (ددلیفت، اسکوات).',
      'Avoid formal/literal patterns like «خوبی است», «می‌باشد».',
      'Examples: "Nice deadlift"→"ددلیفتت عالیه"; "Let\'s go"→"بزن بریم"; "Everything okay?"→"همه چیز روبه‌راهه؟"'
    ]
  },
  ar: {
    id: 'arabic_localization',
    tone: 'modern natural Arabic subtitles (MSA-friendly, spoken where appropriate)',
    rules: [
      'Use Arabic script only; avoid Latin except brand names.',
      'Prefer idiomatic Arabic over calques from English.',
      'Business: startup tone, not bureaucratic.',
      'Examples: "Let\'s go"→"يلا"; "Everything okay?"→"كله تمام؟"'
    ]
  },
  es: {
    id: 'spanish_localization',
    tone: 'natural Latin American / neutral Spanish subtitles',
    rules: [
      'Conversational Spanish for on-screen captions.',
      'Avoid overly literal English structure.',
      'Fitness: natural gym Spanish (peso muerto, sentadilla).',
      'Examples: "Nice deadlift"→"Buen peso muerto"; "Let\'s go"→"Vamos"'
    ]
  },
  ru: {
    id: 'russian_localization',
    tone: 'natural conversational Russian subtitles',
    rules: [
      'Cyrillic only; idiomatic Russian, not word-for-word.',
      'Informal spoken style where the source is casual.',
      'Examples: "Let\'s go"→"Погнали"; "Everything okay?"→"Всё нормально?"'
    ]
  },
  fr: {
    id: 'french_localization',
    tone: 'natural French subtitle French (France/neutral)',
    rules: [
      'Idiomatic French; avoid anglicisms unless source uses them.',
      'Keep lines short for screen reading.',
      'Examples: "Let\'s go"→"Allez"; "Nice deadlift"→"Beau soulevé de terre"'
    ]
  },
  de: {
    id: 'german_localization',
    tone: 'natural German subtitles (informal du where appropriate)',
    rules: [
      'Idiomatic German; avoid Denglish calques.',
      'Fitness: standard German gym terms (Kreuzheben, Kniebeuge).',
      'Examples: "Let\'s go"→"Los geht\'s"; "Everything okay?"→"Alles okay?"'
    ]
  },
  tr: {
    id: 'turkish_localization',
    tone: 'natural conversational Turkish subtitles',
    rules: [
      'Turkish script; spoken subtitle style.',
      'Avoid literal English syntax.',
      'Examples: "Let\'s go"→"Hadi"; "Everything okay?"→"Her şey yolunda mı?"'
    ]
  },
  hi: {
    id: 'hindi_localization',
    tone: 'natural Hindi subtitles in Devanagari',
    rules: [
      'Devanagari script; conversational Hindi.',
      'Avoid overly formal Sanskritized Hindi unless source is formal.',
      'Tech/business: use common Hindi loanwords where natural.'
    ]
  },
  tl: {
    id: 'tagalog_localization',
    tone: 'natural Tagalog / Filipino conversational subtitles',
    rules: [
      'Everyday Filipino; code-switch only when source does.',
      'Short readable lines for mobile video.',
      'Examples: "Let\'s go"→"Tara"; "Everything okay?"→"Okay lang ba?"'
    ]
  },
  en: {
    id: 'english_localization',
    tone: 'natural English subtitles',
    rules: [
      'Clear conversational English for captions.',
      'Fix awkward literal phrasing from other languages.'
    ]
  }
};

export function getRewriteStrategy(targetLanguage) {
  const code = norm(targetLanguage);
  return STRATEGIES[code] || STRATEGIES.en;
}

/**
 * Single-line rewrite prompts.
 */
export function buildLanguageAwareRewritePrompts(
  sourceText,
  translatedText,
  targetLanguage,
  domain = 'general'
) {
  const strategy = getRewriteStrategy(targetLanguage);
  const label = LANG_LABELS[norm(targetLanguage)] || targetLanguage;
  const rules = strategy.rules.map((r) => `- ${r}`).join('\n');
  const domainRules = getDomainLocalizationRules(domain, targetLanguage);

  return {
    systemPrompt: `You are a ${label} subtitle localizer (${strategy.id}). Rewrite into ${strategy.tone}. Preserve meaning and speaker tone. Output ONLY the rewritten subtitle line.\n\nRules:\n${rules}${domainRules}`,
    userPrompt: `Source:\n${sourceText || '(n/a)'}\n\nCurrent ${label} subtitle (rewrite to sound native):\n${translatedText}\n\nRewritten:`
  };
}

/**
 * Batch rewrite prompts (---SEGMENT--- delimited).
 * @param {{ text: string, _source?: string }[]} batch
 */
export function buildLanguageAwareRewriteBatchPrompts(targetLanguage, batch, domain = 'general') {
  const strategy = getRewriteStrategy(targetLanguage);
  const label = LANG_LABELS[norm(targetLanguage)] || targetLanguage;
  const n = batch.length;
  const rules = strategy.rules.map((r) => `- ${r}`).join('\n');
  const domainRules = getDomainLocalizationRules(domain, targetLanguage);
  const sourceBlock = batch.map((s) => s._source || s.text).join('\n---SEGMENT---\n');
  const transBlock = batch.map((s) => s.text).join('\n---SEGMENT---\n');

  return {
    systemPrompt: `You are a ${label} subtitle localizer (${strategy.id}). Rewrite each segment into ${strategy.tone}. Preserve meaning. Output exactly ${n} segments separated only by ---SEGMENT--- on its own line. No numbering.\n\nRules:\n${rules}${domainRules}`,
    userPrompt: `Source lines (${n}):\n${sourceBlock}\n\nCurrent ${label} translations (rewrite each):\n${transBlock}\n\nRewritten (${n} parts, delimiter only):`
  };
}

export const SUPPORTED_REWRITE_LANGUAGES = Object.keys(STRATEGIES);

/** Languages with dedicated localization + fluency competition passes. */
export const LANGUAGE_OPTIMIZED_TARGETS = new Set(['fa', 'ar', 'es', 'ru', 'tr', 'hi', 'tl']);

export function isLanguageOptimizedTarget(targetLanguage) {
  return LANGUAGE_OPTIMIZED_TARGETS.has(norm(targetLanguage));
}

/**
 * Attempt 3: conversational fluency polish (after localization).
 * @param {{ text: string }[]} batch
 */
export function buildFluencyRewriteBatchPrompts(targetLanguage, batch, domain = 'general') {
  const strategy = getRewriteStrategy(targetLanguage);
  const label = LANG_LABELS[norm(targetLanguage)] || targetLanguage;
  const n = batch.length;
  const block = batch.map((s) => s.text).join('\n---SEGMENT---\n');
  const domainRules = getDomainLocalizationRules(domain, targetLanguage);

  return {
    systemPrompt: `You are a ${label} subtitle fluency editor (${strategy.id}_fluency). Polish each line into natural spoken ${label} for short video captions. Keep meaning identical. Shorter is better. Output exactly ${n} segments separated only by ---SEGMENT--- on its own line.${domainRules}`,
    userPrompt: `Polish these ${n} ${label} subtitle lines for native fluency (same order, delimiter only):\n\n${block}\n\nFluent lines (${n} parts):`
  };
}
