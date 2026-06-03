/**
 * RTL ASS dialogue helpers — libass-safe BiDi (RLE/PDF per line, punctuation glue).
 */
import { isRtlText } from './rtl-text.js';

const BIDI_MARK_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const RTL_PUNCT_ONLY_RE = /^[\u060C\u061B\u061F\u066C\u0021\u002E\u003F\u003A\u003B\u002C]+$/u;

const RLE = '\u202B';
const PDF = '\u202C';

export function stripStrayBidiMarks(text) {
  return String(text || '').replace(BIDI_MARK_RE, '');
}

/**
 * Glue trailing punctuation tokens onto the previous word (stable RTL shaping in libass).
 */
export function coalesceRtlPunctuationTokens(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.isSpace) {
      out.push(t);
      continue;
    }
    if (RTL_PUNCT_ONLY_RE.test(String(t.text || '').trim()) && out.length) {
      const prev = out[out.length - 1];
      if (!prev.isSpace) {
        out[out.length - 1] = { ...prev, text: String(prev.text || '') + String(t.text || '') };
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/**
 * Wrap each ASS row in RLE…PDF so inline color tags stay inside the embedding (not before it).
 */
export function wrapRtlAssWord(inner) {
  const body = stripStrayBidiMarks(String(inner || ''));
  if (!body) return '';
  return `${RLE}${body}${PDF}`;
}

/**
 * Per-word RLE islands keep inline {\\c} tags on the correct glyph (libass BiDi).
 */
export function buildRtlWordRunAssText(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((p) => {
      if (p == null) return '';
      if (typeof p === 'string' && /^\s+$/.test(p)) return p;
      return wrapRtlAssWord(p);
    })
    .join('');
}

export function wrapRtlAssLines(assBodyText) {
  const body = stripStrayBidiMarks(assBodyText);
  if (!body) return '';
  if (body.includes(RLE)) return body;
  return body
    .split('\\N')
    .map((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return '';
      return `${RLE}${trimmed}${PDF}`;
    })
    .filter(Boolean)
    .join('\\N');
}

/**
 * Final RTL Dialogue field text (no \\an / \\pos — style row handles placement).
 */
export function buildRtlDialogueText(assBodyText) {
  return wrapRtlAssLines(assBodyText);
}

export function cueTextIsRtl(text) {
  return isRtlText(text);
}

/**
 * Move only the first word to the end of the line for libass LTR layout so the
 * highlighted reading-start word renders on the physical right; remaining words keep order.
 */
export function rotateRtlFirstWordToLineEndForAss(line) {
  const words = String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return String(line || '').trim();
  return [...words.slice(1), words[0]].join(' ');
}
