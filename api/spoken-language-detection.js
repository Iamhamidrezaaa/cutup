/**
 * Spoken-language resolution from transcript content (accent-safe).
 * Covers all site-supported languages (see supported-languages.js).
 */
import {
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguageCode,
  normalizeLanguageCode
} from './supported-languages.js';

const LATIN_STOPWORD_PATTERNS = {
  en: /\b(the|and|is|are|was|were|you|your|this|that|with|for|to|of|in|on|it|a|an|have|has|had|do|not|but|if|so|as|at|be|he|she|they|we|my|our|their|been|being|don't|it's|what|when|where|how|why|who|can|will|would|should|could|just|like|know|think|see|want|get|going|time|very|really)\b/gi,
  fr: /\b(le|la|les|de|du|des|et|est|un|une|dans|pour|que|qui|avec|sur|pas|plus|nous|vous|ils|elles|elle|mais|ou|donc|ce|cette|ces|son|sa|ses|leur|tout|comme|très|bien|aussi|encore|être|avoir|fait|faire|dit|peut|ici|chez|sans|sous|vers|après|avant|pendant|depuis|alors|ainsi|même|mon|ton|notre|votre|quoi|quand|comment|pourquoi|où|je|tu|il|on|ne|se|me|te|lui|eux|ça|c'est|n'est|qu')\b/gi,
  es: /\b(el|la|los|las|de|del|y|es|un|una|en|por|para|que|con|su|sus|no|se|le|lo|como|más|pero|si|al|ya|muy|bien|también|este|esta|esto|ese|esa|eso|aquí|hay|ser|estar|tener|hacer|puede|porque|cuando|donde|qué|quién|nos|vos|les|me|te|lo|muy|todo|todos)\b/gi,
  de: /\b(der|die|das|und|ist|ein|eine|einen|einem|einer|nicht|auch|auf|mit|für|von|zu|im|am|an|als|wie|noch|nach|bei|nur|oder|aber|wenn|dann|schon|sehr|mehr|wir|ihr|sie|er|es|ich|du|man|den|dem|des|dass|kann|werden|wurde|haben|hat|sein|sind|war|waren|hier|dort|heute|morgen)\b/gi,
  it: /\b(il|lo|la|i|gli|le|di|del|della|dei|e|è|un|una|uno|in|per|che|con|su|non|si|come|più|ma|se|al|anche|questo|questa|questi|sono|era|essere|avere|fare|dire|può|perché|quando|dove|chi|noi|voi|loro|io|tu|lui|lei|molto|bene|tutto|tutti)\b/gi,
  pt: /\b(o|a|os|as|de|do|da|dos|das|e|é|um|uma|em|por|para|que|com|se|não|como|mais|mas|se|ao|também|este|esta|isso|esse|essa|aqui|há|ser|estar|ter|fazer|pode|porque|quando|onde|quem|nós|vos|eles|elas|eu|tu|ele|ela|muito|bem|tudo|todos)\b/gi,
  nl: /\b(de|het|een|en|is|van|in|op|met|voor|te|dat|die|dit|deze|niet|ook|als|maar|om|aan|er|hier|daar|hebben|heeft|zijn|was|waren|kunnen|worden|wordt|naar|bij|nog|al|zeer|meer|wij|jullie|zij|hij|zij|ik|jij|u|goed|alle|alleen)\b/gi,
  pl: /\b(i|w|z|na|do|to|nie|jest|że|się|o|jak|ale|czy|co|kto|gdzie|kiedy|dlaczego|ten|ta|to|ci|te|tych|mój|twój|jego|jej|nasz|wasz|ich|ja|ty|on|ona|my|wy|oni|one|być|mieć|może|bardzo|dobrze|już|też|lub|albo)\b/gi,
  tr: /\b(bir|ve|bu|da|de|için|ile|mi|mu|mı|mü|ne|nasıl|neden|nerede|kim|ben|sen|o|biz|siz|onlar|var|yok|değil|çok|daha|en|gibi|kadar|olan|olarak|ama|veya|eğer|ise|şu|o|burada|şimdi|sonra|önce|her|hiç)\b/gi,
  ro: /\b(să|și|cu|pe|la|în|un|o|nu|este|sunt|era|fost|fi|avea|are|au|pentru|că|ce|care|cum|unde|când|de|din|dar|sau|dacă|mai|foarte|bun|bine|tot|toate|eu|tu|el|ea|noi|voi|ei|ele|acest|aceast|aceasta)\b/gi,
  id: /\b(yang|dan|di|ke|dari|ini|itu|untuk|dengan|pada|adalah|tidak|akan|ada|juga|atau|jika|karena|saya|kamu|dia|kita|mereka|ini|itu|sudah|belum|bisa|boleh|sangat|lebih|semua|hanya|saja|sini|sana|apa|siapa|kapan|dimana|kenapa)\b/gi,
  vi: /\b(của|và|là|một|các|cho|với|trong|trên|đến|từ|không|có|đã|sẽ|này|đó|những|người|tôi|bạn|anh|chị|em|họ|chúng|ta|nó|rất|nhiều|khi|nếu|thì|vì|mà|để|ở|tại|đây|đó|sao|gì|ai|nào|như|vẫn|còn|được|bị)\b/gi,
  sv: /\b(och|att|det|som|en|är|av|för|på|med|till|från|den|de|inte|han|hon|vi|ni|de|jag|du|man|var|varit|vara|har|hade|kan|skulle|kommer|mycket|mer|alla|när|hur|vad|varför|där|här|också|men|eller|om|så)\b/gi
};

const SCRIPT_SCORERS = [
  { lang: 'ja', weight: 1, test: (c) => (c.match(/[\u3040-\u30FF]/g) || []).length },
  { lang: 'ko', weight: 1, test: (c) => (c.match(/[\uAC00-\uD7AF]/g) || []).length },
  { lang: 'zh', weight: 0.95, test: (c) => (c.match(/[\u4E00-\u9FFF]/g) || []).length },
  { lang: 'ru', weight: 1, test: (c) => (c.match(/[\u0400-\u04FF]/g) || []).length },
  { lang: 'uk', weight: 0.35, test: (c) => (c.match(/[\u0400-\u04FF]/g) || []).length },
  { lang: 'he', weight: 1, test: (c) => (c.match(/[\u0590-\u05FF]/g) || []).length },
  { lang: 'th', weight: 1, test: (c) => (c.match(/[\u0E00-\u0E7F]/g) || []).length },
  { lang: 'my', weight: 1, test: (c) => (c.match(/[\u1000-\u109F]/g) || []).length },
  { lang: 'ka', weight: 1, test: (c) => (c.match(/[\u10A0-\u10FF]/g) || []).length },
  { lang: 'hy', weight: 1, test: (c) => (c.match(/[\u0530-\u058F]/g) || []).length },
  { lang: 'el', weight: 1, test: (c) => (c.match(/[\u0370-\u03FF]/g) || []).length },
  { lang: 'hi', weight: 0.85, test: (c) => (c.match(/[\u0900-\u097F]/g) || []).length },
  { lang: 'mr', weight: 0.5, test: (c) => (c.match(/[\u0900-\u097F]/g) || []).length },
  { lang: 'ne', weight: 0.4, test: (c) => (c.match(/[\u0900-\u097F]/g) || []).length },
  { lang: 'bn', weight: 1, test: (c) => (c.match(/[\u0980-\u09FF]/g) || []).length },
  { lang: 'ta', weight: 1, test: (c) => (c.match(/[\u0B80-\u0BFF]/g) || []).length },
  { lang: 'te', weight: 1, test: (c) => (c.match(/[\u0C00-\u0C7F]/g) || []).length },
  { lang: 'kn', weight: 1, test: (c) => (c.match(/[\u0C80-\u0CFF]/g) || []).length },
  { lang: 'ml', weight: 1, test: (c) => (c.match(/[\u0D00-\u0D7F]/g) || []).length },
  { lang: 'gu', weight: 1, test: (c) => (c.match(/[\u0A80-\u0AFF]/g) || []).length },
  { lang: 'pa', weight: 1, test: (c) => (c.match(/[\u0A00-\u0A7F]/g) || []).length },
  { lang: 'or', weight: 1, test: (c) => (c.match(/[\u0B00-\u0B7F]/g) || []).length },
  { lang: 'si', weight: 1, test: (c) => (c.match(/[\u0D80-\u0DFF]/g) || []).length },
  { lang: 'km', weight: 1, test: (c) => (c.match(/[\u1780-\u17FF]/g) || []).length },
  { lang: 'lo', weight: 1, test: (c) => (c.match(/[\u0E80-\u0EFF]/g) || []).length }
];

function scorePersianVsArabic(corpus) {
  const arabic = (corpus.match(/[\u0600-\u06FF]/g) || []).length;
  if (!arabic) return { fa: 0, ar: 0 };
  const persianMarkers = (corpus.match(/[\u067E\u0686\u0698\u06AF\u06CC\u06A9\u06BE]/g) || []).length;
  const fa = arabic / Math.max(1, corpus.length) + (persianMarkers / Math.max(1, arabic)) * 0.35;
  const ar = arabic / Math.max(1, corpus.length) * (persianMarkers < arabic * 0.02 ? 1 : 0.45);
  return { fa, ar };
}

function normalizeWhisperLang(code) {
  return normalizeLanguageCode(code);
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
  const wordCount = Math.max(1, corpus.split(/\s+/).filter(Boolean).length);

  const scores = {};
  for (const code of SUPPORTED_LANGUAGE_CODES) scores[code] = 0;

  const latin = (corpus.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const densities = {};

  for (const [lang, pattern] of Object.entries(LATIN_STOPWORD_PATTERNS)) {
    const hits = (corpus.match(pattern) || []).length;
    const density = hits / wordCount;
    densities[`${lang}WordDensity`] = Number(density.toFixed(4));
    if (isSupportedLanguageCode(lang)) {
      scores[lang] = Math.max(scores[lang] || 0, density * 0.62);
    }
  }

  for (const { lang, weight, test } of SCRIPT_SCORERS) {
    const count = test(corpus);
    if (count > 0 && isSupportedLanguageCode(lang)) {
      scores[lang] = Math.max(scores[lang] || 0, (count / len) * weight);
    }
  }

  const { fa, ar } = scorePersianVsArabic(corpus);
  if (fa > 0) scores.fa = Math.max(scores.fa || 0, fa);
  if (ar > 0) scores.ar = Math.max(scores.ar || 0, ar);

  const urduMarkers = (corpus.match(/[\u0679\u0688\u0691\u06BA\u06D2]/g) || []).length;
  if (urduMarkers > 2) scores.ur = Math.max(scores.ur || 0, urduMarkers / len);

  let maxLatinDensity = 0;
  for (const lang of Object.keys(LATIN_STOPWORD_PATTERNS)) {
    maxLatinDensity = Math.max(maxLatinDensity, densities[`${lang}WordDensity`] || 0);
  }
  if (maxLatinDensity < 0.03 && latin / len > 0.3) {
    scores.en = Math.max(scores.en || 0, latin / len * 0.08);
  }

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
    cyrillicRatio: Number(((corpus.match(/[\u0400-\u04FF]/g) || []).length / len).toFixed(4)),
    arabicScriptRatio: Number(((corpus.match(/[\u0600-\u06FF]/g) || []).length / len).toFixed(4)),
    wordCount,
    densities,
    scores,
    top,
    confidence: Number(confidence.toFixed(4)),
    ranked: ranked.slice(0, 8).map(([lang, score]) => ({ lang, score: Number(score.toFixed(4)) }))
  };
}

function scoreForLang(analysis, lang) {
  return Number(analysis.scores?.[lang] || 0);
}

function latinDensity(analysis, lang) {
  return Number(analysis.densities?.[`${lang}WordDensity`] || 0);
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

  let detectedLanguage =
    whisperNorm !== 'unknown' && isSupportedLanguageCode(whisperNorm) ? whisperNorm : contentTop;
  let confidence = analysis.confidence;
  let resolution = whisperNorm !== 'unknown' ? 'whisper' : 'transcript_content_only';

  const enScore = scoreForLang(analysis, 'en');
  const ruScore = scoreForLang(analysis, 'ru');
  const faScore = scoreForLang(analysis, 'fa');

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
  } else if (whisperNorm === 'unknown' && isSupportedLanguageCode(contentTop)) {
    detectedLanguage = contentTop;
    confidence = analysis.confidence;
    resolution = 'transcript_content_only';
  } else if (
    isSupportedLanguageCode(whisperNorm) &&
    contentTop === whisperNorm &&
    whisperNorm !== 'unknown'
  ) {
    confidence = Math.min(0.98, analysis.confidence + 0.08);
    resolution = 'whisper_confirmed_by_text';
  } else if (
    isSupportedLanguageCode(contentTop) &&
    contentTop !== whisperNorm &&
    whisperNorm !== 'unknown'
  ) {
    const topScore = scoreForLang(analysis, contentTop);
    const whisperScore = scoreForLang(analysis, whisperNorm);
    const density = latinDensity(analysis, contentTop);
    const strongLatin = density >= 0.045;
    const strongScript = topScore >= 0.12;
    if (
      analysis.confidence >= 0.48 &&
      topScore > whisperScore * 1.15 &&
      (strongLatin || strongScript || analysis.top === contentTop)
    ) {
      detectedLanguage = contentTop;
      confidence = analysis.confidence;
      resolution = 'transcript_content_preferred';
    }
  } else if (
    isSupportedLanguageCode(whisperNorm) &&
    !isSupportedLanguageCode(contentTop) &&
    whisperNorm !== 'unknown'
  ) {
    detectedLanguage = whisperNorm;
    resolution = 'whisper_supported_fallback';
  }

  if (!isSupportedLanguageCode(detectedLanguage)) {
    detectedLanguage = isSupportedLanguageCode(contentTop)
      ? contentTop
      : isSupportedLanguageCode(whisperNorm)
        ? whisperNorm
        : 'unknown';
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
      ranked: analysis.ranked
    }
  };

  console.log('[spoken-language-detection]', payload);
  return payload;
}

const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Hardened language confidence for telemetry and gating.
 * @returns {{ language, confidence, detectedBy, needsReview, transcriptSample, whisperLanguage }}
 */
export function buildLanguageConfidence(whisperLanguage, text, segments = []) {
  const resolved = resolveSpokenLanguage(whisperLanguage, text, segments);
  const detectedBy = resolved.resolution || 'whisper';
  const confidence = Number(resolved.confidence ?? 0.5);
  const needsReview = confidence < REVIEW_CONFIDENCE_THRESHOLD;

  const payload = {
    language: resolved.detectedLanguage,
    confidence,
    detectedBy,
    needsReview,
    transcriptSample: resolved.transcriptSample,
    whisperLanguage: resolved.whisperLanguage
  };

  console.log('[language-confidence]', payload);
  return payload;
}
