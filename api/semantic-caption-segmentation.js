/**
 * Semantic caption line segmentation (break placement only — no timing/style/translation).
 * Language-agnostic: punctuation, phrase cohesion, structure — not per-language grammars.
 */

import { detectContentDomain } from './domain-detection.js';

/** Cross-lingual function-word signals (break hints, not exclusive language rules). */
const CONJUNCTION_SIGNALS = new Set([
  'and', 'or', 'but', 'so', 'yet', 'nor', 'for', 'plus', 'also',
  'y', 'o', 'u', 'e', 'mais', 'et', 'ou', 'und', 'oder', 'aber',
  'и', 'а', 'но', 've', 'ile', 'ama', 'lakin',
  'و', 'ولی', 'اما', 'یا', 'که',
  'और', 'या', 'लेकिन', 'at', 'pero', 'sino'
]);

const PREPOSITION_SIGNALS = new Set([
  'to', 'with', 'for', 'from', 'in', 'on', 'at', 'by', 'into', 'over', 'under', 'about',
  'de', 'del', 'con', 'por', 'para', 'en', 'sur', 'dans', 'avec', 'pour', 'aus', 'mit',
  'в', 'на', 'с', 'к', 'из', 'от', 'до',
  'به', 'از', 'در', 'با', 'برای', 'روی',
  'ile', 'için', 'ke', 'mein', 'se', 'para'
]);

const DOMAIN_PHRASES = {
  fitness: [
    'nice deadlift',
    'keep pushing',
    'one more rep',
    'personal record',
    'leg day',
    'core tight',
    'protein shake'
  ],
  business: [
    'qualified leads',
    'cash flow',
    'conversion rate',
    'fund raising',
    'burn rate',
    'product market'
  ],
  marketing: [
    'ad spend',
    'landing page',
    'click through',
    'target audience',
    'growth campaign'
  ],
  sales: [
    'close the deal',
    'sales funnel',
    'discovery call',
    'cold call',
    'follow up'
  ],
  programming: [
    'api endpoint',
    'pull request',
    'database migration',
    'merge conflict',
    'unit test',
    'code review',
    'rest api'
  ],
  technology: [
    'machine learning',
    'feature flag',
    'cloud deploy',
    'tech stack'
  ],
  finance: ['interest rate', 'stock market', 'mutual fund'],
  education: ['online course', 'study guide'],
  real_estate: ['down payment', 'open house', 'cash flow property'],
  general: []
};

export function tokenizeCaptionText(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(.+?)([,.!?;:…،؛؟]+)?$/u);
      return {
        raw,
        word: (m?.[1] || raw).trim(),
        punct: m?.[2] || ''
      };
    });
}

