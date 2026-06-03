/**
 * Strip translation-prompt / glossary examples that leaked into cue text (burn only).
 */

const PROMPT_ARTIFACT_RE = /→|(?:\(NOT\s*")|Examples:\s*"/i;

/** Internal coaching snippets — not for on-screen burn (system glossary). */
const LEAKAGE_SNIPPET_RES = [
  /به\s+خوبی\s+انجام\s+می(?:دهی|دی|د|‌دهی|‌دی|دهید|دید)[^.،!?\s]*/giu,
  /(?:^|[\s،,])وای\s+ددلیفت\s+عالیه/giu,
  /ددلیفت\s+عالیه\s*[،,]\s*عالیه/giu,
  /ددلیفت\s+خوبی\s+است/giu,
  /"[^"]*"\s*→\s*"[^"]*"/gi
];

export function stripBurnTranslationLeakage(text) {
  let t = String(text || '');
  if (!t.trim()) return '';

  if (PROMPT_ARTIFACT_RE.test(t)) {
    t = t.replace(/"[^"]*"\s*→\s*"[^"]*"/gi, ' ');
    t = t.replace(/\(NOT\s*"[^"]*"\)/gi, ' ');
    t = t.replace(/Examples:\s*"[^"]*"\s*→\s*"[^"]*"/gi, ' ');
  }

  for (const re of LEAKAGE_SNIPPET_RES) {
    t = t.replace(re, ' ');
  }

  return t.replace(/\s{2,}/g, ' ').trim();
}
