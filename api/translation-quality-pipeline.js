/**
 * Translation quality evaluation + automatic rewrite (diagnostics-driven).
 */

import {
  scoreTranslationBatch,
  scoreTranslationPair,
  buildBackTranslationPrompts
} from './translation-quality-score.js';
import { buildLanguageAwareRewriteBatchPrompts } from './translation-rewrite-strategies.js';

function isQualityLlmEnabled() {
  return String(process.env.TRANSLATION_QUALITY_LLM ?? '1') !== '0';
}

function isQualityRewriteEnabled() {
  return String(process.env.TRANSLATION_QUALITY_REWRITE ?? '1') !== '0';
}

/**
 * Back-translate sample cues for semantic scoring.
 * @param {{ text, start, end }[]} translatedSegments
 * @param {Function} runSingleCompletion async (prompts) => string
 */
async function backTranslateSample(translatedSegments, sourceLanguage, runSingleCompletion, max = 5) {
  const backMap = new Map();
  if (!isQualityLlmEnabled() || typeof runSingleCompletion !== 'function') {
    return backMap;
  }
  const n = Math.min(max, translatedSegments.length);
  for (let i = 0; i < n; i++) {
    const text = String(translatedSegments[i]?.text || '').trim();
    if (!text) continue;
    try {
      const prompts = buildBackTranslationPrompts(text, sourceLanguage);
      const back = await runSingleCompletion(prompts);
      if (back) backMap.set(i, back.trim());
    } catch (err) {
      console.warn('[translation-quality] back-translate failed', { index: i, message: err?.message });
    }
  }
  return backMap;
}

/**
 * @param {object} opts
 * @param {{ start, end, text }[]} opts.sourceSegments
 * @param {{ start, end, text }[]} opts.translatedSegments
 * @param {string} opts.sourceLanguage
 * @param {string} opts.targetLanguage
 * @param {string} opts.traceId
 * @param {Function} [opts.runLlmBatch] completeSubtitleTextBatch(batch, prompts, ...)
 * @param {Function} [opts.runSingleCompletion] async (prompts) => string
 */
export async function evaluateAndRewriteTranslation(opts) {
  const {
    sourceSegments = [],
    translatedSegments = [],
    sourceLanguage,
    targetLanguage,
    traceId,
    runLlmBatch,
    runSingleCompletion,
    contentDomain = 'general'
  } = opts;

  const backTranslations = await backTranslateSample(
    translatedSegments,
    sourceLanguage,
    runSingleCompletion,
    5
  );

  const initialBatch = scoreTranslationBatch(sourceSegments, translatedSegments, {
    sourceLanguage,
    targetLanguage,
    backTranslations,
    maxSample: Math.min(12, translatedSegments.length)
  });

  const initialScore = initialBatch.translationScore;
  let working = translatedSegments.map((s) => ({ ...s }));
  let rewritten = false;
  let rewrittenScore = initialScore;

  if (
    isQualityRewriteEnabled() &&
    initialBatch.needsRewrite &&
    typeof runLlmBatch === 'function'
  ) {
    const rewriteIndices = initialBatch.perCue
      .filter((p) => p.needsRewrite)
      .map((p) => p.index);

    const toRewrite =
      rewriteIndices.length > 0
        ? rewriteIndices.slice(0, 8)
        : [...Array(Math.min(5, working.length)).keys()];

    const batch = toRewrite.map((i) => ({
      start: working[i].start,
      end: working[i].end,
      text: working[i].text,
      _index: i,
      _source: sourceSegments[i]?.text || ''
    }));

    if (batch.length) {
      const prompts = buildLanguageAwareRewriteBatchPrompts(targetLanguage, batch, contentDomain);

      try {
        const rewrittenSegs = await runLlmBatch(batch, prompts, traceId, 'quality-rewrite', {
          temperature: 0.32
        });
        for (let j = 0; j < rewrittenSegs.length; j++) {
          const idx = batch[j]._index;
          if (working[idx] && rewrittenSegs[j]?.text) {
            working[idx] = {
              ...working[idx],
              text: String(rewrittenSegs[j].text).trim()
            };
          }
        }
        rewritten = true;

        const backAfter = await backTranslateSample(working, sourceLanguage, runSingleCompletion, 5);
        const afterBatch = scoreTranslationBatch(sourceSegments, working, {
          sourceLanguage,
          targetLanguage,
          backTranslations: backAfter,
          maxSample: Math.min(12, working.length)
        });
        rewrittenScore = afterBatch.translationScore;

        return {
          segments: working,
          initialScore,
          rewrittenScore,
          rewritten: true,
          scores: afterBatch,
          initialScores: initialBatch
        };
      } catch (err) {
        console.warn('[translation-quality] rewrite pass failed', {
          traceId,
          message: err?.message
        });
      }
    }
  }

  return {
    segments: working,
    initialScore,
    rewrittenScore: initialScore,
    rewritten: false,
    scores: initialBatch,
    initialScores: initialBatch
  };
}

export { scoreTranslationPair, exampleQualityScores } from './translation-quality-score.js';
