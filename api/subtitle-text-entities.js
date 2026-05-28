/**
 * Decode / strip HTML entities leaked into subtitle cue text (translation, SRT paste, preview).
 */

const SRT_ARROW_IN_TEXT =
  /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*--(?:>|&gt;|@gt;)\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/gi;

/**
 * @param {string} text
 * @returns {string}
 */
export function decodeSubtitleTextEntities(text) {
  let t = String(text || '');
  if (!t) return '';

  t = t.replace(SRT_ARROW_IN_TEXT, ' ');

  t = t.replace(/&amp;/gi, '&');
  t = t.replace(/&quot;/gi, '"');
  t = t.replace(/&#0*39;/gi, "'");
  t = t.replace(/&apos;/gi, "'");
  t = t.replace(/&gt;/gi, '>');
  t = t.replace(/&lt;/gi, '<');

  t = t.replace(/@gt;/gi, '>');
  t = t.replace(/@lt;/gi, '<');
  t = t.replace(/@amp;/gi, '&');
  t = t.replace(/@quot;/gi, '"');

  t = t.replace(/&#(\d+);/g, (_, n) => {
    const code = Number(n);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
    try {
      return String.fromCodePoint(code);
    } catch {
      return '';
    }
  });

  t = t.replace(/(?:>>\s*){2,}/g, ' ');
  t = t.replace(/^\s*>>\s*|\s*>>\s*$/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}
