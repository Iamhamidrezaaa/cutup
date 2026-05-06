/**
 * Line breaking for ASS cues (mirrors website/subtitle-styles/utils/text-layout.js).
 */

export function words(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function maxCharsForLayout(layout = {}) {
  if (Number.isFinite(layout.maxCharsPerLine) && layout.maxCharsPerLine > 0) {
    return Math.round(layout.maxCharsPerLine);
  }
  if (layout.mode === 'wide') return 42;
  if (layout.mode === 'single') return 72;
  return 22;
}

function lineLength(wordsInLine) {
  return wordsInLine.join(' ').length;
}

function rebalanceTrailingOrphan(lines, minWords, maxWords) {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last.length !== 1 || prev.length <= Math.max(minWords, 2)) return lines;
  if (last.length + 1 > maxWords) return lines;
  const shifted = prev.pop();
  if (shifted) last.unshift(shifted);
  return lines;
}

function rebalanceByLength(lines, minWords, maxWords) {
  if (lines.length < 2) return lines;
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];
    if (!current.length || !next.length) continue;
    if (current.length <= minWords) continue;
    if (next.length >= maxWords) continue;
    const curLen = lineLength(current);
    const nextLen = lineLength(next);
    if (curLen - nextLen < 12) continue;
    const shifted = current.pop();
    if (shifted) next.unshift(shifted);
  }
  return lines;
}

function splitWordsIntoTwoBalanced(w, minWords, maxWords, maxChars) {
  const n = w.length;
  if (n <= 1) return [w.join(' ')];

  const low = Math.max(1, Math.min(n - 1, minWords));
  const high = Math.min(n - 1, Math.max(low, n - minWords));
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = low; i <= high; i++) {
    const left = w.slice(0, i);
    const right = w.slice(i);
    if (left.length > maxWords || right.length > maxWords) continue;

    const leftLen = lineLength(left);
    const rightLen = lineLength(right);
    const diff = Math.abs(leftLen - rightLen);
    const charPenalty = Math.max(0, leftLen - maxChars) * 2 + Math.max(0, rightLen - maxChars) * 2;
    const score = diff + charPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = [left.join(' '), right.join(' ')];
    }
  }

  if (best) return best;
  const pivot = Math.round(n / 2);
  return [w.slice(0, pivot).join(' '), w.slice(pivot).join(' ')];
}

function clampToMaxLines(lines, w, maxLines, minWords, maxWords, maxChars) {
  if (!maxLines || lines.length <= maxLines) return lines;
  if (maxLines === 2) {
    return splitWordsIntoTwoBalanced(w, minWords, maxWords, maxChars);
  }

  const per = Math.ceil(w.length / maxLines);
  const out = [];
  for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per).join(' '));
  return out.slice(0, maxLines);
}

export function layoutLines(text, layout) {
  const w = words(text);
  if (!w.length) return [''];
  const min = Math.max(1, layout.wordsPerLineMin || 2);
  const max = Math.max(min, layout.wordsPerLineMax || 6);
  const maxChars = Math.max(8, maxCharsForLayout(layout));
  const maxLines = Number(layout.maxLines || 0);
  if (layout.mode === 'single') return [w.join(' ')];

  if (layout.mode === 'wide') {
    const per = Math.max(max, layout.wordsPerLineMax || 10);
    const out = [];
    for (let i = 0; i < w.length; i += per) out.push(w.slice(i, i + per).join(' '));
    return out.length ? out : [''];
  }

  const rawLines = [];
  let current = [];

  for (const token of w) {
    const nextCount = current.length + 1;
    const nextLen = current.length ? lineLength([...current, token]) : token.length;
    const hitWordCap = nextCount > max;
    const hitCharCap = nextLen > maxChars && current.length >= min;

    if ((hitWordCap || hitCharCap) && current.length) {
      rawLines.push(current);
      current = [token];
    } else {
      current.push(token);
    }
  }
  if (current.length) rawLines.push(current);

  rebalanceTrailingOrphan(rawLines, min, max);
  rebalanceByLength(rawLines, min, max);

  const lines = rawLines.map((parts) => parts.join(' ').trim()).filter(Boolean);
  const clamped = clampToMaxLines(lines, w, maxLines, min, max, maxChars).filter(Boolean);

  if (!clamped.length) {
    return [''];
  }
  return clamped;
}

export function buildCueLines(segment, layout, uppercase) {
  const lines = layoutLines(segment.text, layout);
  if (uppercase) return lines.map((l) => l.toUpperCase());
  return lines;
}
