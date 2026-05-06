/**
 * Strategic word emphasis scoring (preview + export parity).
 */
(function (global) {
  'use strict';

  const POWER =
    /\b(secret|truth|money|million|billion|never|always|win|lose|mistake|power)\b/i;
  const EMOTIONAL =
    /\b(love|hate|amazing|insane|crazy|shocked|unbelievable|incredible|wow)\b/i;
  const URGENCY = /\b(now|today|stop|wait|listen|watch|hurry)\b/i;
  const CURIOSITY = /\b(why|how|what|secret|imagine|reveal|truth)\b/i;
  const CONFLICT = /\b(wife|husband|married|divorce|fight|wrong|lie|impossible)\b/i;
  const NUMBER = /\b\d+([.,]\d+)?%?\b/;
  const HOOK = /^(stop|wait|listen|imagine|what|why|you|never)/i;

  function tokenize(text) {
    return String(text || '')
      .split(/(\s+)/)
      .filter((t) => t.length > 0);
  }

  function scoreWord(clean, index) {
    if (!clean || clean.length < 2) return 0;
    let s = 0;
    if (POWER.test(clean)) s += 3;
    if (EMOTIONAL.test(clean)) s += 2.5;
    if (CURIOSITY.test(clean)) s += 2.2;
    if (CONFLICT.test(clean)) s += 2.8;
    if (URGENCY.test(clean)) s += 2;
    if (NUMBER.test(clean)) s += 2.2;
    if (index === 0 && HOOK.test(clean)) s += 3.5;
    if (clean === clean.toUpperCase() && clean.length > 2) s += 2;
    return s;
  }

  function analyzeToken(token, index) {
    const clean = token.replace(/[^\p{L}\p{N}%?!]/gu, '');
    if (!clean || /^\s+$/.test(token)) {
      return { text: token, clean, emphasis: false, score: 0, types: [], isSpace: /^\s+$/.test(token) };
    }
    const score = scoreWord(clean, index);
    const types = [];
    if (POWER.test(clean)) types.push('power');
    if (EMOTIONAL.test(clean)) types.push('emotional');
    if (CONFLICT.test(clean)) types.push('conflict');
    return { text: token, clean, score, emphasis: score >= 2.2, types, isSpace: false };
  }

  function analyzeText(text) {
    return tokenize(text).map((t, i) => analyzeToken(t, i));
  }

  function analyzeTextWithEmphasis(text, handler) {
    const tokens = analyzeText(text);
    const content = tokens.filter((t) => !t.isSpace && t.clean);
    const maxN = handler === 'hormozi' || handler === 'mrbeast' ? 3 : 2;
    const min = handler === 'minimal' || handler === 'luxury' ? 3.2 : 2.3;
    const ranked = [...content].sort((a, b) => b.score - a.score);
    const chosen = new Set();
    for (const t of ranked) {
      if (chosen.size >= maxN) break;
      if (t.score >= min) chosen.add(t.clean.toLowerCase());
    }
    return tokens.map((t) => ({
      ...t,
      emphasize: !t.isSpace && t.clean && chosen.has(t.clean.toLowerCase())
    }));
  }

  global.CutupEmphasisEngine = {
    analyzeText,
    analyzeTextWithEmphasis,
    tokenize
  };
})(typeof window !== 'undefined' ? window : globalThis);
