/**
 * Remove translation-prompt few-shot phrases that must never appear as subtitle cues.
 */

const PROMPT_ARTIFACT_RE = /→|(?:\(NOT\s*")|Examples:\s*"/i;

/** Known few-shot lines from rewrite / fluency / domain hints (not dialogue). */
const LEAK_PHRASE_RES = [
  /به\s+خوبی\s+انجام\s+می(?:دهی|دی|د|‌دهی|‌دی|دهید|دید)[^.،!?\s]*/giu,
  /(?:^|[\s،,])وای\s+ددلیفت(?:ت)?\s+عالیه/giu,
  /(?:^|[\s،,])وای\s+اسکوات(?:ت)?\s+هم\s+عالیه/giu,
  /این\s+بنچ\s+پرش\s+عالیه/giu,
  /ددلیفت(?:ت)?\s+عالیه/giu,
  /اسکوات(?:ت)?\s+هم\s+عالیه/giu,
  /بنچ\s+پرش\s+عالیه/giu,
  /ددلیفت\s+خوبی\s+است/giu,
  /بزن\s+بریم/giu,
  /همه\s+چیز\s+روبه‌?راهه[؟?]/giu,
  /"[^"]*"\s*→\s*"[^"]*"/gi
];

const LEAK_EXACT_NORMALIZED = new Set(
  [
    'ددلیفتت عالیه',
    'ددلیفت عالیه',
    'وای ددلیفت عالیه',
    'وای ددلیفتت عالیه',
    'وای اسکواتت هم عالیه',
    'این بنچ پرش عالیه',
    'بزن بریم',
    'همه چیز روبه‌راهه؟',
    'همه چیز روبه راهه؟',
    'به خوبی انجام میدی',
    'به خوبی انجام می‌دی',
    'nice deadlift',
    'lets go'
  ].map((s) => normalizeKey(s))
);

function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isKnownPromptLeakPhrase(text) {
  const key = normalizeKey(text);
  if (!key) return false;
  if (LEAK_EXACT_NORMALIZED.has(key)) return true;
  for (const exact of LEAK_EXACT_NORMALIZED) {
    if (key.includes(exact) && key.length <= exact.length + 8) return true;
  }
  return false;
}

export function stripTranslationPromptLeakage(text) {
  let t = String(text || '');
  if (!t.trim()) return '';

  if (PROMPT_ARTIFACT_RE.test(t)) {
    t = t.replace(/"[^"]*"\s*→\s*"[^"]*"/gi, ' ');
    t = t.replace(/\(NOT\s*"[^"]*"\)/gi, ' ');
    t = t.replace(/Examples:\s*"[^"]*"\s*→\s*"[^"]*"/gi, ' ');
  }

  for (const re of LEAK_PHRASE_RES) {
    t = t.replace(re, ' ');
  }

  return t.replace(/\s{2,}/g, ' ').replace(/^[،,\s]+|[،,\s]+$/g, '').trim();
}

/**
 * @param {string} text translated cue
 * @param {string} [sourceText] matching source line for fallback
 */
export function sanitizeTranslationCueText(text, sourceText = '') {
  const before = String(text || '').trim();
  if (isKnownPromptLeakPhrase(before)) {
    return '';
  }

  let cleaned = stripTranslationPromptLeakage(before);
  if (!cleaned) {
    return '';
  }

  if (isKnownPromptLeakPhrase(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * @param {{ start, end, text }[]} segments
 * @param {{ start, end, text }[]} [sourceSegments]
 */
export function sanitizeTranslatedSegments(segments, sourceSegments = []) {
  const src = Array.isArray(sourceSegments) ? sourceSegments : [];
  const out = [];
  for (let i = 0; i < (segments || []).length; i++) {
    const seg = segments[i];
    if (!seg || typeof seg.start !== 'number' || typeof seg.end !== 'number') continue;
    const text = sanitizeTranslationCueText(seg.text, src[i]?.text);
    if (!text) continue;
    out.push({
      start: Number(seg.start),
      end: Number(seg.end),
      text
    });
  }
  return out;
}
