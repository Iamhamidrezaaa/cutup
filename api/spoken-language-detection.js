/**
 * Spoken-language resolution from transcript content (accent-safe).
 * Whisper/acoustic detection can mis-label accented English as Russian, etc.
 */

const EN_STOPWORDS =
  /\b(the|and|is|are|was|were|you|your|i|we|they|this|that|with|for|to|of|in|on|it|a|an|have|has|had|do|does|did|will|would|can|could|should|nice|good|like|just|what|when|where|how|why|who|my|our|their|been|being|don't|it's|i'm|we're|you're|not|but|if|so|as|at|be|he|she|his|her|them|us|me|him|all|one|get|got|go|going|want|know|think|see|make|made|time|way|very|really|deadlift|squat|bench|workout|business|money|sales|marketing)\b/gi;

const LANG_ALIASES = {
  english: 'en',
  en: 'en',
  eng: 'en',
  russian: 'ru',
  ru: 'ru',
  rus: 'ru',
  persian: 'fa',
  farsi: 'fa',
  fa: 'fa',
  fas: 'fa',
  per: 'fa',
  arabic: 'ar',
  ar: 'ar',
  german: 'de',
  de: 'de',
  french: 'fr',
  fr: 'fr',
  spanish: 'es',
  es: 'es',
  turkish: 'tr',
  tr: 'tr',
  chinese: 'zh',
  zh: 'zh',
  japanese: 'ja',
  ja: 'ja',
  korean: 'ko',
  ko: 'ko'
};

function normalizeWhisperLang(code) {
  const raw = String(code || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, '');
  if (!raw || raw === 'unknown') return 'unknown';
  return LANG_ALIASES[raw] || raw.slice(0, 2);
}

/**
 * Content-based language scores from transcript text.
 * @param {string} text
 * @param {{ start, end, text, words? }[]} [segments]
 */
export function analyzeTranscriptLanguage(text, segments = []) {
  const parts = [];
  if (Array.isArray(segments) && segments.length) {
    for (const s of segments) parts.push(String(s?.text || ''));
  }
  if (text) parts.push(String(text));
  const corpus = parts.join(' ').trim();
  const len = Math.max(1, corpus.length);

  const latin = (corpus.match(/[A-Za-z]/g) || []).length;
  const cyrillic = (corpus.match(/[\u0400-\u04FF]/g) || []).length;
  const arabicScript = (corpus.match(/[\u0600-\u06FF]/g) || []).length;
  const han = (corpus.match(/[\u4E00-\u9FFF]/g) || []).length;
  const hangul = (corpus.match(/[\uAC00-\uD7AF]/g) || []).length;
  const japanese = (corpus.match(/[\u3040-\u30FF]/g) || []).length;

  const enWordHits = (corpus.match(EN_STOPWORDS) || []).length;
  const enWordDensity = enWordHits / Math.max(1, corpus.split(/\s+/).filter(Boolean).length);

  const scores = {
    en: latin / len + enWordDensity * 0.45,
    ru: cyrillic / len,
    fa: arabicScript / len,
    ar: arabicScript / len * 0.35,
    zh: han / len,
    ja: japanese / len,
    ko: hangul / len
  };

  const ranked = Object.entries(scores)
    .filter(([, v]) => v > 0.001)
    .sort((a, b) => b[1] - a[1]);

  const top = ranked[0]?.[0] || 'unknown';
  const topScore = ranked[0]?.[1] || 0;
  const secondScore = ranked[1]?.[1] || 0;
  const confidence =
    topScore > 0
      ? Math.min(0.99, Math.max(0.35, topScore / (topScore + secondScore + 0.08)))
      : 0.4;

  return {
    corpusLength: len,
    latinRatio: Number((latin / len).toFixed(4)),
    cyrillicRatio: Number((cyrillic / len).toFixed(4)),
    arabicScriptRatio: Number((arabicScript / len).toFixed(4)),
    enWordHits,
    enWordDensity: Number(enWordDensity.toFixed(4)),
    scores,
    top,
    confidence: Number(confidence.toFixed(4)),
    ranked: ranked.map(([lang, score]) => ({ lang, score: Number(score.toFixed(4)) }))
  };
}

/**
 * Resolve spoken language: prefer transcript content when Whisper conflicts with text.
 * @param {string} whisperLanguage
 * @param {string} text
 * @param {{ start, end, text }[]} [segments]
 */
export function resolveSpokenLanguage(whisperLanguage, text, segments = []) {
  const whisperNorm = normalizeWhisperLang(whisperLanguage);
  const analysis = analyzeTranscriptLanguage(text, segments);
  const contentTop = analysis.top;
  const sample = String(text || segments?.[0]?.text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

  let detectedLanguage = whisperNorm !== 'unknown' ? whisperNorm : contentTop;
  let confidence = analysis.confidence;
  let resolution = 'whisper';

  const enScore = analysis.scores.en || 0;
  const ruScore = analysis.scores.ru || 0;
  const faScore = analysis.scores.fa || 0;

  // Accented English often tagged as Russian by acoustic models.
  if (
    (whisperNorm === 'ru' || whisperNorm === 'uk') &&
    contentTop === 'en' &&
    analysis.latinRatio >= 0.55 &&
    analysis.cyrillicRatio < 0.08 &&
    enScore > ruScore * 1.8
  ) {
    detectedLanguage = 'en';
    confidence = Math.min(0.97, analysis.confidence + 0.12);
    resolution = 'transcript_content_override_accent';
  } else if (
    whisperNorm === 'en' &&
    contentTop === 'ru' &&
    analysis.cyrillicRatio >= 0.35 &&
    ruScore > enScore * 1.5
  ) {
    detectedLanguage = 'ru';
    confidence = analysis.confidence;
    resolution = 'transcript_content_override';
  } else if (
    (whisperNorm === 'en' || whisperNorm === 'ru' || whisperNorm === 'unknown') &&
    contentTop === 'fa' &&
    analysis.arabicScriptRatio >= 0.35 &&
    faScore > enScore * 1.2
  ) {
    detectedLanguage = 'fa';
    confidence = analysis.confidence;
    resolution = 'transcript_content_override';
  } else if (whisperNorm === 'unknown' && contentTop !== 'unknown') {
    detectedLanguage = contentTop;
    confidence = analysis.confidence;
    resolution = 'transcript_content_only';
  } else if (contentTop === whisperNorm && whisperNorm !== 'unknown') {
    confidence = Math.min(0.98, analysis.confidence + 0.08);
    resolution = 'whisper_confirmed_by_text';
  } else if (contentTop !== whisperNorm && whisperNorm !== 'unknown') {
    // Low-confidence whisper vs clear text winner
    if (analysis.confidence >= 0.55 && (analysis.scores[contentTop] || 0) > (analysis.scores[whisperNorm] || 0) * 1.35) {
      detectedLanguage = contentTop;
      confidence = analysis.confidence;
      resolution = 'transcript_content_preferred';
    }
  }

  const payload = {
    detectedLanguage,
    whisperLanguage: whisperNorm,
    confidence,
    resolution,
    transcriptSample: sample,
    analysis: {
      top: analysis.top,
      latinRatio: analysis.latinRatio,
      cyrillicRatio: analysis.cyrillicRatio,
      arabicScriptRatio: analysis.arabicScriptRatio,
      enWordHits: analysis.enWordHits,
      ranked: analysis.ranked
    }
  };

  console.log('[spoken-language-detection]', payload);
  return payload;
}