function normToken(t) {
  return String(t.word || t.raw || '')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function endsSentence(token) {
  return /[.!?؟…]["')\]]?$/u.test(`${token.word}${token.punct}`);
}

function endsClause(token) {
  return /[,;:،؛]/u.test(token.punct || '');
}

function isConjunction(token) {
  if (!token) return false;
  const n = normToken(token);
  return n && CONJUNCTION_SIGNALS.has(n);
}

function isPreposition(token) {
  if (!token) return false;
  const n = normToken(token);
  return n && PREPOSITION_SIGNALS.has(n);
}

function domainPhraseBoost(tokens, i, domain) {
  const phrases = DOMAIN_PHRASES[domain] || DOMAIN_PHRASES.general;
  if (!phrases.length || !tokens[i + 1]) return 0;
  const a = normToken(tokens[i]);
  const b = normToken(tokens[i + 1]);
  let boost = 0;
  for (const p of phrases) {
    const parts = p.split(/\s+/).map((x) => x.trim());
    if (parts.length === 2 && a === parts[0] && b === parts[1]) {
      boost = Math.max(boost, 0.55);
    }
  }
  return boost;
}

/**
 * Cohesion between token[i] and token[i+1] (1 = keep together, 0 = good break after i).
 */
export function cohesionAfter(tokens, index, domain = 'general') {
  const t = tokens[index];
  const next = tokens[index + 1];
  if (!next) return 0;

  let keep = 0.52;

  if (endsSentence(t)) keep -= 0.48;
  else if (endsClause(t)) keep -= 0.28;

  if (isConjunction(next)) keep -= 0.22;
  if (isPreposition(t)) keep += 0.18;
  if (isPreposition(next) && tokens[index + 2]) keep += 0.12;

  keep += domainPhraseBoost(tokens, index, domain);

  const lenA = String(t.raw).length;
  const lenB = String(next.raw).length;
  if (lenA <= 2 || lenB <= 2) keep += 0.08;

  return Math.max(0, Math.min(1, keep));
}

function lineCharLen(parts) {
  return parts.map((t) => t.raw).join(' ').length;
}

/**
 * Greedy semantic line build with cohesion-aware breaks.
 */
export function buildSemanticLines(tokens, layout, domain) {
  const minWords = Math.max(1, layout.wordsPerLineMin || 2);
  const maxWords = Math.max(minWords, layout.wordsPerLineMax || 6);
  const maxChars = Math.max(8, layout.maxCharsPerLine || 36);
  const maxLines = Math.max(1, Number(layout.maxLines) || 2);

  const lines = [];
  let i = 0;
  let primaryReason = 'phrase_boundary';

  while (i < tokens.length && lines.length < maxLines) {
    const remain = tokens.length - i;
    const linesLeft = maxLines - lines.length;
    const maxTake = Math.min(maxWords, Math.ceil(remain / linesLeft));

    let bestEnd = Math.min(i + minWords - 1, tokens.length - 1);
    let bestScore = Number.POSITIVE_INFINITY;
    let bestReason = 'balance';

    for (let end = i + minWords - 1; end < Math.min(i + maxTake, tokens.length); end++) {
      const chunk = tokens.slice(i, end + 1);
      const chars = lineCharLen(chunk);
      if (chars > maxChars && chunk.length > minWords) continue;

      const breakCohesion =
        end < tokens.length - 1 ? 1 - cohesionAfter(tokens, end, domain) : 0;
      const charPenalty = Math.max(0, chars - maxChars) * 3;
      const lenTarget = maxChars * 0.55;
      const balance = Math.abs(chars - lenTarget) * 0.04;
      const score = breakCohesion * -100 + charPenalty + balance;

      if (score < bestScore) {
        bestScore = score;
        bestEnd = end;
        if (endsSentence(tokens[end])) bestReason = 'clause_boundary';
        else if (endsClause(tokens[end])) bestReason = 'clause_boundary';
        else if (end + 1 < tokens.length && isConjunction(tokens[end + 1])) {
          bestReason = 'conjunction';
        } else if (domainPhraseBoost(tokens, end, domain) > 0.3) bestReason = 'domain_phrase';
        else bestReason = 'phrase_boundary';
      }
    }

    if (bestEnd < i) bestEnd = Math.min(i + minWords - 1, tokens.length - 1);
    lines.push(tokens.slice(i, bestEnd + 1));
    if (lines.length === 1) primaryReason = bestReason;
    i = bestEnd + 1;
  }

  if (i < tokens.length && lines.length) {
    const tail = tokens.slice(i);
    const last = lines[lines.length - 1];
    if (last.length + tail.length <= maxWords && lineCharLen(last) + 1 + lineCharLen(tail) <= maxChars * 1.1) {
      lines[lines.length - 1] = [...last, ...tail];
    } else if (lines.length < maxLines) {
      lines.push(tail);
    } else {
      lines[lines.length - 1] = [...last, ...tail];
    }
  }

  return { lineParts: lines, breakReason: primaryReason };
}

function domainPhraseSplitPenalty(lineParts, domain) {
  const phrases = DOMAIN_PHRASES[domain] || [];
  if (!phrases.length || lineParts.length < 2) return 0;
  let penalty = 0;
  for (const phrase of phrases) {
    const parts = phrase.split(/\s+/);
    if (parts.length !== 2) continue;
    for (let li = 0; li < lineParts.length - 1; li++) {
      const endWord = normToken(lineParts[li][lineParts[li].length - 1]);
      const startWord = normToken(lineParts[li + 1][0]);
      if (endWord === parts[0] && startWord === parts[1]) penalty += 1;
    }
  }
  return penalty;
}

export function scoreSegmentation(lines, tokens, domain, layout = {}) {
  if (!lines.length || !tokens.length) return { score: 0, reason: 'empty' };

  let phraseHits = 0;
  let breaks = 0;
  let badBreaks = 0;
  let balancePenalty = 0;
  const lengths = lines.map((l) => l.length);
  const maxLines = Number(layout.maxLines) || 2;

  let idx = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let wi = 0; wi < line.length; wi++) {
      const globalIdx = idx + wi;
      if (wi === line.length - 1 && li < lines.length - 1) {
        breaks += 1;
        const c = cohesionAfter(tokens, globalIdx, domain);
        if (c >= 0.55) badBreaks += 1;
        else phraseHits += 1;
      }
    }
    idx += line.length;
  }

  if (lengths.length >= 2) {
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    for (const len of lengths) balancePenalty += Math.abs(len - avg);
  }

  const phrasePreservation = breaks > 0 ? phraseHits / breaks : 1;
  const integrity = 1 - (badBreaks / Math.max(1, breaks));
  const balance = Math.max(0, 1 - balancePenalty / (tokens.length * 2));
  let readability = lines.length <= maxLines ? 1 : 0.85;
  if (maxLines >= 2 && lines.length >= 2 && tokens.length >= 4) readability = 1;
  if (maxLines >= 2 && lines.length === 1 && tokens.length >= 5) readability *= 0.55;

  const domainPenalty = domainPhraseSplitPenalty(lines, domain);
  const domainBonus = domainPenalty === 0 && (DOMAIN_PHRASES[domain] || []).length ? 8 : 0;

  const raw =
    phrasePreservation * 40 +
    integrity * 35 +
    balance * 15 +
    readability * 10 +
    domainBonus -
    domainPenalty * 20;

  const clamped = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score: clamped,
    reason: badBreaks === 0 ? 'clause_boundary' : 'phrase_boundary',
    metrics: { phrasePreservation, integrity, balance, badBreaks, breaks }
  };
}

/**
 * @param {{ text: string, language?: string, domain?: string, layout?: object }} input
 */
export function segmentCaptionSemantically(input = {}) {
  const text = String(input.text || '').trim();
  const layout = input.layout || {};
  const language = String(input.language || 'unknown').slice(0, 8);

  let domain = String(input.domain || '').toLowerCase().trim();
  if (!domain || domain === 'auto') {
    domain = detectContentDomain({ transcript: text }).domain;
  }

  const tokens = tokenizeCaptionText(text);
  if (!tokens.length) {
    return { lines: [''], segmentationScore: 0, breakReason: 'empty', domain, language };
  }

  if (layout.mode === 'single') {
    return {
      lines: [text],
      segmentationScore: 100,
      breakReason: 'single_line',
      domain,
      language
    };
  }

  const { lineParts, breakReason } = buildSemanticLines(tokens, layout, domain);
  const lines = lineParts.map((parts) => parts.map((t) => t.raw).join(' ').trim()).filter(Boolean);
  const scored = scoreSegmentation(lineParts, tokens, domain, layout);

  return {
    lines: lines.length ? lines : [text],
    segmentationScore: scored.score,
    breakReason: breakReason || scored.reason,
    domain,
    language,
    metrics: scored.metrics
  };
}
