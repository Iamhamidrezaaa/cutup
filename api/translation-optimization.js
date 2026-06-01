/**
 * Translation latency optimizations (quality thresholds unchanged).
 */

import { buildBackTranslationPrompts } from './translation-quality-score.js';

export const EARLY_ACCEPT_THRESHOLD = 88;
export const MAX_BACK_TRANSLATION_SAMPLES = 9;

const SAVE_BACK_MS = Number(process.env.TRANSLATION_OPT_SAVE_BACK_MS || 3300);
const SAVE_ADAPTIVE_SKIP_MS = Number(process.env.TRANSLATION_OPT_SAVE_ADAPTIVE_SKIP_MS || 12000);

/**
 * First 3, middle 3, last 3 cue indices (max 9 unique).
 * @param {number} cueCount
 * @returns {number[]}
 */
export function pickBackTranslationSampleIndices(cueCount) {
  const n = Math.max(0, Number(cueCount) || 0);
  if (n === 0) return [];

  const first = [];
  for (let i = 0; i < Math.min(3, n); i++) first.push(i);

  const last = [];
  for (let i = Math.max(0, n - 3); i < n; i++) last.push(i);

  let middle = [];
  if (n > 3) {
    const center = Math.floor(n / 2);
    if (n <= 6) {
      const start = Math.max(0, Math.floor((n - 3) / 2));
      for (let i = start; i < start + 3 && i < n; i++) middle.push(i);
    } else {
      middle = [center - 1, center, center + 1].filter((i) => i >= 0 && i < n);
    }
  }

  const seen = new Set();
  const out = [];
  for (const i of [...first, ...middle, ...last]) {
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
    if (out.length >= MAX_BACK_TRANSLATION_SAMPLES) break;
  }
  return out.sort((a, b) => a - b);
}

export function buildBatchedBackTranslationPrompts(batch, sourceLanguage) {
  const lang = String(sourceLanguage || 'en').toLowerCase().slice(0, 8);
  const langLabel =
    lang === 'en' ? 'English' : lang === 'ru' ? 'Russian' : lang === 'fa' ? 'Persian' : lang;
  const n = batch.length;
  const block = batch.map((s) => String(s.text || '').trim()).join('\n---SEGMENT---\n');
  return {
    systemPrompt: `You back-translate subtitle lines into ${langLabel} for quality checking. Output exactly ${n} segments in the same order, separated only by ---SEGMENT--- on its own line. Output ONLY ${langLabel} meaning — no notes.`,
    userPrompt: `Back-translate these ${n} subtitle lines into ${langLabel} (same order, ---SEGMENT--- between lines):\n\n${block}\n\n${langLabel} lines (${n} parts):`
  };
}

/**
 * @param {number[]} indices
 * @param {string[]} texts cue index → translated text
 * @param {string} sourceLanguage
 * @param {Function|null} runLlmBatch
 * @param {Function|null} runSingleCompletion
 * @param {string} traceId
 * @returns {Promise<Map<number, string>>}
 */
export async function backTranslateSampleIndices(
  indices,
  texts,
  sourceLanguage,
  runLlmBatch,
  runSingleCompletion,
  traceId
) {
  const backMap = new Map();
  const unique = [...new Set(indices)].filter((i) => i >= 0 && i < texts.length);
  if (!unique.length) return backMap;

  const batch = unique.map((i) => ({
    start: i,
    end: i + 1,
    text: String(texts[i] || '').trim(),
    _index: i
  }));

  if (typeof runLlmBatch === 'function') {
    const prompts = buildBatchedBackTranslationPrompts(batch, sourceLanguage);
    const out = await runLlmBatch(batch, prompts, traceId, 'backtranslate-sample', { temperature: 0.15 });
    for (let j = 0; j < out.length; j++) {
      const idx = batch[j]._index;
      const back = String(out[j]?.text || '').trim();
      if (back) backMap.set(idx, back);
    }
    return backMap;
  }

  if (typeof runSingleCompletion !== 'function') return backMap;

  for (const i of unique) {
    const text = String(texts[i] || '').trim();
    if (!text) continue;
    try {
      const prompts = buildBackTranslationPrompts(text, sourceLanguage);
      const back = await runSingleCompletion(prompts);
      if (back) backMap.set(i, String(back).trim());
    } catch (err) {
      console.warn('[translation-optimization] back-translate failed', {
        traceId,
        index: i,
        message: err?.message
      });
    }
  }
  return backMap;
}

export function createScoreCache() {
  const cache = new Map();
  return {
    get(sourceText, translatedText, backText, scorer) {
      const key = `${String(sourceText)}\0${String(translatedText)}\0${backText ?? ''}`;
      if (cache.has(key)) return cache.get(key);
      const result = scorer();
      cache.set(key, result);
      return result;
    },
    size: () => cache.size
  };
}

export function createTranslationOptimizationTracker(traceId) {
  return {
    traceId,
    adaptiveSkippedCount: 0,
    backTranslationSampleCount: 0,
    backTranslationCallsAvoided: 0,
    optimizationSavedMs: 0,

    recordAdaptiveSkip() {
      this.adaptiveSkippedCount += 1;
      this.optimizationSavedMs += SAVE_ADAPTIVE_SKIP_MS;
    },

    recordBackTranslateSample(count) {
      this.backTranslationSampleCount += Math.max(0, Number(count) || 0);
    },

    recordBackTranslateAvoided(count) {
      const n = Math.max(0, Number(count) || 0);
      if (!n) return;
      this.backTranslationCallsAvoided += n;
      this.optimizationSavedMs += n * SAVE_BACK_MS;
    },

    recordBatchBackTranslateSaved(perCueCallsAvoided) {
      this.recordBackTranslateAvoided(Math.max(0, perCueCallsAvoided));
    },

    finish(extra = {}) {
      const payload = {
        traceId: this.traceId,
        optimizationSavedMs: Math.round(this.optimizationSavedMs),
        adaptiveSkippedCount: this.adaptiveSkippedCount,
        backTranslationSampleCount: this.backTranslationSampleCount,
        backTranslationCallsAvoided: this.backTranslationCallsAvoided,
        ...extra
      };
      console.log('[translation-optimization]', JSON.stringify(payload));
      return payload;
    }
  };
}

export function isTranslationOptimizationEnabled() {
  return String(process.env.TRANSLATION_OPTIMIZATION ?? '1') !== '0';
}
