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
    const maxLines = Math.min(2, Math.max(0, Number(layout.maxLines) || 2));
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
      return [w.slice(0, mid).join(' '), w.slice(mid).join(' ')];
    }
    return lines.length ? lines : [''];
  }

  global.CutupTextLayout = { layoutLines, words };
})(typeof window !== 'undefined' ? window : globalThis);
