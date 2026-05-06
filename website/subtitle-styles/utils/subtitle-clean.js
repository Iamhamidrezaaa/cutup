/**
 * Client-side subtitle cleaning — mirrors api/video-render/subtitle-pipeline.js
 */
(function (global) {
  'use strict';

  const MODES = { ACCURATE: 'accurate', CLEAN: 'clean', VIRAL: 'viral' };

  const BRACKET = /\[[^\]]*\]/g;
  const PAREN_NOISE = /\((applause|laughter|music|inaudible|crowd cheering|cheering|clapping)\)/gi;
  const NOTES = /♪+/g;
  const HALLUCINATION = /[@#$%^&*]{2,}/;
  const NOISE = /^(applause|laughter|music|inaudible|crowd|cheering|clapping)\b/i;

  function clean(text, opts = {}) {
    let t = String(text || '');
    if (opts.stripNoiseTags !== false) {
      t = t.replace(BRACKET, ' ');
      t = t.replace(PAREN_NOISE, ' ');
    }
    t = t.replace(NOTES, ' ');
    t = t.replace(HALLUCINATION, ' ');
    t = t.replace(/[@#$%^&*]/g, (m) => (m.length === 1 ? '' : ' '));
    t = t.replace(/\s{2,}/g, ' ').trim();
    return t;
  }

  function normalizeNonSpeech(text, mode) {
    let t = String(text || '');
    const tag = (label) => (mode === 'accurate' ? `[${label}]` : '');
    t = t.replace(/\[(applause|laughter|crowd cheering|music|inaudible)\]/gi, (_, w) => tag(w.toLowerCase()));
    t = t.replace(PAREN_NOISE, (_, w) => tag(String(w).toLowerCase()));
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  function isGarbage(text, strict) {
    const t = clean(text);
    if (!t) return true;
    if (strict && NOISE.test(t)) return true;
    if (/^[^\p{L}\p{N}]+$/u.test(t)) return true;
    return false;
  }

  function prepareAccurate(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      let text = normalizeNonSpeech(s.text, 'accurate');
      text = clean(text, { stripNoiseTags: false });
      if (!text || isGarbage(text)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return out;
  }

  function prepareClean(segments) {
    const out = [];
    let prev = '';
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      let text = clean(s.text);
      text = normalizeNonSpeech(text, 'clean');
      if (!text || isGarbage(text, true)) continue;
      const key = text.toLowerCase();
      if (key === prev) continue;
      prev = key;
      out.push({ start: s.start, end: s.end, text });
    }
    return out;
  }

  function prepareViral(segments) {
    const out = [];
    let prev = '';
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      const text = clean(s.text);
      if (!text || isGarbage(text, true)) continue;
      const key = text.toLowerCase();
      if (key === prev) continue;
      prev = key;
      out.push({ start: s.start, end: s.end, text });
    }
    return out;
  }

  function prepareSegmentsForMode(segments, mode) {
    const m = String(mode || 'viral').toLowerCase();
    if (m === 'accurate') return prepareAccurate(segments);
    if (m === 'clean') return prepareClean(segments);
    return prepareViral(segments);
  }

  /** @deprecated use prepareSegmentsForMode */
  function prepareSegments(segments) {
    return prepareSegmentsForMode(segments, 'viral');
  }

  global.CutupSubtitleClean = {
    MODES,
    clean,
    isGarbage,
    prepareSegments,
    prepareSegmentsForMode,
    prepareAccurate
  };
})(typeof window !== 'undefined' ? window : globalThis);
