/**
 * Client mirror of api/video-render/non-speech-tags.js
 */
(function (global) {
  'use strict';

  const BRACKET_TAG_RE = /\[[^\]]*]\s*/gi;
  const FULLWIDTH_BRACKET_RE = /【[^】]*】\s*/g;
  const NOTE_RE = /[♪♫🎵🎶]+\s*/g;
  const ASTERISK_ACTION_RE = /\*[^*]+\*\s*/g;

  const PAREN_DESCRIPTOR_STEMS = [
    'music', 'musique', 'música', 'musica', 'musik', 'muzyka', 'müzik',
    'applause', 'aplausos', 'applaus', 'applaudissements', 'alkış',
    'laughter', 'laughing', 'laughs', 'risas', 'rires', 'gelächter', 'kahkaha',
    'inaudible', 'indistinct', 'unintelligible', 'unverständlich',
    'cheering', 'crowd cheering', 'clapping', 'crowd noise', 'crowd',
    'silence', 'pause', 'sigh', 'sighs', 'gasp', 'gasps', 'cough', 'coughing',
    'clears throat', 'beat', 'beats', 'instrumental', 'sfx',
    'sound effect', 'sound effects', 'background music', 'static', 'noise',
    'foreign language', 'speaking foreign language', 'whispering', 'screaming',
    'horn', 'beep', 'ding', 'ringtone',
    'موزیک', 'موسیقی', 'صدای موسیقی', 'موسيقى', 'موسيقي',
    'خنده', 'خندیدن', 'تشویق', 'کف زدن', 'سرفه', 'نفس', 'سکوت',
    'غیرقابل فهم', 'نامفهوم', 'ضحك', 'تصفيق', 'سعال'
  ];

  const PAREN_DESCRIPTOR_RE = new RegExp(
    '(?:' +
      PAREN_DESCRIPTOR_STEMS.map(function (s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|') +
      ')',
    'iu'
  );

  const PAREN_NOISE_RE = new RegExp(
    '\\(\\s*(?:' +
      PAREN_DESCRIPTOR_STEMS.map(function (s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|') +
      ')(?:\\s+[\\p{L}\\p{M}\\p{N}\'’\\-]+){0,5}\\s*\\)\\s*',
    'giu'
  );

  const STANDALONE_DESCRIPTOR_RE = new RegExp(
    '^(?:' +
      PAREN_DESCRIPTOR_STEMS.map(function (s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|') +
      ')$',
    'iu'
  );

  function collapseWs(text) {
    return String(text || '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function stripNonSpeechDescriptiveTags(text) {
    var t = String(text || '');
    if (!t) return '';
    t = t.replace(BRACKET_TAG_RE, ' ');
    t = t.replace(FULLWIDTH_BRACKET_RE, ' ');
    t = t.replace(PAREN_NOISE_RE, ' ');
    t = t.replace(NOTE_RE, ' ');
    t = t.replace(ASTERISK_ACTION_RE, ' ');
    return collapseWs(t);
  }

  function isNonSpeechDescriptorWord(word) {
    var raw = String(word || '').trim();
    if (!raw) return true;
    if (/^\[[^\]]*]$/i.test(raw)) return true;
    if (/^【[^】]*】$/.test(raw)) return true;
    var clean = raw.replace(/[^\p{L}\p{M}\p{N}]/gu, '').trim();
    if (!clean) return true;
    return STANDALONE_DESCRIPTOR_RE.test(clean);
  }

  function isOnlyNonSpeechContent(text) {
    var stripped = stripNonSpeechDescriptiveTags(text);
    if (!stripped) return true;
    if (!/[\p{L}\p{N}]/u.test(stripped)) return true;
    var words = stripped.split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    return words.every(function (w) {
      return isNonSpeechDescriptorWord(w);
    });
  }

  global.CutupNonSpeechTags = {
    stripNonSpeechDescriptiveTags: stripNonSpeechDescriptiveTags,
    isNonSpeechDescriptorWord: isNonSpeechDescriptorWord,
    isOnlyNonSpeechContent: isOnlyNonSpeechContent,
    PAREN_DESCRIPTOR_RE: PAREN_DESCRIPTOR_RE
  };
})(typeof window !== 'undefined' ? window : globalThis);
