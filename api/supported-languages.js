/**
 * Site-supported spoken/translation languages (sync with website TRANSLATION_LANGUAGE_OPTIONS).
 * Backend list is unchanged when ENABLE_RTL_LANGUAGES is off — only UI selectors hide RTL codes.
 */

export const SUPPORTED_LANGUAGE_CODES = Object.freeze([
  'en', 'es', 'zh', 'hi', 'fa', 'ar', 'fr', 'bn', 'ru', 'pt', 'ur', 'id', 'de', 'ja', 'sw', 'mr', 'te',
  'tr', 'ta', 'vi', 'ko', 'it', 'th', 'gu', 'pl', 'uk', 'kn', 'ml', 'or', 'pa', 'ro', 'nl', 'ps', 'az',
  'am', 'my', 'yo', 'ig', 'sd', 'ne', 'si', 'km', 'ku', 'uz', 'su', 'ha', 'ny', 'mg', 'xh', 'zu', 'af',
  'he', 'cs', 'el', 'sv', 'hu', 'be', 'bg', 'sr', 'da', 'fi', 'no', 'sk', 'ka', 'hy', 'sq', 'hr', 'bs',
  'sl', 'lt', 'lo', 'ht', 'ca'
]);

const SUPPORTED_SET = new Set(SUPPORTED_LANGUAGE_CODES);

/** Whisper / metadata / display-name aliases → ISO 639-1 */
export const LANGUAGE_ALIASES = Object.freeze({
  english: 'en',
  eng: 'en',
  en: 'en',
  spanish: 'es',
  espanol: 'es',
  es: 'es',
  chinese: 'zh',
  mandarin: 'zh',
  zh: 'zh',
  hindi: 'hi',
  hi: 'hi',
  persian: 'fa',
  farsi: 'fa',
  fa: 'fa',
  fas: 'fa',
  per: 'fa',
  arabic: 'ar',
  ar: 'ar',
  french: 'fr',
  francais: 'fr',
  fr: 'fr',
  bengali: 'bn',
  bn: 'bn',
  russian: 'ru',
  rus: 'ru',
  ru: 'ru',
  portuguese: 'pt',
  pt: 'pt',
  urdu: 'ur',
  ur: 'ur',
  indonesian: 'id',
  id: 'id',
  german: 'de',
  deutsch: 'de',
  de: 'de',
  japanese: 'ja',
  ja: 'ja',
  swahili: 'sw',
  sw: 'sw',
  marathi: 'mr',
  mr: 'mr',
  telugu: 'te',
  te: 'te',
  turkish: 'tr',
  tr: 'tr',
  tamil: 'ta',
  ta: 'ta',
  vietnamese: 'vi',
  vi: 'vi',
  korean: 'ko',
  ko: 'ko',
  italian: 'it',
  it: 'it',
  thai: 'th',
  th: 'th',
  gujarati: 'gu',
  gu: 'gu',
  polish: 'pl',
  pl: 'pl',
  ukrainian: 'uk',
  uk: 'uk',
  kannada: 'kn',
  kn: 'kn',
  malayalam: 'ml',
  ml: 'ml',
  odia: 'or',
  or: 'or',
  punjabi: 'pa',
  pa: 'pa',
  romanian: 'ro',
  ro: 'ro',
  dutch: 'nl',
  nl: 'nl',
  pashto: 'ps',
  ps: 'ps',
  azerbaijani: 'az',
  az: 'az',
  amharic: 'am',
  am: 'am',
  burmese: 'my',
  my: 'my',
  yoruba: 'yo',
  yo: 'yo',
  igbo: 'ig',
  ig: 'ig',
  sindhi: 'sd',
  sd: 'sd',
  nepali: 'ne',
  ne: 'ne',
  sinhala: 'si',
  si: 'si',
  khmer: 'km',
  km: 'km',
  kurdish: 'ku',
  ku: 'ku',
  uzbek: 'uz',
  uz: 'uz',
  sundanese: 'su',
  su: 'su',
  hausa: 'ha',
  ha: 'ha',
  chichewa: 'ny',
  ny: 'ny',
  malagasy: 'mg',
  mg: 'mg',
  xhosa: 'xh',
  xh: 'xh',
  zulu: 'zu',
  zu: 'zu',
  afrikaans: 'af',
  af: 'af',
  hebrew: 'he',
  he: 'he',
  czech: 'cs',
  cs: 'cs',
  greek: 'el',
  el: 'el',
  swedish: 'sv',
  sv: 'sv',
  hungarian: 'hu',
  hu: 'hu',
  belarusian: 'be',
  be: 'be',
  bulgarian: 'bg',
  bg: 'bg',
  serbian: 'sr',
  sr: 'sr',
  danish: 'da',
  da: 'da',
  finnish: 'fi',
  fi: 'fi',
  norwegian: 'no',
  no: 'no',
  slovak: 'sk',
  sk: 'sk',
  georgian: 'ka',
  ka: 'ka',
  armenian: 'hy',
  hy: 'hy',
  albanian: 'sq',
  sq: 'sq',
  croatian: 'hr',
  hr: 'hr',
  bosnian: 'bs',
  bs: 'bs',
  slovenian: 'sl',
  sl: 'sl',
  lithuanian: 'lt',
  lt: 'lt',
  lao: 'lo',
  lo: 'lo',
  haitian: 'ht',
  ht: 'ht',
  catalan: 'ca',
  ca: 'ca',
  und: 'unknown',
  unknown: 'unknown'
});

