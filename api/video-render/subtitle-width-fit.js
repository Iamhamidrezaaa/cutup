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
