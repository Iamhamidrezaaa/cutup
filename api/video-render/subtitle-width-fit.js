/**
 * Estimate on-screen subtitle width for vertical burn (libass WrapStyle: 2 — no auto-wrap).
 */

function charWidthUnits(ch) {
  if (/\s/.test(ch)) return 0.34;
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(ch)) return 0.5;
  if (/[A-Z]/.test(ch)) return 0.62;
  if (/[0-9]/.test(ch)) return 0.48;
  return 0.54;
}

export function estimateBurnTextWidthPx(text, fontSize) {
  const fs = Math.max(1, Number(fontSize) || 48);
  let units = 0;
  for (const ch of String(text || '')) {
    units += charWidthUnits(ch);
  }
  return units * fs;
}

export function maxSubtitleBandWidthPx(playResX, marginL, marginR, paddingPx = 28) {
  const w = Math.max(1, Number(playResX) || 1080);
  const ml = Math.max(0, Number(marginL) || 0);
  const mr = Math.max(0, Number(marginR) || 0);
  return Math.max(120, w - ml - mr - paddingPx);
}

/**
 * Shrink font until estimated line width fits the safe band (vertical overflow guard).
 */
export function resolveFittedFontSize(text, baseFontSize, maxWidthPx, minFontSize = 32) {
  let fs = Math.round(Number(baseFontSize) || 48);
  const minFs = Math.max(24, Math.round(Number(minFontSize) || 32));
  const maxW = Math.max(80, Number(maxWidthPx) || 900);
  while (fs > minFs && estimateBurnTextWidthPx(text, fs) > maxW) {
    fs -= 2;
  }
  return fs;
}

/** Fit font to the widest individual line (multiline cues must not overflow per row). */
export function resolveFittedFontSizeForLines(lines, baseFontSize, maxWidthPx, minFontSize = 32) {
  const list = (Array.isArray(lines) ? lines : [lines])
    .map((l) => String(l || '').trim())
    .filter(Boolean);
  if (!list.length) return resolveFittedFontSize('', baseFontSize, maxWidthPx, minFontSize);
  let widest = list[0];
  let maxUnits = 0;
  for (const line of list) {
    let units = 0;
    for (const ch of line) units += charWidthUnits(ch);
    if (units > maxUnits) {
      maxUnits = units;
      widest = line;
    }
  }
  return resolveFittedFontSize(widest, baseFontSize, maxWidthPx, minFontSize);
}

/**
 * Break long lines into shorter rows that fit the safe band (max two rows for vertical).
 * All words are kept — lines are rebalanced, never truncated.
 */
export function clampLinesToSafeBand(lines, fontSize, maxWidthPx, maxLines = 2) {
  const cap = Math.max(1, Number(maxLines) || 2);
  const maxW = Math.max(80, Number(maxWidthPx) || 900);
  const fs = Math.max(1, Number(fontSize) || 48);
  const input = (Array.isArray(lines) ? lines : [lines])
    .map((l) => String(l || '').trim())
    .filter(Boolean);
  if (!input.length) return [''];

  const words = input.join(' ').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  if (words.length === 1) {
    return [words[0]];
  }

  const charBudget = Math.max(12, Math.floor(maxW / (fs * 0.54)));
  const chunks = splitWordsByCharBudget(words, charBudget);
  if (chunks.length <= cap) {
    return chunks.map((c) => c.join(' '));
  }

  // More chunks than allowed rows — merge into `cap` balanced lines without dropping words.
  const merged = [];
  let bucket = [];
  let targetPerRow = Math.ceil(words.length / cap);
  for (const word of words) {
    bucket.push(word);
    const nextWouldOverflow =
      bucket.length >= targetPerRow &&
      merged.length < cap - 1 &&
      estimateBurnTextWidthPx(bucket.join(' '), fs) > maxW;
    if (bucket.length >= targetPerRow || nextWouldOverflow) {
      merged.push(bucket.join(' '));
      bucket = [];
      targetPerRow = Math.ceil((words.length - merged.join(' ').split(/\s+/).length) / (cap - merged.length));
    }
  }
  if (bucket.length) merged.push(bucket.join(' '));

  if (merged.length <= cap) return merged;

  // Fallback: hard split word list evenly across cap rows.
  const perRow = Math.ceil(words.length / cap);
  const even = [];
  for (let i = 0; i < words.length; i += perRow) {
    even.push(words.slice(i, i + perRow).join(' '));
  }
  return even.slice(0, cap);
}

/**
 * Char budget for sequential visual chunks on 9:16 (one line per chunk).
 */
export function resolveVerticalChunkCharBudget(playResX, marginL, marginR, fontSize) {
  const maxW = maxSubtitleBandWidthPx(playResX, marginL, marginR);
  const fs = Math.max(1, Number(fontSize) || 48);
  let chars = 0;
  let width = 0;
  const probe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  while (chars < probe.length && width < maxW * 0.92) {
    chars += 1;
    width = estimateBurnTextWidthPx(probe.slice(0, chars), fs);
  }
  return Math.max(14, Math.min(36, chars - 1));
}

export function splitWordsByCharBudget(words, maxChars) {
  const list = Array.isArray(words) ? words : [];
  const cap = Math.max(8, Number(maxChars) || 28);
  if (!list.length) return [];
  const chunks = [];
  let bucket = [];
  let len = 0;
  for (const word of list) {
    const w = String(word || '');
    if (!w) continue;
    const add = (bucket.length ? 1 : 0) + w.length;
    if (bucket.length && len + add > cap) {
      chunks.push(bucket);
      bucket = [w];
      len = w.length;
    } else {
      bucket.push(w);
      len += add;
    }
  }
  if (bucket.length) chunks.push(bucket);
  return chunks;
}

export function cueNeedsVerticalSplit(text, { playResX, marginL, marginR, fontSize, maxChars } = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  const maxW = maxSubtitleBandWidthPx(playResX, marginL, marginR);
  if (estimateBurnTextWidthPx(t, fontSize) > maxW) return true;
  const w = t.split(/\s+/).filter(Boolean);
  return maxChars > 0 && w.length >= 3 && t.length > maxChars;
}
