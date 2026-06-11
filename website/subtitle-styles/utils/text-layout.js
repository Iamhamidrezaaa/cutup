/**
 * Split cue text into display lines per preset layout rules.
 */
(function (global) {
  'use strict';

  const VERTICAL_MAX_WORDS = 5;
  const VERTICAL_MAX_CHARS = 18;
  const VERTICAL_MIN_WORDS = 2;

  function words(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean);
  }

  function chunkWords(wordList, minW, maxW) {
    const lines = [];
    let i = 0;
    while (i < wordList.length) {
      const remain = wordList.length - i;
      const size = remain <= maxW ? remain : remain - maxW < minW ? remain : maxW;
      lines.push(wordList.slice(i, i + size).join(' '));
      i += size;
    }
    return lines.length ? lines : [''];
  }

  function detectPreviewAspect() {
    const cached = global.cutupVideoAspect;
    if (cached === 'vertical' || cached === 'horizontal' || cached === 'square') return cached;
    const platform = String(global.cutupLastTranscription?.platform || '').toLowerCase();
    if (platform === 'tiktok' || platform === 'instagram') return 'vertical';
    const url = String(global.cutupLastTranscription?.sourceUrl || '');
    if (/shorts|tiktok|instagram|reels/i.test(url)) return 'vertical';
    return 'horizontal';
  }

  function applyAspectToLayout(layout, aspect) {
    const out = { ...(layout || {}) };
    if (aspect !== 'vertical') return out;
    out.mode = 'stack';
    out.wordsPerLineMin = 2;
    out.wordsPerLineMax = 3;
    out.maxCharsPerLine = VERTICAL_MAX_CHARS;
    out.maxLines = 2;
    out.maxWidth = '78%';
    return out;
  }

  /**
   * Captions-app style: split long SRT segments into short on-screen beats (preview/export doc).
   * @param {{ start, end, text, words? }[]} segments
   */
  function chunkSegmentsForVerticalShorts(segments, opts = {}) {
    const maxWords = Math.max(1, Number(opts.maxWords) || VERTICAL_MAX_WORDS);
    const maxChars = Math.max(6, Number(opts.maxChars) || VERTICAL_MAX_CHARS);
    const minWords = Math.max(1, Number(opts.minWords) || VERTICAL_MIN_WORDS);
    const out = [];
    for (const seg of Array.isArray(segments) ? segments : []) {
      const text = String(seg?.text || '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text)) {
        out.push(seg);
        continue;
      }
      const w = words(text);
      if (w.length <= maxWords && text.length <= maxChars) {
        out.push(seg);
        continue;
      }
      const timed = Array.isArray(seg.words)
        ? seg.words.filter((tw) => tw && Number.isFinite(Number(tw.start)) && Number.isFinite(Number(tw.end)))
        : [];
      const pieces = [];
      let bucket = [];
      for (let i = 0; i < w.length; i++) {
        bucket.push(w[i]);
        const chunkText = bucket.join(' ');
        const atEnd = i === w.length - 1;
        if (bucket.length >= maxWords || chunkText.length >= maxChars || atEnd) {
          pieces.push({
            words: bucket.slice(),
            tokenStart: i - bucket.length + 1,
            tokenEnd: i
          });
          bucket = [];
        }
      }
      if (bucket.length) {
        pieces.push({
          words: bucket.slice(),
          tokenStart: w.length - bucket.length,
          tokenEnd: w.length - 1
        });
      }
      for (let pi = 1; pi < pieces.length; pi++) {
        if (pieces[pi].words.length !== 1 || pieces[pi - 1].words.length >= maxWords) continue;
        const merged = [...pieces[pi - 1].words, ...pieces[pi].words];
        if (merged.join(' ').length > maxChars) continue;
        pieces[pi - 1] = {
          words: merged,
          tokenStart: pieces[pi - 1].tokenStart,
          tokenEnd: pieces[pi].tokenEnd
        };
        pieces.splice(pi, 1);
        pi -= 1;
      }
      const segStart = Number(seg.start) || 0;
      const segEnd = Number(seg.end) || segStart + 0.5;
      const dur = Math.max(0.08, segEnd - segStart);
      pieces.forEach((piece, pi) => {
        const timedSlice = timed.slice(piece.tokenStart, piece.tokenEnd + 1);
        let start = segStart + (dur * pi) / pieces.length;
        let end = segStart + (dur * (pi + 1)) / pieces.length;
        if (timedSlice.length) {
          start = Number(timedSlice[0].start);
          end = Number(timedSlice[timedSlice.length - 1].end);
        }
        end = Math.max(start + 0.05, end);
        out.push({
          ...seg,
          start,
          end,
          text: piece.words.join(' '),
          words: timedSlice.length ? timedSlice : seg.words
        });
      });
    }
    return out.length ? out : segments;
  }

  function layoutLines(text, layout) {
    const w = words(text);
    if (!w.length) return [''];
    const min = layout.wordsPerLineMin || 2;
    const max = layout.wordsPerLineMax || 6;
    const maxLines = Math.max(1, Math.min(3, Number(layout.maxLines) || 2));
    let lines;
    if (layout.mode === 'single') {
      lines = [w.join(' ')];
    } else if (layout.mode === 'wide') {
      const per = layout.wordsPerLineMax || 10;
      lines = [];
      for (let i = 0; i < w.length; i += per) lines.push(w.slice(i, i + per).join(' '));
    } else {
      lines = chunkWords(w, min, max);
    }
    if (maxLines > 0 && lines.length > maxLines) {
      const merged = w.join(' ');
      if (maxLines === 1) return [merged];
      const mid = Math.ceil(w.length / 2);
      return [w.slice(0, mid).join(' '), w.slice(mid).join(' ')].filter(Boolean);
    }
    if (lines.length >= 2) {
      const lastW = words(lines[lines.length - 1]);
      if (lastW.length === 1) {
        const merged = `${lines[lines.length - 2]} ${lines[lines.length - 1]}`.trim();
        const cap = Number(layout.maxCharsPerLine) || VERTICAL_MAX_CHARS;
        if (merged.length <= cap * 1.08) {
          lines.splice(-2, 2, merged);
        }
      }
    }
    return lines.length ? lines : [''];
  }

  global.CutupTextLayout = {
    layoutLines,
    words,
    detectPreviewAspect,
    applyAspectToLayout,
    chunkSegmentsForVerticalShorts,
    VERTICAL_MAX_WORDS,
    VERTICAL_MAX_CHARS,
    VERTICAL_MIN_WORDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
