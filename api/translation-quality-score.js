/**
 * Translation quality scoring: heuristics + optional back-translation semantic check.
 */

const PERSIAN_TARGET = new Set(['fa', 'fas', 'per', 'persian', 'farsi']);
const PERSIAN_SCRIPT_RE = /[\u0600-\u06FF]/;

/** Formal/literal Persian patterns common in bad MT. */
const LITERAL_FA_PATTERNS = [
  /\bخوبی\s+است\b/u,
  /\bعالی\s+است\b/u,
  /\bمی\s+باشد\b/u,
  /\bمی‌باشد\b/u,
  /\bمی\s+باشند\b/u,
  /\bاست\s+که\b/u,
  /\bمی\s+تواند\b/u,
  /\bمی\s+توانم\b/u,
  /\bمی\s+خواهم\b/u
];

const EN_PRAISE_RE = /\b(nice|great|good|awesome|solid|clean)\s+(deadlift|squat|bench|lift|set|rep)\b/i;
const FA_LITERAL_DEADLIFT_RE = /ددلیفت\s+خوب/i;

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

function normalizeLang(code) {
  return String(code || '')
    .toLowerCase()
    .trim()
    .slice(0, 8);
}

function isPersianTarget(lang) {
  const t = normalizeLang(lang);
  return PERSIAN_TARGET.has(t) || t.startsWith('fa');
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Jaccard overlap on word sets (0–1). */
function lexicalOverlap(a, b) {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) {
    if (sb.has(w)) inter += 1;
  }
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

function computeHeuristicFluency(sourceText, translatedText, targetLanguage) {
  const src = String(sourceText || '').trim();
  const tr = String(translatedText || '').trim();
  if (!tr) return 0;
  let score = 88;

  if (isPersianTarget(targetLanguage)) {
    if (!PERSIAN_SCRIPT_RE.test(tr)) score -= 45;
    if (/[A-Za-z]{2,}/.test(tr)) score -= 25;
    for (const re of LITERAL_FA_PATTERNS) {
      if (re.test(tr)) score -= 12;
    }
    if (EN_PRAISE_RE.test(src) && FA_LITERAL_DEADLIFT_RE.test(tr)) score -= 28;
    const words = tr.split(/\s+/).filter(Boolean);
    if (words.length > 14) score -= 8;
    if (words.length <= 2 && src.split(/\s+/).length > 3) score -= 10;
  }

  const ratio = tr.length / Math.max(1, src.length);
  if (ratio < 0.15 || ratio > 4.5) score -= 18;
  else if (ratio < 0.25 || ratio > 3.2) score -= 8;

  return clampScore(score);
}

function computeHeuristicMeaning(sourceText, translatedText, sourceLanguage, targetLanguage) {
  const src = String(sourceText || '').trim();
  const tr = String(translatedText || '').trim();
  if (!src || !tr) return 0;

  if (normalizeLang(sourceLanguage) === normalizeLang(targetLanguage)) {
    return lexicalOverlap(src, tr) >= 0.85 ? 95 : 40;
  }

  let score = 78;
  const srcWords = tokenize(src).length;
  const trWords = tokenize(tr).length;
  if (srcWords > 0) {
    const wordRatio = trWords / srcWords;
    if (wordRatio < 0.2 || wordRatio > 3.5) score -= 22;
    else if (wordRatio < 0.35 || wordRatio > 2.8) score -= 10;
  }

  if (isPersianTarget(targetLanguage) && EN_PRAISE_RE.test(src) && FA_LITERAL_DEADLIFT_RE.test(tr)) {
    score -= 30;
  }

  return clampScore(score);
}

/**
 * @param {string} sourceText
 * @param {string} backTranslatedText
 */
export function semanticMeaningScore(sourceText, backTranslatedText) {
  const overlap = lexicalOverlap(sourceText, backTranslatedText);
  return clampScore(35 + overlap * 65);
}

/**
 * Score a single source/translated pair (sync heuristics; optional async LLM).
 * @param {{ sourceText, translatedText, sourceLanguage, targetLanguage, backTranslatedText? }} input
 */
export function scoreTranslationPair(input) {
  const {
    sourceText = '',
    translatedText = '',
    sourceLanguage = 'en',
    targetLanguage = 'fa',
    backTranslatedText = null
  } = input;

  const fluencyScore = computeHeuristicFluency(sourceText, translatedText, targetLanguage);
  let meaningScore = computeHeuristicMeaning(
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage
  );

  if (backTranslatedText && String(backTranslatedText).trim()) {
    const semantic = semanticMeaningScore(sourceText, backTranslatedText);
    meaningScore = clampScore(meaningScore * 0.4 + semantic * 0.6);
  }

  const translationScore = clampScore(meaningScore * 0.55 + fluencyScore * 0.45);
  const needsRewrite = translationScore < 75;

  return {
    translationScore,
    meaningScore,
    fluencyScore,
    needsRewrite
  };
}

export function buildBackTranslationPrompts(translatedText, sourceLanguage) {
  const lang = normalizeLang(sourceLanguage) || 'en';
  const langLabel =
    lang === 'en' ? 'English' : lang === 'ru' ? 'Russian' : lang === 'fa' ? 'Persian' : lang;
  return {
    systemPrompt: `You back-translate subtitle lines into ${langLabel} for quality checking. Output ONLY the ${langLabel} meaning — no notes.`,
    userPrompt: `Back-translate this subtitle line into ${langLabel}:\n\n${translatedText}\n\n${langLabel}:`
  };
}

export function buildQualityRewritePrompts(sourceText, translatedText, targetLanguage) {
  const tgt = normalizeLang(targetLanguage);
  const examples =
    tgt === 'fa'
      ? `Examples (English → natural Persian):
- "Nice deadlift" → "ددلیفتت عالیه" (NOT "ددلیفت خوبی است")
- "Let's go" → "بزن بریم"
- "Everything okay?" → "همه چیز روبه‌راهه؟"`
      : '';

  return {
    systemPrompt: `You rewrite subtitles into natural ${tgt === 'fa' ? 'conversational Iranian Persian' : 'natural target language'}. Preserve exact meaning and tone. Remove literal/word-for-word translation. Output ONLY the rewritten subtitle line.`,
    userPrompt: `${examples}

Source (${sourceText ? 'original' : 'context'}):
${sourceText || '(see translated)'}

Current translation (rewrite to sound native):
${translatedText}

Natural rewritten line:`
  };
}

/**
 * Score multiple cue pairs; sample when large.
 * @param {{ text: string }[]} sourceSegments
 * @param {{ text: string }[]} translatedSegments
 * @param {Map<number, string>} [backTranslations] cueIndex → back-translated text
 */
export function scoreTranslationBatch(sourceSegments, translatedSegments, opts = {}) {
  const sourceLanguage = opts.sourceLanguage || 'en';
  const targetLanguage = opts.targetLanguage || 'fa';
  const backTranslations = opts.backTranslations || new Map();
  const maxSample = Math.max(1, Number(opts.maxSample || 12));

  const n = Math.min(sourceSegments.length, translatedSegments.length);
  const indices =
    n <= maxSample
      ? [...Array(n).keys()]
      : [...Array(maxSample).keys()].map((i) => Math.floor((i * n) / maxSample));

  const perCue = [];
  let sumTranslation = 0;
  let sumMeaning = 0;
  let sumFluency = 0;
  let needsRewriteCount = 0;

  for (const i of indices) {
    const scores = scoreTranslationPair({
      sourceText: sourceSegments[i]?.text,
      translatedText: translatedSegments[i]?.text,
      sourceLanguage,
      targetLanguage,
      backTranslatedText: backTranslations.get(i) || null
    });
    perCue.push({ index: i, ...scores });
    sumTranslation += scores.translationScore;
    sumMeaning += scores.meaningScore;
    sumFluency += scores.fluencyScore;
    if (scores.needsRewrite) needsRewriteCount += 1;
  }

  const count = perCue.length || 1;
  const avgTranslation = Math.round(sumTranslation / count);
  const avgMeaning = Math.round(sumMeaning / count);
  const avgFluency = Math.round(sumFluency / count);

  return {
    translationScore: avgTranslation,
    meaningScore: avgMeaning,
    fluencyScore: avgFluency,
    needsRewrite: avgTranslation < 75 || needsRewriteCount / count > 0.35,
    sampledCount: count,
    needsRewriteCount,
    perCue
  };
}

/**
 * Example scores for docs/tests (no LLM).
 */
export function exampleQualityScores() {
  return {
    literalDeadlift: scoreTranslationPair({
      sourceText: 'Nice deadlift',
      translatedText: 'ددلیفت خوبی است',
      sourceLanguage: 'en',
      targetLanguage: 'fa'
    }),
    naturalDeadlift: scoreTranslationPair({
      sourceText: 'Nice deadlift',
      translatedText: 'ددلیفتت عالیه',
      sourceLanguage: 'en',
      targetLanguage: 'fa'
    }),
    letsGo: scoreTranslationPair({
      sourceText: "Let's go",
      translatedText: 'بزن بریم',
      sourceLanguage: 'en',
      targetLanguage: 'fa',
      backTranslatedText: "let's go"
    })
  };
}
