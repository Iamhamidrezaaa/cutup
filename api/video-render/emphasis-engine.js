/**
 * Strategic word emphasis scoring for creator captions.
 */

const POWER =
  /\b(secret|truth|money|rich|million|billion|percent|power|freedom|success|failure|never|always|win|lose|mistake)\b/i;
const EMOTIONAL =
  /\b(love|hate|amazing|insane|crazy|shocked|beautiful|terrifying|excited|angry|unbelievable|incredible|obsessed|devastated|wow)\b/i;
const URGENCY = /\b(now|today|immediately|stop|wait|listen|watch|hurry|fast)\b/i;
const CURIOSITY = /\b(why|how|what|who|when|imagine|discover|reveal|hidden|truth)\b/i;
const CONFLICT =
  /\b(wife|husband|married|divorce|fight|wrong|lie|cheat|enemy|war|impossible|illegal)\b/i;
const SURPRISE = /\b(what|wait|actually|suddenly|plot|twist|unexpected)\b/i;
const NUMBER = /\b\d+([.,]\d+)?%?\b/;
const HOOK_START = /^(stop|wait|listen|imagine|what|why|this|you|never|nobody)/i;

export function tokenize(text) {
  return String(text || '')
    .split(/(\s+)/)
    .filter((t) => t.length > 0);
}

export function scoreWord(clean, index) {
  if (!clean || clean.length < 2) return 0;
  let score = 0;
  if (POWER.test(clean)) score += 3;
  if (EMOTIONAL.test(clean)) score += 2.5;
  if (CURIOSITY.test(clean)) score += 2.2;
  if (CONFLICT.test(clean)) score += 2.8;
  if (URGENCY.test(clean)) score += 2;
  if (SURPRISE.test(clean)) score += 1.5;
  if (NUMBER.test(clean)) score += 2.2;
  if (index === 0 && HOOK_START.test(clean)) score += 3.5;
  if (clean === clean.toUpperCase() && clean.length > 2 && /[A-Z]/.test(clean)) score += 2;
  if (/\?|!/.test(clean)) score += 0.8;
  return score;
}

export function analyzeToken(token, index) {
  const clean = token.replace(/[^\p{L}\p{N}%?!]/gu, '');
  if (!clean || /^\s+$/.test(token)) {
    return { text: token, clean, emphasis: false, score: 0, types: [], isSpace: /^\s+$/.test(token) };
  }
  const score = scoreWord(clean, index);
  const types = [];
  if (POWER.test(clean)) types.push('power');
  if (EMOTIONAL.test(clean)) types.push('emotional');
  if (CURIOSITY.test(clean)) types.push('curiosity');
  if (CONFLICT.test(clean)) types.push('conflict');
  if (URGENCY.test(clean)) types.push('urgency');
  if (NUMBER.test(clean)) types.push('number');

  return {
    text: token,
    clean,
    score,
    emphasis: score >= 2.2,
    types,
    isSpace: false
  };
}

export function analyzeText(text) {
  return tokenize(text).map((t, i) => analyzeToken(t, i));
}

function maxEmphasisForHandler(handler) {
  if (handler === 'hormozi' || handler === 'mrbeast') return 3;
  if (handler === 'neon') return 2;
  if (handler === 'minimal' || handler === 'luxury') return 1;
  return 2;
}

function minScoreForHandler(handler) {
  if (handler === 'hormozi') return 2.4;
  if (handler === 'mrbeast') return 2.2;
  if (handler === 'minimal' || handler === 'luxury') return 3.2;
  return 2.2;
}

/**
 * Pick top strategic tokens only (no random highlight spam).
 */
export function analyzeTextWithEmphasis(text, handler) {
  const tokens = analyzeText(text);
  const content = tokens.filter((t) => !t.isSpace && t.clean);
  const maxN = maxEmphasisForHandler(handler);
  const minScore = minScoreForHandler(handler);

  const ranked = [...content].sort((a, b) => b.score - a.score);
  const chosen = new Set();
  for (const t of ranked) {
    if (chosen.size >= maxN) break;
    if (t.score >= minScore) chosen.add(t.clean.toLowerCase());
  }

  return tokens.map((t) => ({
    ...t,
    emphasize: !t.isSpace && t.clean && chosen.has(t.clean.toLowerCase())
  }));
}

export function shouldEmphasize(token, handler) {
  if (token.spoken) return true;
  if (token.emphasize != null) return token.emphasize;
  if (!token.emphasis) return false;
  if (handler === 'minimal' || handler === 'luxury') {
    return token.types.includes('number') || token.score >= 3.5;
  }
  return token.score >= minScoreForHandler(handler);
}

function normalizeWordKey(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Pick the word active near the temporal center of a cue (Whisper word timestamps when present).
 */
export function pickSpokenWordKey(words, cueStart, cueEnd, fallbackTokens = []) {
  const start = Number(cueStart);
  const end = Number(cueEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  if (Array.isArray(words) && words.length) {
    const mid = (start + end) / 2;
    let bestKey = null;
    let bestDist = Infinity;
    for (const w of words) {
      const ws = Number(w.start);
      const we = Number(w.end ?? w.start);
      if (!Number.isFinite(ws)) continue;
      const key = normalizeWordKey(w.word ?? w.text);
      if (!key) continue;
      if (mid >= ws - 0.04 && mid <= we + 0.04) return key;
      const dist = Math.min(Math.abs(mid - ws), Math.abs(mid - we));
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }
    if (bestKey) return bestKey;
  }

  const content = (fallbackTokens || []).filter((t) => !t.isSpace && t.clean);
  if (!content.length) return null;
  const ranked = [...content].sort((a, b) => b.score - a.score);
  return normalizeWordKey(ranked[0]?.clean);
}

export function markSpokenWord(tokens, words, cueStart, cueEnd) {
  const spokenKey = pickSpokenWordKey(words, cueStart, cueEnd, tokens);
  if (!spokenKey) return tokens;
  return tokens.map((t) => ({
    ...t,
    spoken: !t.isSpace && t.clean && normalizeWordKey(t.clean) === spokenKey,
    emphasize: !t.isSpace && t.clean && normalizeWordKey(t.clean) === spokenKey
  }));
}