/**
 * @param {string} code
 * @returns {string} ISO 639-1 or 'unknown'
 */
export function normalizeLanguageCode(code) {
  const raw = String(code || '')
    .toLowerCase()
    .trim()
    .replace(/_/g, '-');
  if (!raw || raw === 'unknown' || raw === 'und' || raw === 'auto') return 'unknown';
  const base = raw.split('-')[0].replace(/[^a-z]/g, '');
  if (!base) return 'unknown';
  const aliased = LANGUAGE_ALIASES[base] || LANGUAGE_ALIASES[raw.replace(/[^a-z]/g, '')];
  if (aliased) return aliased === 'unknown' ? 'unknown' : aliased;
  if (base.length === 2 && SUPPORTED_SET.has(base)) return base;
  return 'unknown';
}

export function isSupportedLanguageCode(code) {
  const n = normalizeLanguageCode(code);
  return n !== 'unknown' && SUPPORTED_SET.has(n);
}

/**
 * Match yt-dlp / Whisper code to a supported ISO code.
 * @param {string} code
 * @returns {string|null}
 */
export function matchSupportedFromTrackCode(code) {
  const n = normalizeLanguageCode(code);
  if (n === 'unknown') {
    const raw = normTrack(code);
    if (raw.length >= 2) {
      const two = raw.slice(0, 2);
      if (SUPPORTED_SET.has(two)) return two;
    }
    return null;
  }
  return SUPPORTED_SET.has(n) ? n : null;
}

function normTrack(code) {
  return String(code || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

/**
 * First supported language present in available tracks (product list order).
 * @param {string[]} availableTrackCodes
 * @param {string|null} [preferred]
 */
export function pickSupportedFromAvailableTracks(availableTrackCodes, preferred = null) {
  const available = [...new Set((availableTrackCodes || []).map(normTrack).filter(Boolean))];
  if (!available.length) return null;

  const pref = preferred ? normalizeLanguageCode(preferred) : 'unknown';
  if (pref !== 'unknown') {
    const hit = available.find((t) => {
      const m = matchSupportedFromTrackCode(t);
      return m === pref || t === pref || t.startsWith(`${pref}-`);
    });
    if (hit) return hit;
  }

  for (const code of SUPPORTED_LANGUAGE_CODES) {
    const hit = available.find((t) => matchSupportedFromTrackCode(t) === code);
    if (hit) return hit;
  }

  return available[0];
}
