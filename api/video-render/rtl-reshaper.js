/**
 * Pre-shape Arabic/Persian text for libass (arabic_reshaper only — no bidi flip).
 */
import { execFileSync } from 'child_process';

const PYTHON_RESHAPE = [
  '-c',
  "import arabic_reshaper, sys; print(arabic_reshaper.reshape(sys.stdin.read().strip()), end='')"
];

/**
 * @param {string} text
 * @returns {string}
 */
export function reshapeRtlText(text) {
  if (!text || !String(text).trim()) return text;
  try {
    const result = execFileSync('python3', PYTHON_RESHAPE, {
      input: String(text),
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const shaped = String(result ?? '').trim();
    return shaped || text;
  } catch (err) {
    console.warn('[rtl-reshaper] reshape failed:', err?.message || String(err));
    return text;
  }
}

/**
 * @param {string} assText may contain \\N line separators
 * @returns {string}
 */
export function reshapeAssRtlText(assText) {
  if (!assText) return assText;
  return String(assText)
    .split('\\N')
    .map((line) => reshapeRtlText(line))
    .join('\\N');
}
