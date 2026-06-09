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
  const TRANSLATION_LEAK_RES = [
    /به\s+خوبی\s+انجام\s+می(?:دهی|دی|د|‌دهی|‌دی)/giu,
    /(?:^|[\s،,])وای\s+ددلیفت(?:ت)?\s+عالیه/giu,
    /(?:^|[\s،,])وای\s+اسکوات(?:ت)?\s+هم\s+عالیه/giu,
    /این\s+بنچ\s+پرش\s+عالیه/giu,
    /^ددلیفت(?:ت)?\s+عالیه[.!?\s]*$/giu
  ];

  function stripTranslationLeakage(text) {
    let t = String(text || '');
    for (const re of TRANSLATION_LEAK_RES) {
      t = t.replace(re, ' ');
    }
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  function clean(text, opts = {}) {
    let t = String(text || '');
    if (opts.stripTranslationLeakage) {
      t = stripTranslationLeakage(t);
    }
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

  const ROLLING_CHAIN_GAP_SEC = 0.18;
  const BLINK_MAX_DUR_SEC = 0.15;

  function normalizeCueText(text) {
    return String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** Merge YouTube rolling captions (growing text + blink duplicates). Mirrors api/video-render/subtitle-pipeline.js */
  function mergeRollingCaptionChains(segments) {
    const sorted = (segments || [])
      .filter(function (s) {
        return s && typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start;
      })
      .sort(function (a, b) {
        return a.start - b.start;
      });

    const chains = [];
    let chain = null;

    function flush() {
      if (!chain) return;
      const text = normalizeCueText(chain.text);
      if (!text) {
        chain = null;
        return;
      }
      chains.push({ start: chain.start, end: chain.end, text: text });
      chain = null;
    }

    for (var i = 0; i < sorted.length; i++) {
      var seg = sorted[i];
      var text = normalizeCueText(seg.text);
      if (!text) continue;
      var start = Number(seg.start);
      var end = Number(seg.end);

      if (!chain) {
        chain = { start: start, end: end, text: text };
        continue;
      }

      var gap = start - chain.end;
      var prev = chain.text;
      var growing = text.indexOf(prev) === 0 && text.length > prev.length;
      var same = text === prev;

      if (gap <= ROLLING_CHAIN_GAP_SEC && (growing || same)) {
        chain.end = Math.max(chain.end, end);
        if (text.length > prev.length) chain.text = text;
        continue;
      }

      if (chain && gap > ROLLING_CHAIN_GAP_SEC && gap < 1.2) {
        chain.end = Math.max(chain.end, start - 0.03);
      }
      flush();
      chain = { start: start, end: end, text: text };
    }
    flush();
    return chains;
  }

  function dropBlinkDuplicateCues(segments) {
    const sorted = (segments || []).slice().sort(function (a, b) {
      return a.start - b.start;
    });
    const out = [];
    for (var i = 0; i < sorted.length; i++) {
      var seg = sorted[i];
      var text = normalizeCueText(seg.text);
      if (!text) continue;
      var prev = out[out.length - 1];
      var dur = Number(seg.end) - Number(seg.start);
      if (prev) {
        var prevText = normalizeCueText(prev.text);
        var gap = Number(seg.start) - Number(prev.end);
        if (text === prevText && (dur < BLINK_MAX_DUR_SEC || gap < 0.05)) continue;
      }
      out.push({ start: Number(seg.start), end: Number(seg.end), text: text });
    }
    return out;
  }

  function normalizeTimelineSegments(segments) {
    var list = (segments || [])
      .filter(function (s) {
        return s && Number(s.end) > Number(s.start);
      })
      .map(function (s) {
        return {
          start: Number(s.start),
          end: Number(s.end),
          text: normalizeCueText(s.text)
        };
      })
      .filter(function (s) {
        return s.text;
      });
    list = mergeRollingCaptionChains(list);
    list = dropBlinkDuplicateCues(list);
    return list;
  }

  function prepareAccurate(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      let text = clean(s.text, { stripTranslationLeakage: true });
      if (!text || isGarbage(text)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return normalizeTimelineSegments(out);
  }

  function prepareClean(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      let text = clean(s.text);
      if (!text || isGarbage(text, true)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return normalizeTimelineSegments(out);
  }

  function prepareViral(segments) {
    const out = [];
    for (const s of segments || []) {
      if (!s || s.end <= s.start) continue;
      const text = clean(s.text, { stripTranslationLeakage: true });
      if (!text || isGarbage(text, true)) continue;
      out.push({ start: s.start, end: s.end, text });
    }
    return normalizeTimelineSegments(out);
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

  /** Strip HTML entities (&gt;, @gt;, etc.) from cue text. */
  function decodeSubtitleTextEntities(text) {
    let t = String(text || '');
    if (!t) return '';
    t = t.replace(
      /\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*--(?:>|&gt;|@gt;)\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/gi,
      ' '
    );
    t = t.replace(/&amp;/gi, '&');
    t = t.replace(/&quot;/gi, '"');
    t = t.replace(/&#0*39;/gi, "'");
    t = t.replace(/&gt;/gi, '>');
    t = t.replace(/&lt;/gi, '<');
    t = t.replace(/@gt;/gi, '>');
    t = t.replace(/@lt;/gi, '<');
    t = t.replace(/@amp;/gi, '&');
    t = t.replace(/(?:>>\s*){2,}/g, ' ');
    t = t.replace(/^\s*>>\s*|\s*>>\s*$/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  global.decodeSubtitleTextEntities = decodeSubtitleTextEntities;
  global.CutupSubtitleClean = {
    MODES,
    clean,
    isGarbage,
    prepareSegments,
    prepareSegmentsForMode,
    prepareAccurate,
    decodeSubtitleTextEntities,
    normalizeTimelineSegments,
    mergeRollingCaptionChains
  };
})(typeof window !== 'undefined' ? window : globalThis);
