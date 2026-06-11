/**
 * Strip accessibility / sound-effect descriptors from subtitle text (all languages).
 * ASR models emit these as [music], (applause), موزیک, etc. — not spoken dialogue.
 */

const BRACKET_TAG_RE = /\[[^\]]*]\s*/gi;
const FULLWIDTH_BRACKET_RE = /【[^】]*】\s*/g;
const NOTE_RE = /[♪♫🎵🎶]+\s*/g;
const ASTERISK_ACTION_RE = /\*[^*]+\*\s*/g;

/** Lowercase descriptor stems — matched inside (...) with optional trailing words. */
const PAREN_DESCRIPTOR_STEMS = [
  'music',
  'musique',
  'música',
  'musica',
  'musik',
  'muzyka',
  'müzik',
  'musiq',
  'musiqi',
  'mousika',
  'applause',
  'aplausos',
  'applaus',
  'applaudissements',
  'alkış',
  'laughter',
  'laughing',
  'laughs',
  'risas',
  'rires',
  'gelächter',
  'kahkaha',
  'inaudible',
  'indistinct',
  'unintelligible',
  'unverständlich',
  'cheering',
  'crowd cheering',
  'clapping',
  'crowd noise',
  'crowd',
  'silence',
  'pause',
  'sigh',
  'sighs',
  'gasp',
  'gasps',
  'cough',
  'coughing',
  'clears throat',
  'beat',
  'beats',
  'instrumental',
  'sfx',
  'sound effect',
  'sound effects',
  'background music',
  'static',
  'noise',
  'foreign language',
  'speaking foreign language',
  'whispering',
  'screaming',
  'horn',
  'beep',
  'ding',
  'ringtone',
  'موزیک',
  'موسیقی',
  'صدای موسیقی',
  'موسيقى',
  'موسيقي',
  'خنده',
  'خندیدن',
  'تشویق',
  'کف زدن',
  'سرفه',
  'نفس',
  'سکوت',
  'غیرقابل فهم',
  'نامفهوم',
  'ضحك',
  'تصفيق',
  'سعال',
  'موسيقى'
];

const PAREN_DESCRIPTOR_RE = new RegExp(
  `\\(\\s*(?:${PAREN_DESCRIPTOR_STEMS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+[\\p{L}\\p{M}\\p{N}'’\\-]+){0,5}\\s*\\)\\s*`,
  'giu'
);

const STANDALONE_DESCRIPTOR_RE = new RegExp(
  `^(?:${PAREN_DESCRIPTOR_STEMS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
  'iu'
);

function collapseWs(text) {
  return String(text || '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Remove non-dialogue tags and descriptors; keep spoken words only.
 */
export function stripNonSpeechDescriptiveTags(text) {
  let t = String(text || '');
  if (!t) return '';
  t = t.replace(BRACKET_TAG_RE, ' ');
  t = t.replace(FULLWIDTH_BRACKET_RE, ' ');
  t = t.replace(PAREN_DESCRIPTOR_RE, ' ');
  t = t.replace(NOTE_RE, ' ');
  t = t.replace(ASTERISK_ACTION_RE, ' ');
  return collapseWs(t);
}

export function isNonSpeechDescriptorWord(word) {
  const raw = String(word || '').trim();
  if (!raw) return true;
  if (/^\[[^\]]*]$/i.test(raw)) return true;
  if (/^【[^】]*】$/.test(raw)) return true;
  const clean = raw
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '')
    .trim();
  if (!clean) return true;
  return STANDALONE_DESCRIPTOR_RE.test(clean);
}

export function isOnlyNonSpeechContent(text) {
  const stripped = stripNonSpeechDescriptiveTags(text);
  if (!stripped) return true;
  if (!/[\p{L}\p{N}]/u.test(stripped)) return true;
  const words = stripped.split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((w) => isNonSpeechDescriptorWord(w));
}

/**
 * @param {{ start?, end?, text?, words? }[]} segments
 */
export function sanitizeTranscriptSegments(segments) {
  const out = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = stripNonSpeechDescriptiveTags(seg?.text);
    if (isOnlyNonSpeechContent(text)) continue;
    const words = Array.isArray(seg?.words)
      ? seg.words
          .map((w) => {
            if (!w || typeof w !== 'object') return w;
            const wt = stripNonSpeechDescriptiveTags(w.word ?? w.text ?? '');
            if (!wt || isNonSpeechDescriptorWord(wt)) return null;
            return { ...w, word: wt, text: wt };
          })
          .filter(Boolean)
      : seg?.words;
    out.push({ ...seg, text, words });
  }
  return out;
}

/** @deprecated alias */
export function stripBurnNonSpeechTags(text) {
  return stripNonSpeechDescriptiveTags(text);
}
