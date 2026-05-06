/**
 * Split cue text into display lines per preset layout rules.
 */
(function (global) {
  'use strict';

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

  function layoutLines(text, layout) {
    const w = words(text);
    if (!w.length) return [''];
    const min = layout.wordsPerLineMin || 2;
    const max = layout.wordsPerLineMax || 6;
    if (layout.mode === 'single') return [w.join(' ')];
    if (layout.mode === 'wide') {
      const per = layout.wordsPerLineMax || 10;
      const out = [];
      for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per).join(' '));
      return out;
    }
    return chunkWords(w, min, max);
  }

  global.CutupTextLayout = { layoutLines, words };
})(typeof window !== 'undefined' ? window : globalThis);
