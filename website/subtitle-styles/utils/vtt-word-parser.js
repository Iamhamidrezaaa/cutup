/**
 * Browser mirror of api/vtt-word-parser.js — keep in sync.
 */
(function (global) {
  'use strict';

  const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:[''\u2019\-][\p{L}\p{M}\p{N}]+)*/gu;
  const INLINE_TS_RE = /<(\d{2}):(\d{2}):(\d{2})[.,](\d{3})>/g;

  function parseVttClock(h, m, s, ms) {
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  }

  function parseVttCueRange(line) {
    const m = String(line || '').match(
      /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
    );
    if (!m) return null;
    return {
      start: parseVttClock(m[1], m[2], m[3], m[4]),
      end: parseVttClock(m[5], m[6], m[7], m[8])
    };
  }

  function stripVttMarkup(text) {
    return String(text || '')
      .replace(/<c[^>]*>/gi, '')
      .replace(/<\/c>/gi, '')
      .replace(/<v[^>]*>/gi, '')
      .replace(/<\/v>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractWordsFromVttLine(rawLine, cueStart, cueEnd) {
    const line = String(rawLine || '');
    const words = [];
    let hasInline = false;
    const firstTsIdx = line.search(/<\d{2}:\d{2}:\d{2}[.,](\d{3})>/);
    if (firstTsIdx > 0) {
      const prefix = stripVttMarkup(line.slice(0, firstTsIdx));
      const prefixTokens = prefix.match(TOKEN_RE) || [];
      for (const tok of prefixTokens) {
        words.push({ word: tok, start: cueStart, end: cueStart });
      }
    }
    const re = /<(\d{2}):(\d{2}):(\d{2})[.,](\d{3})>([^<]*)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      hasInline = true;
      const start = parseVttClock(m[1], m[2], m[3], m[4]);
      const chunk = stripVttMarkup(m[5]);
      const tokens = chunk.match(TOKEN_RE) || [];
      for (const tok of tokens) {
        words.push({ word: tok, start, end: start });
      }
    }
    if (words.length) {
      for (let i = 0; i < words.length; i++) {
        const nextStart = i + 1 < words.length ? words[i + 1].start : cueEnd;
        words[i].end = Math.max(words[i].start + 0.04, nextStart);
      }
      words[words.length - 1].end = Math.max(words[words.length - 1].end, cueEnd);
      return { words, hasInlineTiming: hasInline };
    }
    const plain = stripVttMarkup(line.replace(INLINE_TS_RE, ''));
    const tokens = plain.match(TOKEN_RE) || [];
    if (!tokens.length) return { words: [], hasInlineTiming: false };
    const dur = Math.max(0.06 * tokens.length, cueEnd - cueStart);
    const per = dur / tokens.length;
    return {
      words: tokens.map(function (word, i) {
        const start = cueStart + i * per;
        const end = Math.min(cueEnd, Math.max(start + 0.04, cueStart + (i + 1) * per));
        return { word: word, start: start, end: end };
      }),
      hasInlineTiming: false
    };
  }

  function parseVttBlocks(vttContent) {
    const body = String(vttContent || '')
      .replace(/^\uFEFF/, '')
      .replace(/^WEBVTT[^\n]*\n/i, '')
      .replace(/^Kind:[^\n]*\n/gim, '')
      .replace(/^Language:[^\n]*\n/gim, '')
      .trim();
    const chunks = body.split(/\n\s*\n/);
    const raw = [];
    for (const chunk of chunks) {
      const lines = chunk.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length < 2) continue;
      let timeIdx = 0;
      if (lines[0].indexOf('-->') < 0) timeIdx = 1;
      const range = parseVttCueRange(lines[timeIdx]);
      if (!range) continue;
      const payload = lines.slice(timeIdx + 1).join(' ');
      const extracted = extractWordsFromVttLine(payload, range.start, range.end);
      const text = extracted.words.length
        ? extracted.words.map(function (w) { return w.word; }).join(' ')
        : stripVttMarkup(payload);
      if (!text) continue;
      raw.push({
        start: range.start,
        end: range.end,
        text: text,
        words: extracted.words,
        hasInlineTiming: extracted.hasInlineTiming
      });
    }
    return raw;
  }

  function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    let inter = 0;
    set1.forEach(function (w) { if (set2.has(w)) inter += 1; });
    return inter / Math.max(set1.size, set2.size, 1);
  }

  function dedupeRollingVttSegments(rawSegments) {
    const segments = [];
    let previousText = '';
    for (const current of rawSegments || []) {
      const currentText = String(current.text || '').trim();
      if (!currentText) continue;
      if (previousText && currentText.startsWith(previousText)) {
        const newText = currentText.slice(previousText.length).trim();
        if (!newText) continue;
        const prevWords = previousText.split(/\s+/).filter(Boolean).length;
        const newWords = (current.words || []).slice(prevWords);
        segments.push({
          start: current.start,
          end: current.end,
          text: newText,
          words: newWords.length ? newWords : undefined,
          hasInlineTiming: current.hasInlineTiming
        });
        previousText = currentText;
      } else {
        segments.push(Object.assign({}, current, { text: currentText }));
        previousText = currentText;
      }
    }
    return segments.length ? segments : rawSegments || [];
  }

  function flattenSegmentWords(segments) {
    const out = [];
    for (const seg of segments || []) {
      for (const w of seg.words || []) {
        if (!w || !w.word) continue;
        out.push({ word: w.word, start: Number(w.start), end: Number(w.end) });
      }
    }
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  function parseVttToSegmentsWithWords(vttContent) {
    const raw = parseVttBlocks(vttContent);
    const segments = dedupeRollingVttSegments(raw);
    const hasInlineTiming = segments.some(function (s) {
      return s.hasInlineTiming && (s.words || []).length > 0;
    });
    const hasWordTiming = segments.some(function (s) {
      return Array.isArray(s.words) && s.words.length > 0 && Number.isFinite(s.words[0].start);
    });
    return {
      segments: segments.map(function (s) {
        const copy = Object.assign({}, s);
        delete copy.hasInlineTiming;
        return copy;
      }),
      hasWordTiming: hasWordTiming,
      hasInlineTiming: hasInlineTiming,
      fullText: segments.map(function (s) { return s.text; }).join(' ')
    };
  }

  global.CutupVttParser = {
    parseVttToSegmentsWithWords: parseVttToSegmentsWithWords,
    flattenSegmentWords: flattenSegmentWords
  };
})(typeof window !== 'undefined' ? window : globalThis);
